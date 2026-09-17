import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { ToolCallId, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { assembleContextFor, installModelSelection, type Agent, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import Pwsh from '@deepseek-ai/dsh-pwsh-local'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import * as Compat from '../src/index.ts'
import * as Responses from '../src/responses.ts'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { completed, serve, sse, textItem } from './responses-server.ts'
import { MockAdapter, textResponse, toolCallResponse } from '@dsh-test/mock-adapter'
import { originalHistory } from '../src/context.ts'

let ctx: Context | undefined
let root: string | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function setup(adapter: MockAdapter, responsesURL?: string, managedContext = false) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-gpt-compat-')))
  ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { GPT_COMPAT_TEST_KEY: 'local-test-key' } }]))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['llm', LlmRuntime], ['sessions', SessionStore], ['projection', SessionProjectionRegistry],
    ['prompt', SystemPrompt], ['tools', ToolRuntime], ['agents', AgentRegistry], ['loop', AgentLoop],
    ['fs', LocalFileSystem], ['subprocess', LocalSubprocess], ['shell', Pwsh], ['shell-env', ShellEnv], ['compat', Compat],
  ])
  if (responsesURL) modules.set('responses', Responses)
  ctx.loader.internal = { version: 'v2', async import(id: string) {
    if (!modules.has(id)) throw new Error(`Unexpected module: ${id}`)
    return modules.get(id)
  } } as NonNullable<typeof ctx.loader.internal>
  const yaml = [...modules.keys()].map(id => `- id: ${id}\n  name: ${id}${id === 'compat' ? '\n  config:\n    bindings:\n      - provider: mock\n        models: [gpt-test]' : id === 'responses' ? `\n  config:\n    providers:\n      mock:\n        baseURL: ${responsesURL}\n        apiKeyEnv: GPT_COMPAT_TEST_KEY\n        models:\n          - id: gpt-test\n            contextWindow: 32000\n            maxTokens: 2000` : ''}`).join('\n')
  const path = join(root, 'cordis.yml')
  await writeFile(path, managedContext ? yaml.replace('    bindings:', '    context:\n      enabled: true\n      reserveTokens: 128\n      marginTokens: 0\n      summaryMaxTokens: 256\n    bindings:') : yaml)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  ctx.llm.registerAdapter(responsesURL ? ['other'] : ['mock', 'other'], adapter)
  ctx.tools.register(defineContentToolFixture({ name: 'write', description: 'legacy', parameters: {}, execute: async () => [{ type: 'text', text: 'legacy ran' }] }))
  if (managedContext) ctx.on('session/flush', async session => { await writeFile(join(root!, `${session.id}.json`), JSON.stringify(session.snapshotEvents())) })
  return ctx
}

