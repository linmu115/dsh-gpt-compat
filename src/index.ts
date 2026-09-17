/** DSH plugin: bind compatible tool surfaces to provider/model snapshots in each agent. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Config, matches, validateConfig, withNativeBindings } from './config.ts'
import { ProcessPool } from './processes.ts'
import { installTools } from './tools.ts'
import { installContext } from './context.ts'

export { Config }
export const name = 'dsh-gpt-compat'
export const inject = ['agents', 'systemPrompt', 'tools', 'fs', 'shell', 'shellEnv', 'llm', 'sessions']
const GUIDE = 'Use apply_patch for file changes. Use exec_command for commands and write_stdin for running command sessions. Commands run in the configured DSH shell; paths and permissions belong to this workspace. Read files and include exact patch context. A session ID belongs only to this conversation. Switching away from compatible tools stops their running commands and records the final output. Keep using the other available DSH tools for skills, plugins, and external resources.'

interface State {
  agent: Agent
  fingerprint?: string
  route?: { provider?: string; model?: string }
  undo: (() => void | Promise<void>)[]
  hooks: (() => void)[]
  pool?: ProcessPool
  notices: string[]
  pendingNotice?: { message: UserMessage; count: number }
  deactivating?: Promise<void>
  targetActive?: boolean
}

/** Mount with no enabled bindings by default; settings are captured only at the next assembly. */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  if (ctx.systemPrompt.supportsPreparation !== true) throw new Error('dsh-gpt-compat requires the DSH pre-assembly preparation extension')
  let source = () => config
  const effective = () => withNativeBindings(source(), ctx.llm.listConfigurableProviders())
  installContext(ctx, effective)
  let closing = false
  const states = new Map<Agent, State>()
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.settings.installSection(ctx, 'gpt-compat', Config, config, {
      validate: validateConfig, setSource: current => { source = current }, onChange() {},
    })
  })
  const deactivate = (state: State): Promise<void> => {
    if (state.deactivating) return state.deactivating
    state.deactivating = (async () => {
      if (state.pool) state.notices.push(...await state.pool.close())
      state.pool = undefined
      for (const dispose of state.undo.splice(0).reverse()) await dispose()
      state.fingerprint = undefined
    })().finally(() => { state.deactivating = undefined })
    return state.deactivating
  }
  const ensure = (agent: Agent): State => {
    const prior = states.get(agent)
    if (prior) return prior
    const state: State = { agent, undo: [], hooks: [], notices: [] }
    states.set(agent, state)
    agent.ctx.effect(() => async () => {
      await deactivate(state)
      for (const dispose of state.hooks.splice(0)) dispose()
      states.delete(agent)
    }, 'gpt-compat agent cleanup')
    state.hooks.push(agent.ctx.on('agent/pre-step', async (_payload, next) => {
      const result = await next()
      if (result.kind === 'reject' || !state.notices.length) return result
      state.pendingNotice ??= { count: state.notices.length, message: createUserMessage({
        content: [{ type: 'text', text: state.notices.join('\n\n') }],
        source: { kind: 'plugin', plugin: name, form: 'notice', summary: 'Compatibility command sessions stopped after model/settings switch' },
      }) }
      return { ...result, messages: [...result.messages, state.pendingNotice.message] }
    }))
    state.hooks.push(agent.ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message' && event.data.id === state.pendingNotice?.message.id) {
        state.notices.splice(0, state.pendingNotice.count)
        state.pendingNotice = undefined
      }
    }))
    return state
  }
  ctx.on('system-prompt/prepare', async context => {
    const agent = context.agent
    if (!agent || !context.signal || context.preview) return
    if (closing) throw new Error('Compatibility plugin is unloading')
    const state = ensure(agent)
    const current = structuredClone(effective())
    const route = context.route
    const active = matches(current, route?.provider, route?.model)
    state.targetActive = active
    const fingerprint = active ? JSON.stringify(current) : undefined
    state.route = route && { ...route }
    if (state.fingerprint === fingerprint) return
    await deactivate(state)
    context.signal.throwIfAborted()
    if (closing) throw new Error('Compatibility plugin is unloading')
    if (!active) return
    const hidden = current.hiddenTools.filter(tool => ctx.tools.get(tool, agent) !== undefined)
    try {
      if (hidden.length) state.undo.push(agent.ctx.tools.restrict({ deny: hidden }))
      state.undo.push(agent.ctx.tools.presentAs('native'))
      const scoped = await agent.ctx.plugin({ name: 'gpt-compat-agent-tools', inject: ['tools', 'systemPrompt', 'fs', 'shell', 'shellEnv'], apply(owner: Context) {
        const pool = new ProcessPool(owner.shell, current)
        state.pool = pool
        state.undo.push(...installTools(owner, agent, current, pool))
        state.undo.push(owner.systemPrompt.section({ name: 'gpt-compat:tools', order: 1050, text: () => [
          GUIDE,
          'Commands receive DSH_HOME, DSH_SESSION_ID and DSH_SHELL from DSH. Use the configured shell syntax to read environment variables.',
          ...owner.shellEnv.list().map(variable => `${variable.key}: ${variable.description}`),
        ].join('\n') }))
      } })
      state.undo.push(() => scoped.dispose())
      context.signal.throwIfAborted()
      if (closing) throw new Error('Compatibility plugin is unloading')
      state.fingerprint = fingerprint
    } catch (error) { await deactivate(state); throw error }
  })
  ctx.on('agent/request', async ({ agent }, next) => {
    const route = await next()
    const state = states.get(agent)
    if (state?.fingerprint && (route.provider !== state.route?.provider || route.model !== state.route?.model)) {
      throw new Error('Request route changed after compatible tools were assembled; retry at the next step boundary')
    }
    return route
  }, { prepend: true })
  ctx.effect(() => async () => {
    closing = true
    const current = [...states.values()]
    for (const state of current) if (state.fingerprint || state.targetActive) state.agent.cancel({ kind: 'hook', reason: 'GPT compatibility plugin unloaded' }, { keepInbox: true })
    await Promise.all(current.map(async state => {
      await state.agent.whenIdle()
      await deactivate(state)
      if (state.notices.length && ctx.agents.get(state.agent.id) === state.agent) {
        state.agent.inject(createUserMessage({
          content: [{ type: 'text', text: state.notices.splice(0).join('\n\n') }],
          source: { kind: 'plugin', plugin: name, form: 'notice', summary: 'Compatibility command sessions stopped on plugin unload' },
        }))
      }
      for (const dispose of state.hooks) dispose()
    }))
    states.clear()
  }, 'gpt-compat teardown')
}
