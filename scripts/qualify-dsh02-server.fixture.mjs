/** Offline-only server compaction protocol + native V4 cold restore qualification. */
import { createServer } from 'node:http'
import { copyFile, mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { join, resolve, isAbsolute, relative, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import assert from 'node:assert/strict'

if (process.env.GPT_COMPAT_LIVE_TEST === '1') throw new Error('Offline server fixture refuses live mode')
const [runtimeArg, dataArg] = process.argv.slice(2)
assert(isAbsolute(runtimeArg) && isAbsolute(dataArg), 'Absolute runtime and fresh data paths required')
assert(!/in\.dsh-plug\.dsh-launcher[\\/](?:homes|versions)/i.test(dataArg), 'Launcher data path forbidden')
const runtime = await realpath(runtimeArg), data = resolve(dataArg)
const relation = relative(runtime, data)
assert(relation && (relation === '..' || relation.startsWith('..' + sep) || isAbsolute(relation)), 'Data must be outside the runtime')
await mkdir(data)
await symlink(join(runtime, 'node_modules'), join(data, 'node_modules'), 'junction')
for (const name of ['artifact-worker-dsh02-server.fixture.mjs', 'qualify-dsh02-log.mjs']) await copyFile(new URL('./' + name, import.meta.url), join(data, name))
const marker = 'qualifier-marker-' + randomUUID()
await writeFile(join(data, 'fixture.json'), JSON.stringify({ marker, sessionId: 'server-qualifier-' + randomUUID() }), { flag: 'wx' })
const hash = value => createHash('sha256').update(value).digest('hex')
let sentCall = false, requests = 0, serverFailed = false, pruned = false
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses')
    assert.equal(request.headers.authorization, 'Bearer offline-server-key')
    assert.equal(request.headers['x-cpa-codex-account'], 'offline-server-account')
    let raw = ''; for await (const part of request) raw += part
    const body = JSON.parse(raw); requests++
    assert.deepEqual(body.context_management, [{ type: 'compaction', compact_threshold: 1000 }]); assert.equal(body.store, false)
    assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.reasoning.effort, 'high')
    assert(!body.input.some(item => item.type === 'compaction_trigger'))
    if (body.input.some(item => item.type === 'compaction') && !JSON.stringify(body.input).includes('Use apply_patch exactly once')) pruned = true
    const output = [{ type: 'compaction', id: 'server-cp-' + requests, encrypted_content: 'server-opaque-' + requests }]
    if (!sentCall) {
      sentCall = true
      output.push({ type: 'custom_tool_call', id: 'server-tool', call_id: 'server-call', name: 'apply_patch', status: 'completed', input: `*** Begin Patch\n*** Add File: artifact-probe.txt\n+${marker}\n*** End Patch\n` })
    } else output.push({ type: 'message', role: 'assistant', id: 'server-message-' + requests, status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(body.input).includes('The test process has restarted.') ? marker : 'READY' }] })
    response.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'server-response-' + requests, status: 'completed', output, usage: { input_tokens: 100, output_tokens: 10 } } }) + '\n\n')
  } catch { serverFailed = true; response.writeHead(500).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const report = { schemaVersion: 1, passed: false, offlineSynthetic: true, processes: [] }
try {
  let before
  for (const phase of ['create', 'resume']) {
    const result = await new Promise(resolve => {
      let timedOut = false
      const child = spawn(process.execPath, [join(data, 'artifact-worker-dsh02-server.fixture.mjs'), data, phase], { cwd: data, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
        ...process.env, DSH_HOME: join(data, 'home'), GPT_COMPAT_LIVE_TEST: '', GPT_COMPAT_SERVER_FIXTURE: '1', GPT_COMPAT_LIVE_MODEL: 'gpt-6-astra',
        GPT_COMPAT_LIVE_URL: `http://127.0.0.1:${server.address().port}/v1`, GPT_COMPAT_LIVE_KEY: 'offline-server-key', GPT_COMPAT_LIVE_ACCOUNT: 'offline-server-account',
      } })
      child.stdout.resume(); child.stderr.resume()
      const timeout = setTimeout(() => { timedOut = true; if (child.connected) child.send({ type: 'qualifier-cancel' }) }, 60_000)
      child.on('error', () => {})
      child.on('close', exitCode => { clearTimeout(timeout); resolve({ pid: child.pid, exitCode, timedOut }) })
    })
    report.processes.push({ phase, ...result })
    const receipt = JSON.parse(await readFile(join(data, phase + '-receipt.json'), 'utf8')); report[phase] = receipt
    assert.equal(result.exitCode, 0); assert(!result.timedOut && receipt.passed && receipt.normalTeardown && receipt.replayCompactionCount > 0)
    const probe = { hash: hash(await readFile(join(data, 'artifact-probe.txt'))), mtime: (await stat(join(data, 'artifact-probe.txt'))).mtimeMs }
    if (phase === 'create') { assert.equal(receipt.authorizedPatchExecutions, 1); before = probe }
    else { assert.equal(receipt.authorizedPatchExecutions, 0); assert(receipt.coldStrictV4 && receipt.restoredCheckpointInRequest && receipt.markerRecalled); assert.deepEqual(probe, before) }
  }
  assert(!serverFailed && pruned)
  assert.notEqual(report.processes[0].pid, report.processes[1].pid)
  Object.assign(report, { passed: true, requests, latestPruned: true, realJsonlPersistence: true, toolNotReexecuted: true, sourceAliases: false })
} catch { report.errorCode = 'SERVER_COMPACTION_QUALIFICATION_FAILED' }
finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
await writeFile(join(data, 'qualification.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ passed: report.passed, errorCode: report.errorCode, requests, phases: report.processes.length }))
process.exitCode = report.passed ? 0 : 1
