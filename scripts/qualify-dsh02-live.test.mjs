/** Offline only: no saved credentials or real CPA endpoint are used. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { qualify, validateOptions } from './qualify-dsh02-live.mjs'
import { decodeNativeFrames } from './qualify-dsh02-log.mjs'
import { constants, zstdCompressSync } from 'node:zlib'

const fake = { GPT_COMPAT_LIVE_TEST: '1', GPT_COMPAT_LIVE_MODEL: 'gpt-6-astra', GPT_COMPAT_LIVE_ACCOUNT: 'offline-account', GPT_COMPAT_LIVE_KEY: 'offline-key', GPT_COMPAT_LIVE_URL: 'http://127.0.0.1:1/v1', GPT_COMPAT_QUALIFIER_TEST_ENDPOINT: '1' }
const runtime = resolve(process.env.GPT_COMPAT_QUALIFIER_RUNTIME ?? 'artifacts/host-dsh021/runtime')
test('strict native decoder consumes all frames and rejects incomplete or corrupt tails', () => {
  const compress = text => zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  const first = compress('header\n'), second = compress('event\n'), all = Buffer.concat([first, second])
  assert.equal(decodeNativeFrames(all).toString(), 'header\nevent\n')
  assert.throws(() => decodeNativeFrames(all.subarray(0, all.length - 1)), /NATIVE_FRAME_INVALID/)
  assert.throws(() => decodeNativeFrames(Buffer.concat([all, Buffer.from([1])])), /NATIVE_FRAME_MAGIC/)
  const corrupt = Buffer.from(all); corrupt[corrupt.length - 1] ^= 1
  assert.throws(() => decodeNativeFrames(corrupt), /NATIVE_FRAME_INVALID/)
})
test('explicit opt-in, exact account/model, safe endpoint and separate owned directory guards', () => {
  const data = resolve('offline-unused-data')
  assert.equal(validateOptions(runtime, data, fake).offlineSynthetic, true)
  for (const [change, code] of [[{ GPT_COMPAT_LIVE_TEST: '' }, 'OPT_IN_REQUIRED'], [{ GPT_COMPAT_LIVE_MODEL: 'other' }, 'MODEL_MUST_BE_ASTRA'], [{ GPT_COMPAT_LIVE_ACCOUNT: '' }, 'FIXED_ACCOUNT_AND_KEY_REQUIRED'], [{ GPT_COMPAT_LIVE_URL: 'https://example.com/v1' }, 'TEST_ENDPOINT_NOT_LOOPBACK'], [{ GPT_COMPAT_LIVE_URL: 'http://user:pass@127.0.0.1/v1' }, 'BAD_ENDPOINT']]) {
    assert.throws(() => validateOptions(runtime, data, { ...fake, ...change }), { message: 'QUALIFIER_' + code })
  }
  assert.throws(() => validateOptions(runtime, join(runtime, 'data'), fake), /RUNTIME_DATA_OVERLAP/)
  assert.throws(() => validateOptions(runtime, resolve('in.dsh-plug.dsh-launcher/homes/data'), fake), /LAUNCHER_PATH_FORBIDDEN/)
})

async function runOffline(mode) {
  const parent = await mkdtemp(join(tmpdir(), 'gpt-rc2-offline-'))
  const data = join(parent, 'qualified')
  let emitted = false, marker, compactRequests = 0, requests = 0, serverFailure = false
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses')
      assert.equal(request.headers.authorization, 'Bearer offline-key')
      assert.equal(request.headers['x-cpa-codex-account'], 'offline-account')
      let raw = ''; for await (const part of request) raw += part
      const body = JSON.parse(raw)
      assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.reasoning.effort, 'high')
      requests++
      let output
      if (body.input.some(item => item.type === 'compaction_trigger')) {
        compactRequests++; output = [{ type: 'compaction', id: 'offline-compact-' + compactRequests, encrypted_content: 'opaque-offline-' + compactRequests }]
      } else if (!emitted) {
        marker = JSON.stringify(body.input).match(/qualifier-marker-[0-9a-f-]{36}/)?.[0]
        assert(marker)
        let patch = `*** Begin Patch\n*** Add File: ${mode === 'bad-patch' ? 'unapproved-file.txt' : 'artifact-probe.txt'}\n+${marker}\n*** End Patch`
        if (mode === 'trailing-newline') patch += '\n'
        if (mode === 'crlf-whitespace') patch = patch.replace(/\n/g, '\r\n') + '\r\n  '
        output = [{ type: 'custom_tool_call', id: 'offline-tool', call_id: 'offline-call', name: 'apply_patch', status: 'completed', input: patch }]
        emitted = true
      } else {
        const resume = JSON.stringify(body.input).includes('The test process has restarted.')
        output = [{ type: 'message', role: 'assistant', id: 'offline-message-' + requests, status: 'completed', content: [{ type: 'output_text', text: resume ? marker : 'READY' }] }]
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'offline-response-' + requests, status: 'completed', output } }) + '\n\n')
    } catch { serverFailure = true; response.writeHead(500).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const env = { ...process.env, ...fake, GPT_COMPAT_LIVE_URL: `http://127.0.0.1:${server.address().port}/v1` }
    const report = await qualify(runtime, data, env)
    if (mode === 'bad-patch') {
      assert.equal(report.passed, false)
      assert.equal(report.create.deniedTools, 1)
      assert.equal(report.create.authorizedPatchExecutions, 0)
      assert.equal(report.create.normalTeardown, true)
      assert.equal(report.processes.length, 1)
      await assert.rejects(stat(join(data, 'unapproved-file.txt')), error => error.code === 'ENOENT')
      return
    }
    // This report contains only allowlisted test identities/counts/hashes.
    assert.equal(report.passed, true, JSON.stringify(report))
    assert.equal(serverFailure, false)
    assert(compactRequests > 0); assert(requests >= 4)
    assert.equal(report.realJsonlPersistence, true)
    assert.equal(report.resume.coldStrictV4, true)
    assert.equal(report.resume.markerRecalled, true)
    assert.equal(report.toolNotReexecuted, true)
    assert.equal(report.create.nativeArtifact.encoding, 'session.v4.jsonl.zstd')
    assert.equal(report.create.authorizedPatchExecutions, 1)
    assert.equal(report.resume.authorizedPatchExecutions, 0)
    const receiptText = await readFile(join(data, 'qualification.json'), 'utf8')
    for (const secret of ['offline-key', 'offline-account', 'opaque-offline-', marker]) assert(!receiptText.includes(secret))
    await assert.rejects(qualify(runtime, data, env), error => error.code === 'EEXIST')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
test('real installed RC2 JSONL/zstd persistence across two Node processes, fixed account and one patch', { timeout: 90_000 }, () => runOffline('success'))
test('exact patch with a trailing newline still executes once and cold-restores', { timeout: 90_000 }, () => runOffline('trailing-newline'))
test('CRLF and trailing whitespace preserve exact patch authorization and cold restore', { timeout: 90_000 }, () => runOffline('crlf-whitespace'))
test('pre-dispatch denies a changed patch before filesystem writes and drains normally', { timeout: 90_000 }, () => runOffline('bad-patch'))
