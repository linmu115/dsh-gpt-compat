import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { matches, type Config } from './config.ts'

export type ProgressPhase = 'preparing' | 'compressing' | 'ready' | 'sent' | 'failed' | 'cancelled'
export interface ProgressData { id: string; phase: ProgressPhase; text: string; pass: number; startedAt: number; updatedAt: number; preview: boolean; error?: string; anchorSeq?: number; operationSeq?: number }
export interface ProgressHandle {
  operation(seq: number): void
  update(phase: ProgressPhase, pass?: number): void
  finish(result: { kind: string; message?: string; userMessageId?: string }): void
}
export class SubmissionProgress {
  readonly active = new Map<Agent, ProgressHandle>()
  readonly snapshots = new Map<string, ProgressData>()
  read(sessionId: string): ProgressData | undefined {
    const value = this.snapshots.get(sessionId)
    if (value && ['sent', 'failed', 'cancelled'].includes(value.phase) && Date.now() - value.updatedAt > (value.phase === 'sent' ? 30_000 : 600_000)) { this.snapshots.delete(sessionId); return }
    return value
  }
  constructor(readonly source: () => Config) {}
  begin(agent: Agent, input: { clientSubmissionId: string; text: string }, preview = true): ProgressHandle | undefined {
    const config = this.source()
    const selected = agent.session.snapshotEvents().findLast(e => e.type === 'model/selection')
    const route = selected?.type === 'model/selection' ? selected.data : agent.options
    if (!config.context.enabled || (!matches(config, route.provider, route.model)
      && !agent.session.snapshotEvents().some(e => e.type === 'context/checkpoint' && e.data.key.startsWith('gpt-compat:')))) return
    if (this.active.has(agent)) return // A parallel retry must not own another request's progress.
    let data: ProgressData = { id: input.clientSubmissionId, phase: 'preparing', text: input.text, pass: 0, startedAt: Date.now(), updatedAt: Date.now(), preview }
    const publish = () => { data = { ...data, updatedAt: Date.now() }; this.snapshots.set(String(agent.id), data) }
    const handle: ProgressHandle = {
      operation: operationSeq => { data = { ...data, operationSeq }; publish() },
      update: (phase, pass = data.pass) => { data = { ...data, phase, pass }; publish() },
      finish: result => {
        if (this.active.get(agent) !== handle) return
        const event = result.userMessageId && agent.session.snapshotEvents().find(e => e.type === 'user/message' && e.data.id === result.userMessageId)
        data = { ...data, phase: result.kind === 'success' ? 'sent' : result.kind === 'cancelled' ? 'cancelled' : 'failed',
          preview: result.kind === 'success' ? false : data.preview,
          ...(event ? { anchorSeq: event.seq } : {}), ...(result.message ? { error: result.message } : {}) }
        publish(); this.active.delete(agent)
      },
    }
    this.active.set(agent, handle); publish(); return handle
  }
}
declare module '@deepseek-ai/cordis' { interface Context { gptSubmissionProgress: SubmissionProgress } }
export function installProgress(ctx: Context, source: () => Config): void {
  const progress = new SubmissionProgress(source)
  ctx.provide('gptSubmissionProgress', progress)
  ctx.inject(['connection'], c => {
    c.effect(() => c.connection.fetch.register({
      path: '/api/gpt-compat.progress', methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        const headers = { 'cache-control': 'no-store' }
        const raw = await request.text()
        if (raw.length > 4096) return new Response(null, { status: 400, headers })
        try {
          const value = JSON.parse(raw)
          if (typeof value.sessionId !== 'string' || value.sessionId.length > 1024) return new Response(null, { status: 400, headers })
          return Response.json(progress.read(value.sessionId) ?? null, { headers })
        } catch { return new Response(null, { status: 400, headers }) }
      },
    }))
  })
  ctx.effect(() => () => {
    for (const handle of [...progress.active.values()]) handle.finish({ kind: 'cancelled', message: '发送准备已停止，原输入仍保留。' })
  })
}
