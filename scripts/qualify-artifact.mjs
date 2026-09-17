/** Parent fixture owns the synthetic server; two plain Node children prove process-independent replay. */
import { createServer } from 'node:http'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
const stage = resolve(process.argv[2])
const data = join(stage, 'fixture-data')
await mkdir(data, { recursive: true })
await copyFile(new URL('./artifact-worker.fixture.mjs', import.meta.url), join(stage, 'worker.fixture.mjs'))
const requests = []
let emittedCall = false, compactCalls = 0
const server = createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const part of request) raw += part
    const body = JSON.parse(raw)
    requests.push({ path: request.url, body })
    if (request.url.endsWith('/input_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens: JSON.stringify(body).length }))
    } else if (request.url.endsWith('/compact')) {
      compactCalls++
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ output: [{ type: 'compaction', id: 'artifact-cp', encrypted_content: 'artifact-opaque-fixture' }] }))
    } else {
      const output = emittedCall ? [{ type: 'message', role: 'assistant', id: 'fixture-message', status: 'completed', content: [{ type: 'output_text', text: 'fixture complete' }] }]
        : [{ type: 'custom_tool_call', id: 'fixture-tool', call_id: 'fixture-call', name: 'apply_patch', status: 'completed', input: '*** Begin Patch\n*** Add File: artifact-probe.txt\n+artifact-marker-742\n*** End Patch' }]
      emittedCall = true
      response.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'fixture-response', status: 'completed', output } }) + '\n\n')
    }
  } catch { response.writeHead(500).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${server.address().port}/v1`
async function child(phase) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [join(stage, 'worker.fixture.mjs'), endpoint, data, phase], { cwd: stage, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    process.stdout.on('data', value => { stdout += value })
    process.stderr.on('data', value => { stderr += value })
    const timeout = setTimeout(() => { process.kill(); reject(new Error('Artifact worker timed out')) }, 30_000)
    process.on('error', reject)
    process.on('exit', code => { clearTimeout(timeout); if (code !== 0) reject(new Error(stderr)); else { console.log(stdout.trim()); resolve() } })
  })
}
try {
  await child('create')
  const before = (await stat(join(data, 'artifact-probe.txt'))).mtimeMs
  const cut = requests.length
  await child('resume')
  assert.equal((await stat(join(data, 'artifact-probe.txt'))).mtimeMs, before)
  const resumed = requests.slice(cut).find(request => request.path.endsWith('/responses'))
  assert(JSON.stringify(resumed.body.input).includes('artifact-opaque-fixture'))
  assert(JSON.stringify(resumed.body.input).includes('AFTER-PROCESS-RESTART'))
  const report = { passed: true, plainNodeProcesses: 2, artifactPatchExecuted: true, toolNotReexecuted: true,
    compactCalls, persistedCheckpointRestored: true, sourceAliases: false,
    assembly: JSON.parse(await readFile(join(stage, 'assembly.json'), 'utf8')) }
  await writeFile(join(stage, 'qualification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, assembly: undefined }))
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
