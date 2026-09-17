/** Explicit live qualification of the staged artifact. Credentials stay in the process environment. */
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
assert.equal(process.env.GPT_COMPAT_LIVE_TEST, '1')
for (const name of ['GPT_COMPAT_LIVE_URL', 'GPT_COMPAT_LIVE_KEY', 'GPT_COMPAT_LIVE_MODEL']) assert(process.env[name], name)
const stage = resolve(process.argv[2])
const data = join(stage, 'live-fixture-' + Date.now())
await mkdir(data)
await copyFile(new URL('./artifact-worker.fixture.mjs', import.meta.url), join(stage, 'worker.fixture.mjs'))
async function child(phase) {
  await new Promise((resolve, reject) => {
    const worker = spawn(process.execPath, [join(stage, 'worker.fixture.mjs'), process.env.GPT_COMPAT_LIVE_URL, data, phase], { cwd: stage, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    // Do not echo arbitrary model responses or credential-bearing failures.
    worker.stdout.resume()
    worker.stderr.resume()
    const timer = setTimeout(() => { worker.kill(); reject(new Error('Live worker timed out')) }, 180_000)
    worker.on('error', error => { clearTimeout(timer); reject(error) })
    worker.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Live worker ${phase} failed: ${code}; inspect synthetic session locally`)) })
  })
}
const native = process.env.GPT_COMPAT_LIVE_CONTEXT_MODE === 'codex-v2'
const report = { passed: false, model: process.env.GPT_COMPAT_LIVE_MODEL, automaticContext: native, plainNodeProcesses: 2 }
try {
  await child('create')
  const first = JSON.parse(await readFile(join(data, 'session.json'), 'utf8'))
  const calls = first.filter(event => event.type === 'tool/call')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].data.name, 'apply_patch')
  const previous = first.filter(event => event.type === 'context/checkpoint').at(-1)?.data.state.native?.input
  if (native) {
    assert(previous?.some(item => item.type === 'compaction'))
    assert(first.some(event => event.type === 'context/checkpoint-commit'))
  }
  const before = (await stat(join(data, 'artifact-probe.txt'))).mtimeMs
  await child('resume')
  const resumed = JSON.parse(await readFile(join(data, 'session.json'), 'utf8'))
  assert.equal(resumed.filter(event => event.type === 'tool/call').length, 1)
  assert.equal((await stat(join(data, 'artifact-probe.txt'))).mtimeMs, before)
  const last = resumed.filter(event => event.type === 'assistant/message').at(-1).data.message
  assert(last.content.some(block => block.type === 'text' && block.text.includes('artifact-marker-742')))
  if (native) {
    const checkpoint = previous.find(item => item.type === 'compaction').encrypted_content
    const continued = resumed.slice(first.length)
    assert(continued.some(event => ['context/operation', 'request/projection'].includes(event.type) && JSON.stringify(event.data).includes(checkpoint)))
    Object.assign(report, { nativeCheckpointRestored: true, compactionCalls: resumed.filter(event => event.type === 'context/operation' && event.data.kind === 'native-compact').length })
  }
  Object.assign(report, { passed: true, artifactPatchExecuted: true, toolNotReexecuted: true, restoredHistoryMarkerRecalled: true, sourceAliases: false })
} finally {
  await writeFile(join(stage, 'live-qualification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