it('loads the native provider via cordis.yml, executes freeform patches, persists replay, and isolates foreign routes', async () => {
  let calls = 0
  const native = [
    { type: 'reasoning', id: 'rs_loader', summary: [], encrypted_content: 'loader-opaque' },
    { type: 'custom_tool_call', id: 'ct_loader', call_id: 'loader_patch', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: native.txt\n+原生补丁\n*** End Patch', status: 'completed' },
  ]
  const server = await serve((_body, response) => sse(response, completed(calls++ === 0 ? native : [textItem('done')], `resp_${calls}`)))
  try {
    const foreign = new MockAdapter([textResponse('foreign')])
    const context = await setup(foreign, server.url)
    const a = await agent(context, 'native-wire')
    await turn(context, a.value, 'create file')
    expect(await readFile(join(root!, 'native.txt'), 'utf8')).toBe('原生补丁\n')
    expect(server.requests).toHaveLength(2)
    expect(server.requests[0]!.body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'custom', name: 'apply_patch' })]))
    expect(server.requests[1]!.body.input).toEqual(expect.arrayContaining([...native, expect.objectContaining({ type: 'custom_tool_call_output', call_id: 'loader_patch' })]))
    const persisted = a.value.session.snapshotEvents()
    expect(JSON.stringify(persisted)).toContain('loader-opaque')
    const logPath = join(root!, 'native-session.json')
    await writeFile(logPath, JSON.stringify(persisted))
    const restored = Session.create(SessionId('native-restored'), JSON.parse(await readFile(logPath, 'utf8')))
    for await (const _chunk of context.llm.stream({ provider: 'mock', model: 'gpt-test', messages: restored.deriveMessages() })) { /* consume rebuilt history */ }
    expect(JSON.stringify(server.requests.at(-1)?.body.input)).toContain('loader-opaque')
    const before = persisted.filter(event => event.type === 'tool/result').length
    a.selection.current = { provider: 'other', model: 'gpt-test' }
    await turn(context, a.value, 'continue elsewhere')
    expect(JSON.stringify(foreign.requests.at(-1)?.messages)).not.toContain('loader-opaque')
    expect(a.value.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(before)
    a.selection.current = { provider: 'mock', model: 'gpt-test' }
    await turn(context, a.value, 'back to gpt')
    expect(JSON.stringify(server.requests.at(-1)?.body.input)).toContain('loader-opaque')
    const entry = [...context.loader.entries()].find(entry => entry.options.id === 'responses')
    expect(entry).toBeDefined()
    await entry!.fiber!.dispose()
    await expect(context.llm.prepareCall({ provider: 'mock', model: 'gpt-test' })).rejects.toThrow('no adapter')
  } finally { await server.close() }
})

async function agent(context: Context, id: string, provider = 'mock') {
  const selection: ModelSelectionRef = { current: { provider, model: 'gpt-test' }, assembled: undefined }
  const value = await context.agents.create({ sessionId: SessionId(id), meta: { cwd: root },
    agentOptions: { provider, model: 'gpt-test' }, setup: scope => { installModelSelection(scope, selection) },
  })
  return { value: value.agent, selection }
}

class ContextAdapter extends MockAdapter {
  capacity = 1_000_000
  constructor() { super([]) }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, context: { contextWindow: this.capacity }, defaultMaxTokens: 128 }
  }
  override async * stream(options: GenerateOptions) {
    this.requests.push(options)
    yield* textResponse(options.purpose === 'compaction' ? 'portable summary of earlier work' : 'foreign done')
  }
}

async function contextServer() {
  let pass = 0
  return serve((body, response, path) => {
    if (path.endsWith('/input_tokens')) {
      const input_tokens = JSON.stringify({ input: body.input, tools: body.tools }, (key, value) => key === 'encrypted_content' ? 'opaque' : value).length
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens }))
    } else if (path.endsWith('/compact')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ output: [
        { role: 'user', content: [{ type: 'input_text', text: 'retained by compactor' }] },
        { type: 'compaction', id: `cp_${++pass}`, encrypted_content: 'opaque-checkpoint-' + 'x'.repeat(80_000) },
      ] }))
    } else sse(response, completed([textItem('native done')]))
  })
}

