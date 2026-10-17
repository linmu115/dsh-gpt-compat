/** Opt-in, isolated RC2 installed-artifact qualification. No normal profile is loaded. */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { decodeNativeFrames } from './qualify-dsh02-log.mjs'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const [dataRoot, phase] = process.argv.slice(2)
const hash = value => createHash('sha256').update(value).digest('hex')
const check = (value, code) => { if (!value) throw new Error('QUALIFIER_' + code) }
// All dependency diagnostics remain private to this owned child. The parent never
// stores arbitrary stdout/stderr; only this allowlisted receipt is published.
const originalFetch = globalThis.fetch
const context = new Context()
let agentHandle, persistedHashes = [], authorized = 0, denied = 0, stage = 'guard', cancelled = false
const cancel = message => { if (message?.type === 'qualifier-cancel') { cancelled = true; agentHandle?.agent.cancel({ kind: 'user' }) } }
process.on('message', cancel)
const receipt = { schemaVersion: 1, phase, passed: false, model: 'gpt-6-astra', reasoningEffort: 'high',
  requests: 0, compactRequests: 0, accountHeaderVerified: false, restoredCheckpointInRequest: false }
const fixture = JSON.parse(await readFile(join(dataRoot, 'fixture.json'), 'utf8'))
const marker = fixture.marker, patch = `*** Begin Patch\n*** Add File: artifact-probe.txt\n+${marker}\n*** End Patch`
const id = SessionId(fixture.sessionId)
const route = { provider: 'qualifier', model: 'gpt-6-astra', reasoningEffort: 'high' }
const compactHashes = input => (input ?? []).filter(item => item.type === 'compaction' && typeof item.encrypted_content === 'string' && item.encrypted_content.length).map(item => hash(item.encrypted_content))
const calls = events => events.filter(event => event.type === 'tool/call')
async function files(root) { const found = []; for (const item of await readdir(root, { withFileTypes: true })) { const path = join(root, item.name); if (item.isDirectory()) found.push(...await files(path)); else found.push(path) } return found }
async function inspectPersisted() {
  const artifacts = (await files(join(dataRoot, 'home', 'sessions'))).filter(file => file.endsWith('session.v4.jsonl.zstd'))
  check(artifacts.length === 1, 'NATIVE_ARTIFACT_COUNT')
  // Validate the actual bytes before the persistence backend can apply its
  // recoverable reader. A truncated or repaired tail must not qualify as strict.
  const plain = decodeNativeFrames(await readFile(artifacts[0])).toString('utf8')
  check(plain.endsWith('\n'), 'NATIVE_LOG_INCOMPLETE')
  const [header, ...rows] = plain.slice(0, -1).split('\n').map(line => JSON.parse(line))
  check(header.version === 4, 'NOT_V4')
  const restore = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  for (const row of rows) restore.decodeRow(row)
  const validated = restore.finish()
  const handle = await context.sessionPersistence.open(id, 'read')
  try {
    check(handle.header.version === 4, 'NOT_V4')
    const { events } = await handle.read()
    check(isDeepStrictEqual(validated.events, events), 'STRICT_EVENTS_DIFFER')
    const committed = new Set(events.filter(e => e.type === 'context/checkpoint-commit').map(e => e.data.checkpoint))
    const checkpoints = events.filter(e => e.type === 'context/checkpoint' && committed.has(e.seq))
    const last = checkpoints.at(-1)
    const opaque = compactHashes(last?.data.state?.native?.input)
    check(opaque.length > 0, 'NO_DURABLE_ENCRYPTED_CHECKPOINT')
    check(calls(events).length === 1 && calls(events)[0].data.name === 'apply_patch', 'PERSISTED_TOOL_COUNT')
    return { events, opaque, checkpointCount: checkpoints.length }
  } finally { await handle.close() }
}
try {
  check(process.env.GPT_COMPAT_LIVE_TEST === '1', 'OPT_IN_REQUIRED')
  check(['create', 'resume'].includes(phase), 'BAD_PHASE')
  check(process.env.GPT_COMPAT_LIVE_MODEL === route.model, 'MODEL_MUST_BE_ASTRA')
  const endpoint = new URL(process.env.GPT_COMPAT_LIVE_URL)
  check(['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 'BAD_ENDPOINT')
  if (process.env.GPT_COMPAT_QUALIFIER_TEST_ENDPOINT === '1') check(endpoint.hostname === '127.0.0.1' || endpoint.hostname === '[::1]', 'TEST_ENDPOINT_NOT_LOOPBACK')
  const key = process.env.GPT_COMPAT_LIVE_KEY, account = process.env.GPT_COMPAT_LIVE_ACCOUNT
  check(typeof key === 'string' && !!key && typeof account === 'string' && !!account.trim(), 'FIXED_ACCOUNT_AND_KEY_REQUIRED')
  receipt.accountHash = hash(account)
  receipt.offlineSynthetic = process.env.GPT_COMPAT_QUALIFIER_TEST_ENDPOINT === '1'
  const ownedHome = join(dataRoot, 'home')
  check(process.env.DSH_HOME === ownedHome, 'HOME_NOT_ISOLATED')
  context.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { GPT_QUALIFIER_KEY: key, DSH_HOME: ownedHome } }]))
  context.provide('gptCpaAccounts', { identity: async () => account, models: async () => undefined })
  context.baseUrl = pathToFileURL(dataRoot).href + '/'
  globalThis.fetch = async (url, options) => {
    check(!cancelled, 'CANCELLED')
    const target = new URL(String(url)), headers = new Headers(options?.headers)
    check(target.origin === endpoint.origin && target.pathname === endpoint.pathname.replace(/\/$/, '') + '/responses', 'UNEXPECTED_HTTP_ROUTE')
    check(headers.get('X-CPA-Codex-Account') === account && headers.get('authorization') === 'Bearer ' + key, 'REQUEST_ACCOUNT_HEADER')
    const body = JSON.parse(String(options.body))
    check(body.model === route.model && body.reasoning?.effort === 'high', 'REQUEST_MODEL_OR_REASONING')
    receipt.requests++; receipt.accountHeaderVerified = true
    check(receipt.requests <= 12, 'REQUEST_LIMIT')
    if (body.input?.some(item => item.type === 'compaction_trigger')) receipt.compactRequests++
    if (phase === 'resume' && compactHashes(body.input).some(value => persistedHashes.includes(value))) receipt.restoredCheckpointInRequest = true
    return originalFetch(url, options)
  }
  stage = 'load'
  await context.plugin(Loader)
  context.loader.internal = { version: 'v2', import: id => import(id) }
  const names = ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'agent-loop', 'session-persistence-jsonl', 'fs-local', 'subprocess-local', 'pwsh-local', 'shell-env'].map(name => '@deepseek-ai/dsh-' + name)
  names.push('dsh-gpt-compat', 'dsh-gpt-compat/responses')
  for (const name of names) await context.loader.create({ name, config:
    name.endsWith('session-persistence-jsonl') ? { root: join(ownedHome, 'sessions'), compression: 'zstd' }
    : name === 'dsh-gpt-compat' ? { bindings: [{ provider: route.provider, models: [route.model] }], context: { enabled: true, triggerRatio: .1, reserveTokens: 2048, marginTokens: 0, retainGroups: 1, maxPasses: 8 } }
    : name === 'dsh-gpt-compat/responses' ? { providers: { qualifier: { baseURL: endpoint.href.replace(/\/$/, ''), apiKeyEnv: 'GPT_QUALIFIER_KEY', nativeContextMode: 'codex-v2', timeoutMs: 120000, models: [{ id: route.model, contextWindow: 32000, maxTokens: 2048, reasoningEfforts: ['high'], defaultReasoningEffort: 'high' }] } } }
    : {} })
  await context.loader.await()
  // A pre-dispatch policy protects the filesystem, not merely a prompt or event audit.
  context.on('tools/pre-execute', async (exec, next) => {
    const input = exec.arguments
    // Transport formatting may add a final newline or use Windows line endings.
    // Compare the entire normalized patch, preserving every interior character.
    const normalizedPatch = typeof input?.patch === 'string' ? input.patch.replace(/\r\n/g, '\n').trim() : undefined
    if (phase !== 'create' || authorized !== 0 || exec.name !== 'apply_patch' || !input || Object.keys(input).length !== 1 || normalizedPatch !== patch) {
      denied++; return { kind: 'deny', reason: 'QUALIFIER_EXACT_PATCH_ONLY' }
    }
    authorized++; return next()
  })
  if (phase === 'resume') {
    stage = 'cold-read'
    const stored = await inspectPersisted(); persistedHashes = stored.opaque
    receipt.coldStrictV4 = true; receipt.coldEventCount = stored.events.length
  }
  stage = phase
  const setup = scope => { installModelSelection(scope, { current: route, assembled: undefined }) }
  agentHandle = phase === 'create'
    ? await context.agents.create({ sessionId: id, meta: { cwd: dataRoot }, agentOptions: route, setup })
    : await context.agents.resume({ resumeSessionId: id, agentOptions: route, setup })
  const agent = agentHandle.agent
  async function turn(text) {
    check(!cancelled, 'CANCELLED')
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const end = agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)
    check(end?.data.reason.kind === 'completed', 'TURN_NOT_COMPLETED')
    check(denied === 0, 'OUT_OF_SCOPE_TOOL_DENIED')
  }
  if (phase === 'create') {
    await turn(`This is an isolated compatibility test. Use apply_patch exactly once to create artifact-probe.txt with exactly one line: ${marker}. Use this exact patch argument, without extra arguments:\n${patch}\nDo not call any other tools or use absolute paths. Then reply DONE. The marker must remain remembered after context compaction.`)
    check(await readFile(join(dataRoot, 'artifact-probe.txt'), 'utf8') === marker + '\n', 'PATCH_CONTENT')
    await turn('Without using tools, confirm that you remember the marker written earlier. This second turn tests native context compaction. Reply READY only.')
  } else {
    await turn('The test process has restarted. Without calling any tools, reply only with the exact marker written in the earlier turn, using restored conversation history.')
    const last = agent.session.snapshotEvents().filter(e => e.type === 'assistant/message').at(-1)?.data.message
    const text = last?.content?.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
    receipt.markerRecalled = text.trim() === marker
    check(receipt.markerRecalled, 'MARKER_NOT_RECALLED')
    check(receipt.restoredCheckpointInRequest, 'CHECKPOINT_NOT_SENT_ON_RESUME')
  }
  check(calls(agent.session.snapshotEvents()).length === 1, 'TOOL_REEXECUTED')
  stage = 'flush'
  check(await context.sessions.flush(agent.session), 'FLUSH_NOT_CONFIRMED')
  await agentHandle.dispose(); agentHandle = undefined
  const stored = await inspectPersisted()
  receipt.eventCount = stored.events.length; receipt.checkpointCount = stored.checkpointCount
  receipt.checkpointHashes = stored.opaque; receipt.authorizedPatchExecutions = authorized; receipt.deniedTools = denied
  const artifacts = (await files(join(ownedHome, 'sessions'))).filter(file => file.endsWith('session.v4.jsonl.zstd'))
  check(artifacts.length === 1, 'NATIVE_ARTIFACT_COUNT')
  receipt.nativeArtifact = { encoding: 'session.v4.jsonl.zstd', bytes: (await stat(artifacts[0])).size, sha256: hash(await readFile(artifacts[0])) }
  const compat = [...context.loader.entries()].find(entry => entry.options.name === 'dsh-gpt-compat')
  await compat.fiber.dispose()
  receipt.passed = true
} catch (error) {
  receipt.errorCode = /^QUALIFIER_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'QUALIFIER_DEPENDENCY_FAILURE'
  receipt.failureStage = stage
} finally {
  receipt.authorizedPatchExecutions = authorized; receipt.deniedTools = denied
  try { await agentHandle?.dispose(); await context.fiber.dispose(); receipt.normalTeardown = true }
  catch { receipt.passed = false; receipt.teardownError = 'QUALIFIER_TEARDOWN_FAILED' }
  globalThis.fetch = originalFetch
  process.off('message', cancel)
  if (process.connected) process.disconnect()
  await writeFile(join(dataRoot, `${phase}-receipt.json`), JSON.stringify(receipt, null, 2), { flag: 'wx' })
  process.exitCode = receipt.passed ? 0 : 1
}
