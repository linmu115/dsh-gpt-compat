/** Test-only Cordis composition using installed JavaScript packages, without TypeScript aliases. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const [endpoint, dataRoot, phase] = process.argv.slice(2)
const live = process.env.GPT_COMPAT_LIVE_TEST === '1'
const liveV2 = live && process.env.GPT_COMPAT_LIVE_CONTEXT_MODE === 'codex-v2'
const model = live ? process.env.GPT_COMPAT_LIVE_MODEL : 'gpt-fixture'
assert(model)
const context = new Context()
context.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { FIXTURE_KEY: live ? process.env.GPT_COMPAT_LIVE_KEY : 'synthetic-only' } }]))
context.baseUrl = pathToFileURL(dataRoot).href + '/'
const packages = ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'agent-loop', 'fs-local', 'subprocess-local', 'pwsh-local', 'shell-env'].map(name => '@deepseek-ai/dsh-' + name)
packages.push('dsh-gpt-compat', 'dsh-gpt-compat/responses')
const rows = packages.map(name => ({ name, config: name === 'dsh-gpt-compat'
  ? { bindings: [{ provider: 'fixture', models: [model] }], context: { enabled: !live || liveV2, reserveTokens: 128, marginTokens: 0, ...liveV2 ? { triggerRatio: 0.1 } : {} } }
  : name === 'dsh-gpt-compat/responses' ? { providers: { fixture: { baseURL: endpoint, apiKeyEnv: 'FIXTURE_KEY', ...liveV2 ? { nativeContextMode: 'codex-v2' } : {}, models: [{ id: model, contextWindow: liveV2 ? 8000 : 32000, maxTokens: liveV2 ? 128 : 2000 }] } } }
  : {} }))
await writeFile(join(dataRoot, 'cordis.json'), JSON.stringify(rows))
try {
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = { version: 'v2', import: id => import(id) }
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dataRoot, 'cordis.json')).href } })
  await context.loader.await()
  const log = join(dataRoot, 'session.json')
  context.on('session/flush', async session => { await writeFile(log, JSON.stringify(session.snapshotEvents())) })
  const seed = phase === 'resume' ? JSON.parse(await readFile(log, 'utf8')) : undefined
  const handle = await context.agents.create({ sessionId: SessionId('artifact-session'), meta: { cwd: dataRoot },
    agentOptions: { provider: 'fixture', model }, ...seed ? { seed } : {} })
  const agent = handle.agent
  async function turn(text) {
    const idle = new Promise(resolve => {
      const dispose = context.on('agent/status', event => { if (event.agent === agent && event.status === 'idle') { dispose(); resolve() } })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await idle
    const end = agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)
    assert.equal(end?.data.reason.kind, 'completed', JSON.stringify(end))
  }
  if (phase === 'create') {
    await turn(live ? 'This is an isolated compatibility test. Use apply_patch once to create artifact-probe.txt in the current working directory with exactly one line: artifact-marker-742. Do not use other tools. Then reply DONE.' : 'CREATE-FIXTURE ' + 'a'.repeat(14000))
    assert.equal(await readFile(join(dataRoot, 'artifact-probe.txt'), 'utf8'), 'artifact-marker-742\n')
    if (!live) await turn('SECOND-TURN ' + 'b'.repeat(14000))
    if (liveV2) await turn('Without using tools, confirm the marker written earlier. This is the second synthetic test turn.')
  } else await turn(live ? 'The test process has restarted. Without calling any tools, reply only with the exact marker written in the previous turn, using conversation history.' : 'AFTER-PROCESS-RESTART')
  if (!live || liveV2) {
    assert(agent.session.snapshotEvents().some(event => event.type === 'context/checkpoint-commit'))
    assert(agent.session.requestProjection()?.adapterContext)
  }
  await context.sessions.flush(agent.session)
  const compat = [...context.loader.entries()].find(entry => entry.options.name === 'dsh-gpt-compat')
  await compat.fiber.dispose()
  assert.equal(context.agents.contextProvider(agent), undefined)
  console.log(JSON.stringify({ phase, live, checkpointCommitted: !live || liveV2, nativeProjection: !live || liveV2, ownershipReleased: true }))
} finally { await context.fiber.dispose() }