it('keeps independent checkpoints across routes, durable reload, and compatibility unload', async () => {
  const server = await contextServer()
  try {
    const foreign = new ContextAdapter()
    const context = await setup(foreign, server.url, true)
    const a = await agent(context, 'dual-context')
    const first = 'FIRST-FACT-' + 'a'.repeat(14000), second = 'SECOND-FACT-' + 'b'.repeat(14000)
    await turn(context, a.value, first)
    await turn(context, a.value, second)
    expect(server.requests.filter(request => request.path.endsWith('/compact'))).toHaveLength(1)
    const nativeRequest = server.requests.filter(request => request.path.endsWith('/responses')).at(-1)!
    expect(JSON.stringify(nativeRequest.body.input)).toContain('opaque-checkpoint-')
    expect(JSON.stringify(nativeRequest.body.input).match(/retained by compactor/g)).toHaveLength(1)
    expect(JSON.stringify(originalHistory(a.value.session))).toContain(first)
    const initialNative = a.value.session.snapshotEvents().filter(event => event.type === 'context/checkpoint' && event.data.key.includes(':native:'))
    expect(initialNative).toHaveLength(1)
    a.selection.current = { provider: 'other', model: 'gpt-test' }
    await turn(context, a.value, 'continue on a larger model')
    expect(foreign.requests.some(request => request.purpose === 'compaction')).toBe(false)
    expect(foreign.requests.at(-1)?.adapterContext).toBeUndefined()
    expect(JSON.stringify(foreign.requests.at(-1)?.messages)).toContain(first)
    expect(JSON.stringify(foreign.requests.at(-1)?.messages)).not.toContain('opaque-checkpoint-')
    foreign.capacity = 50000
    await turn(context, a.value, 'THIRD-FACT-' + 'c'.repeat(25000))
    expect(foreign.requests.filter(request => request.purpose === 'compaction')).toHaveLength(1)
    expect(JSON.stringify(foreign.requests.at(-1)?.messages)).toContain('portable summary of earlier work')
    expect(a.value.session.snapshotEvents().filter(event => event.type === 'context/checkpoint' && event.data.key.includes(':native:'))).toEqual(initialNative)
    a.selection.current = { provider: 'mock', model: 'gpt-test' }
    await turn(context, a.value, 'back to GPT')
    expect(server.requests.filter(request => request.path.endsWith('/compact')).length).toBeGreaterThan(1)
    const back = server.requests.filter(request => request.path.endsWith('/responses')).at(-1)!
    expect(JSON.stringify(back.body.input)).not.toContain('portable summary of earlier work')
    expect(JSON.stringify(back.body.input)).toContain('opaque-checkpoint-')
    const disk = JSON.parse(await readFile(join(root!, 'dual-context.json'), 'utf8'))
    const selection: ModelSelectionRef = { current: { provider: 'mock', model: 'gpt-test' }, assembled: undefined }
    const restored = await context.agents.create({ sessionId: SessionId('dual-reloaded'), seed: disk,
      meta: { cwd: root }, agentOptions: selection.current, setup: scope => { installModelSelection(scope, selection) } })
    await turn(context, restored.agent, 'continue after reload')
    expect(JSON.stringify(server.requests.filter(request => request.path.endsWith('/responses')).at(-1)!.body.input)).toContain('opaque-checkpoint-')
    expect(JSON.stringify(originalHistory(restored.agent.session))).toContain('THIRD-FACT-')
    const compat = [...context.loader.entries()].find(entry => entry.options.name === 'compat')!
    await compat.fiber!.dispose()
    expect(context.agents.contextProvider(a.value)).toBeUndefined()
    a.selection.current = { provider: 'other', model: 'gpt-test' }
    foreign.capacity = 1_000_000
    await turn(context, a.value, 'continue without compatibility')
    expect(a.value.session.requestProjection()).toEqual({ messages: null })
    expect(JSON.stringify(foreign.requests.at(-1)?.messages)).toContain(first)
  } finally { await server.close() }
}, 30_000)

it('does not publish a checkpoint or dispatch a model request when candidate persistence fails', async () => {
  const server = await contextServer()
  try {
    const context = await setup(new ContextAdapter(), server.url, true)
    const a = await agent(context, 'failed-checkpoint')
    await turn(context, a.value, 'a'.repeat(14000))
    const stop = context.on('session/flush', session => {
      if (session.snapshotEvents().some(event => event.type === 'context/checkpoint')) throw new Error('disk fixture failure')
    })
    await expect(turn(context, a.value, 'b'.repeat(14000))).rejects.toThrow('disk fixture failure')
    expect(a.value.session.snapshotEvents().filter(event => event.type === 'context/checkpoint-commit')).toHaveLength(0)
    expect(server.requests.filter(request => request.path.endsWith('/responses'))).toHaveLength(1)
    expect(JSON.stringify(originalHistory(a.value.session))).toContain('b'.repeat(14000))
    stop()
    await turn(context, a.value, 'retry after disk recovery')
    expect(a.value.session.snapshotEvents().filter(event => event.type === 'context/checkpoint-commit')).toHaveLength(1)
  } finally { await server.close() }
}, 30_000)

