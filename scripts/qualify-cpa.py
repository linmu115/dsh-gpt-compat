"""Probe a local CPA using synthetic inputs; never persist credentials or opaque output."""
import argparse
import json
import time
import urllib.request
import urllib.error
from pathlib import Path
import yaml

parser = argparse.ArgumentParser()
parser.add_argument('--config', required=True)
parser.add_argument('--model', required=True)
parser.add_argument('--report', required=True)
parser.add_argument('--context-mode', choices=['responses', 'codex-v2'], default='responses')
args = parser.parse_args()
config = yaml.safe_load(Path(args.config).read_text(encoding='utf-8'))
assert config.get('host') in ('127.0.0.1', 'localhost', '::1'), 'Use a loopback CPA configuration'
assert not config.get('tls', {}).get('enable'), 'This probe expects local HTTP'
base = 'http://127.0.0.1:' + str(config['port']) + '/v1'
headers = {'Authorization': 'Bearer ' + config['api-keys'][0], 'Content-Type': 'application/json'}
report = {'model': args.model, 'endpoint': base, 'context_mode': args.context_mode, 'checks': []}

def post(label, path, body):
    started = time.monotonic()
    row = {'check': label}
    try:
        request = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers=headers, method='POST')
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read(16 * 1024 * 1024 + 1)
            assert len(data) <= 16 * 1024 * 1024, 'Response exceeded probe limit'
            row['http_status'] = response.status
            if 'text/event-stream' in response.headers.get('content-type', ''):
                events = [json.loads(line[6:]) for line in data.decode().splitlines() if line.startswith('data: ') and line[6:] != '[DONE]']
                final = [event['response'] for event in events if event.get('type') == 'response.completed']
                assert len(final) == 1, 'No unique completed response'
                result = final[0]
            else:
                result = json.loads(data)
            row['output_types'] = [item.get('type') for item in result.get('output', [])]
            row['usage'] = {key: value for key, value in result.get('usage', {}).items() if key in ('input_tokens', 'output_tokens', 'total_tokens')}
            row['passed'] = True
            return result
    except urllib.error.HTTPError as error:
        row.update(http_status=error.code, passed=False)
        try:
            failure = json.loads(error.read(65536)).get('error', {})
            if isinstance(failure, dict):
                for field in ('code', 'type', 'retry_after_seconds'):
                    if field in failure: row[field] = failure[field]
        except (ValueError, AttributeError):
            pass
        if error.headers.get('retry-after'): row['retry_after'] = error.headers['retry-after']
        return None
    except Exception as error:
        row.update(passed=False, error_type=type(error).__name__)
        return None
    finally:
        row['seconds'] = round(time.monotonic() - started, 3)
        report['checks'].append(row)
        Path(args.report).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(row), flush=True)

history = [{'role': 'user', 'content': 'Synthetic compatibility check. Remember the marker cobalt-742. Say READY only.'}]
common = {'model': args.model, 'store': False, 'include': ['reasoning.encrypted_content'], 'stream': True}
first = post('responses', '/responses', {**common, 'input': history})
if first:
    history += first['output']
    history += [{'role': 'user', 'content': 'Call apply_patch once to add probe.txt containing cobalt-742. This is a protocol test; only emit the tool call.'}]
    tool = {'type': 'custom', 'name': 'apply_patch', 'description': 'Apply a patch using *** Begin Patch, *** Add File: probe.txt, +content, *** End Patch.', 'format': {'type': 'text'}}
    called = post('custom_tool', '/responses', {**common, 'input': history, 'tools': [tool], 'tool_choice': {'type': 'custom', 'name': 'apply_patch'}})
    calls = [] if not called else [item for item in called.get('output', []) if item.get('type') == 'custom_tool_call' and item.get('name') == 'apply_patch']
    report['custom_call_valid'] = len(calls) == 1 and 'cobalt-742' in calls[0].get('input', '')
    if report['custom_call_valid']:
        history += called['output']
        history += [{'type': 'custom_tool_call_output', 'call_id': calls[0]['call_id'], 'output': 'Synthetic fixture: patch accepted.'}]
        continued = post('custom_result_replay', '/responses', {**common, 'input': history, 'tools': [tool], 'tool_choice': 'none'})
        if continued:
            history += continued['output']
    v2 = args.context_mode == 'codex-v2'
    compact = post('native_compact', '/responses' if v2 else '/responses/compact', {**common, 'input': history + [{'type': 'compaction_trigger'}]} if v2 else {'model': args.model, 'input': history})
    report['native_checkpoint_valid'] = bool(compact and any(item.get('type') == 'compaction' and item.get('encrypted_content') for item in compact.get('output', [])))
    if report['native_checkpoint_valid']:
        retained = [item for item in history if item.get('role') in ('user', 'developer')] if v2 else []
        followup = post('compacted_continuation', '/responses', {**common, 'input': retained + compact['output'] + [{'role': 'user', 'content': 'Return only the marker from our earlier work.'}]})
        text = '' if not followup else ''.join(part.get('text', '') for item in followup.get('output', []) for part in item.get('content', []) if isinstance(part, dict))
        report['compacted_marker_recalled'] = 'cobalt-742' in text
expected = ['responses', 'custom_tool', 'custom_result_replay', 'native_compact', 'compacted_continuation']
if args.context_mode == 'responses':
    post('native_input_tokens', '/responses/input_tokens', {'model': args.model, 'input': [{'role': 'user', 'content': 'hello'}]})
    expected.append('native_input_tokens')
else:
    report['budget_mode'] = 'codex-estimate; validated separately by plugin tests, not an exact counter'
report['not_attempted'] = [name for name in expected if name not in {check['check'] for check in report['checks']}]
report['protocol_checks_passed'] = not report['not_attempted'] and all(check['passed'] for check in report['checks']) and all(report.get(key) for key in ['custom_call_valid', 'native_checkpoint_valid', 'compacted_marker_recalled'])
Path(args.report).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key != 'checks'}))
raise SystemExit(0 if report['protocol_checks_passed'] else 1)