it('fails without losing raw history when the proxy has no native token counter', async () => {
  const server = await serve((_body, response) => response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"code":"not_found"}}'))
  try {
    const context = await setup(new ContextAdapter(), server.url, true)
    const a = await agent(context, 'missing-counter')
    await expect(turn(context, a.value, 'keep this original fact')).rejects.toThrow()
    expect(server.requests.every(request => request.path.endsWith('/input_tokens'))).toBe(true)
    expect(JSON.stringify(originalHistory(a.value.session))).toContain('keep this original fact')
    expect(a.value.session.snapshotEvents().some(event => event.type === 'context/checkpoint-commit')).toBe(false)
  } finally { await server.close() }
})

it('cancels an in-flight compaction without committing or issuing generation', async () => {
  let arrived!: () => void
  const compactStarted = new Promise<void>(resolve => { arrived = resolve })
  const server = await serve((body, response, path) => {
    if (path.endsWith('/input_tokens')) response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens: JSON.stringify(body.input).length }))
    else if (path.endsWith('/compact')) arrived()
    else sse(response, completed([textItem('done')]))
  })
  try {
    const context = await setup(new ContextAdapter(), server.url, true)
    const a = await agent(context, 'cancel-context')
    await turn(context, a.value, 'a'.repeat(14000))
    const running = turn(context, a.value, 'b'.repeat(14000))
    await compactStarted
    a.value.cancel({ kind: 'hook', reason: 'cancel fixture' })
    await running
    expect(a.value.session.snapshotEvents().some(event => event.type === 'context/checkpoint-commit')).toBe(false)
    expect(server.requests.filter(request => request.path.endsWith('/responses'))).toHaveLength(1)
    expect(JSON.stringify(originalHistory(a.value.session))).toContain('b'.repeat(14000))
  } finally { await server.close() }
}, 15_000)

it('rejects opaque context at the runtime boundary before a foreign adapter sees it', async () => {
  const foreign = new ContextAdapter()
  const context = await setup(foreign)
  const call = await context.llm.prepareCall({ provider: 'other', model: 'gpt-test' })
  const chunks = []
  for await (const chunk of call.stream({ ...call.config, messages: [], adapterContext: { format: 'dsh-gpt-responses/v1', scope: 'wrong-origin', input: [] } })) chunks.push(chunk)
  expect(JSON.stringify(chunks)).toContain('INVALID_NATIVE_CONTEXT')
  expect(foreign.requests).toHaveLength(0)
})

it('refuses dispatch if source history changes while the request selection is being persisted', async () => {
  const server = await contextServer()
  try {
    const context = await setup(new ContextAdapter(), server.url, true)
    const a = await agent(context, 'selection-persist-race')
    let injected = false
    context.on('session/flush', session => {
      if (!injected && session.snapshotEvents().at(-1)?.type === 'request/projection') {
        injected = true
        session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'new source fact' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      }
    })
    await expect(turn(context, a.value, 'original fact')).rejects.toThrow('source history changed during persistence')
    expect(server.requests.filter(request => request.path.endsWith('/responses'))).toHaveLength(0)
    await turn(context, a.value, 'retry against current history')
    expect(JSON.stringify(server.requests.filter(request => request.path.endsWith('/responses')).at(-1)!.body.input)).toContain('new source fact')
  } finally { await server.close() }
})

async function turn(context: Context, value: Agent, text: string) {
  const idle = new Promise<void>(resolve => {
    const dispose = context.on('agent/status', ({ agent, status }) => {
      if (agent === value && status === 'idle') { dispose(); resolve() }
    })
  })
  value.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await idle
  const failed = value.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)
  expect(failed, JSON.stringify(failed)).not.toMatchObject({ data: { reason: { kind: 'error' } } })
}

function execute(context: Context, value: Agent, name: string, args: unknown) {
  return context.tools.execute({ agent: value, callId: ToolCallId(crypto.randomUUID()), name, arguments: args, signal: new AbortController().signal })
}
function output(result: Awaited<ReturnType<typeof execute>>) {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

it('loads a real cordis.yml, writes through the agent loop, isolates routes, and switches tools at the next step', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('patch1', 'apply_patch', { patch: '*** Begin Patch\n*** Add File: hello.txt\n+你好\n*** End Patch' }),
    textResponse('done'), textResponse('other'), textResponse('switched'),
  ])
  const context = await setup(adapter)
  const a = await agent(context, 'a')
  const b = await agent(context, 'b', 'other')
  await turn(context, a.value, 'create file')
  expect(await readFile(join(root!, 'hello.txt'), 'utf8')).toBe('你好\n')
  expect(context.tools.get('write', a.value)).toBeUndefined()
  expect(context.tools.get('write', b.value)).toBeDefined()
  expect(output(await execute(context, a.value, 'write', {}))).not.toContain('legacy ran')
  await turn(context, b.value, 'other route')
  expect(context.tools.get('apply_patch', b.value)).toBeUndefined()
  a.selection.current = { provider: 'other', model: 'gpt-test' }
  // A read-only prompt preview cannot tear down the active command/tool scope.
  await context.systemPrompt.assemble(assembleContextFor(a.value))
  expect(context.tools.get('apply_patch', a.value)).toBeDefined()
  await turn(context, a.value, 'switch')
  expect(context.tools.get('apply_patch', a.value)).toBeUndefined()
  expect(context.tools.get('write', a.value)).toBeDefined()
  expect(adapter.requests.at(-1)?.provider).toBe('other')
  expect(JSON.stringify(a.value.session.snapshotEvents())).toContain('你好')
}, 30_000)

it('preflights a whole patch and supports guarded moves/deletes', async () => {
  const context = await setup(new MockAdapter([textResponse('ready')]))
  const a = await agent(context, 'patch')
  await turn(context, a.value, 'ready')
  await writeFile(join(root!, 'a.txt'), 'one\ntwo\n')
  const bad = await execute(context, a.value, 'apply_patch', { patch: '*** Begin Patch\n*** Add File: should-not-exist\n+no\n*** Update File: a.txt\n@@\n-missing\n+three\n*** End Patch' })
  expect(bad.isError).toBe(true)
  await expect(readFile(join(root!, 'should-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' })
  const move = await execute(context, a.value, 'apply_patch', { patch: '*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n@@\n one\n-two\n+three\n*** End Patch' })
  expect(move.isError).not.toBe(true)
  expect(await readFile(join(root!, 'b.txt'), 'utf8')).toBe('one\nthree\n')
  await expect(readFile(join(root!, 'a.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await execute(context, a.value, 'apply_patch', { patch: '*** Begin Patch\n*** Delete File: b.txt\n*** End Patch' })).isError).not.toBe(true)
  await expect(readFile(join(root!, 'b.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
}, 30_000)

it('passes stdin to a real PowerShell process and denies handles from another agent', async () => {
  const context = await setup(new MockAdapter([textResponse('ready'), textResponse('ready'), textResponse('switched')]))
  const a = await agent(context, 'process-a')
  const b = await agent(context, 'process-b')
  await turn(context, a.value, 'ready')
  await turn(context, b.value, 'ready')
  const identity = output(await execute(context, a.value, 'exec_command', { cmd: 'Write-Output "session=$env:DSH_SESSION_ID shell=$env:DSH_SHELL"', yield_time_ms: 10000 }))
  expect(identity).toContain('session=process-a shell=1')
  const started = output(await execute(context, a.value, 'exec_command', { cmd: '$line = [Console]::ReadLine(); Write-Output "received:$line"', yield_time_ms: 0 }))
  const id = Number(started.match(/session ID (\d+)/)?.[1])
  expect(id).toBeGreaterThan(0)
  expect((await execute(context, b.value, 'write_stdin', { session_id: id })).isError).toBe(true)
  const result = output(await execute(context, a.value, 'write_stdin', { session_id: id, chars: 'hello\n', yield_time_ms: 10000 }))
  expect(result).toContain('received:hello')
  expect(result).toContain('Process exited with code 0')
  const waiting = output(await execute(context, a.value, 'exec_command', { cmd: 'Write-Output "before-switch"; Start-Sleep -Seconds 120', yield_time_ms: 1000 }))
  expect(waiting).toContain('session ID')
  a.selection.current = { provider: 'other', model: 'gpt-test' }
  await turn(context, a.value, 'switch')
  expect(JSON.stringify(a.value.session.snapshotEvents())).toContain('stopped on compatibility deactivation')
}, 30_000)

it('unloads and reloads while commands are alive, restores legacy tools, and keeps the stop notice', async () => {
  const context = await setup(new MockAdapter([textResponse('ready'), textResponse('continued'), textResponse('reloaded')]))
  const a = await agent(context, 'reload')
  await turn(context, a.value, 'ready')
  const running = output(await execute(context, a.value, 'exec_command', { cmd: 'Start-Sleep -Seconds 120', yield_time_ms: 0 }))
  expect(running).toContain('session ID')
  const entry = [...context.loader.entries()].find(entry => entry.options.name === 'compat')
  expect(entry?.fiber).toBeDefined()
  await entry!.fiber!.dispose()
  expect(context.tools.get('apply_patch', a.value)).toBeUndefined()
  expect(context.tools.get('write', a.value)).toBeDefined()
  await turn(context, a.value, 'continue')
  expect(JSON.stringify(a.value.session.snapshotEvents())).toContain('stopped on compatibility deactivation')
  await context.plugin(Compat, { bindings: [{ provider: 'mock', models: ['gpt-test'] }] })
  await turn(context, a.value, 'reloaded')
  expect(context.tools.get('apply_patch', a.value)).toBeDefined()
  expect(context.tools.get('write', a.value)).toBeUndefined()
}, 30_000)

it('keeps the selected model and tool set together across a concurrent settings switch', async () => {
  const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
  const context = await setup(adapter)
  const a = await agent(context, 'selection-race')
  let switched = false
  a.value.ctx.on('system-prompt/prepare', async () => {
    if (!switched) { switched = true; a.selection.current = { provider: 'other', model: 'gpt-test' } }
  })
  await turn(context, a.value, 'first')
  expect(adapter.requests[0]?.provider).toBe('mock')
  expect(context.tools.get('apply_patch', a.value)).toBeDefined()
  await turn(context, a.value, 'second')
  expect(adapter.requests[1]?.provider).toBe('other')
  expect(context.tools.get('apply_patch', a.value)).toBeUndefined()
}, 30_000)

it('retains a switch notice when admission fails before it is logged', async () => {
  const context = await setup(new MockAdapter([textResponse('ready'), textResponse('retry')]))
  const a = await agent(context, 'notice-retry')
  await turn(context, a.value, 'ready')
  await execute(context, a.value, 'exec_command', { cmd: 'Start-Sleep -Seconds 120', yield_time_ms: 0 })
  a.selection.current = { provider: 'other', model: 'gpt-test' }
  const dispose = a.value.ctx.on('agent/pre-step', async (_payload, next) => {
    await next()
    throw new Error('admission fixture refusal')
  }, { prepend: true })
  await expect(turn(context, a.value, 'switch')).rejects.toThrow('admission fixture refusal')
  dispose()
  await turn(context, a.value, 'retry')
  const notices = a.value.session.snapshotEvents().filter(event => event.type === 'user/message' && JSON.stringify(event.data).includes('stopped on compatibility deactivation'))
  expect(notices).toHaveLength(1)
}, 30_000)
