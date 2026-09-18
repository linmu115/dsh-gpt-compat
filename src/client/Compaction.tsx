import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { useProgress } from './progress-store.ts'
import { ProgressCard } from './Progress.tsx'

// Structural public event contribution contract also works with RC2 hosts whose
// generated declaration bundle does not yet export ui-conversation/client.
interface TraceContext { key: string; kind: string; id: string; state?: CompactionTrace }
interface TraceDefinition {
  kind: string; target: string
  match(event: SessionEvent): { id: string; role: 'start' | 'update' } | null
  start(context: TraceContext, match: { event: SessionEvent }): CompactionTrace
  update(context: TraceContext & { state: CompactionTrace }, match: { event: SessionEvent }): CompactionTrace
  buildViewNode(context: TraceContext): object | null
}

export interface CompactionTrace {
  seq: number
  startedAt: number
  completedAt?: number
  resultSeq?: number
  method: 'native-compact' | 'portable-summary'
  provider?: string
  model?: string
}

// Reconstruct only display metadata. Never put requests, cited notes, summaries,
// or opaque provider compaction payloads into the renderer's view state.
export const compactionTraceDefinition: TraceDefinition = {
  kind: 'gpt-context-operation', target: 'chat',
  match(event) {
    if (event.type === 'context/operation') return { id: String(event.seq), role: 'start' }
    if (event.type === 'context/operation-result') return { id: String(event.data.operation), role: 'update' }
    return null
  },
  start(_context, { event }) {
    if (event.type !== 'context/operation') throw new Error('Expected context operation')
    const request = event.data.request as Record<string, unknown>
    return { seq: event.seq, startedAt: event.time, method: event.data.kind,
      ...(typeof request.provider === 'string' ? { provider: request.provider } : {}),
      ...(typeof request.model === 'string' ? { model: request.model } : {}) }
  },
  update({ state }, { event }) {
    return event.type === 'context/operation-result'
      ? { ...state, completedAt: event.time, resultSeq: event.seq } : state
  },
  buildViewNode(context) {
    return context.state ? { key: context.key, kind: context.kind, id: context.id,
      target: 'chat', anchorSeq: context.state.seq, location: { kind: 'session' },
      visibility: 'visible', data: context.state } : null
  },
}

// Feed successful provider operations into the host's existing trajectory
// compaction renderer. An unmatched start is not evidence of a running request
// after a restart, so its neutral record is shown in Chat only.
export const compactionTrajectoryDefinition: TraceDefinition = {
  ...compactionTraceDefinition, kind: 'gpt-context-trajectory', target: 'trajectory',
  buildViewNode(context) {
    const state = context.state
    if (!state || state.completedAt === undefined) return null
    return { key: context.key, kind: context.kind, id: context.id, target: 'trajectory',
      anchorSeq: state.seq, location: { kind: 'session' }, data: { kind: 'compaction', request: {
        purpose: 'compaction', turn: null, step: 0, startSeq: state.seq,
        startedAt: state.startedAt, completedAt: state.completedAt, status: 'complete', resultSeq: state.resultSeq,
        ...(state.provider && state.model ? { provenance: { provider: state.provider, model: state.model } } : {}),
      } } }
  },
}

export function CompactionTraceRow({ node, sessionId }: { node: { data: CompactionTrace }; sessionId: string }) {
  const value = node.data
  const progress = useProgress(sessionId)
  const live = progress.value?.operationSeq === value.seq && progress.value.phase !== 'sent' ? progress.value : null
  const complete = value.completedAt !== undefined
  return <>
    {live && <ProgressCard value={live} elapsed={progress.elapsed} disconnected={progress.disconnected} />}
    <details className="gpt-context-trace">
    <summary>{complete ? '上下文压缩已完成' : '上下文压缩记录'}
      {complete && <span className="gpt-context-time"> · {Math.max(0, Math.round((value.completedAt! - value.startedAt) / 1000))} 秒</span>}
    </summary>
    <div>
      <p>{value.method === 'native-compact' ? 'GPT 原生压缩' : '历史摘要压缩'}{value.model ? ` · ${value.model}` : ''}</p>
      <p>{complete ? '此段历史压缩已返回结果。' : live?.phase === 'compressing' ? '正在等待此段历史压缩结果。' : '未记录完成结果；此记录不表示压缩仍在运行。'}</p>
      <p>仅整理较早的历史，本次输入和引用原文仍按发送流程保留。</p>
    </div>
  </details></>
}

export function installCompactionTrace(ctx: Context): void {
  ctx.inject(['uiConversation'], c => {
    const conversation = (c as unknown as { uiConversation: { events: { register(value: TraceDefinition): unknown } } }).uiConversation
    conversation.events.register(compactionTraceDefinition)
    conversation.events.register(compactionTrajectoryDefinition)
    const slots = c.slots as unknown as { inject(name: string, register: () => (() => void)): unknown; register(options: Record<string, unknown>, component: unknown): () => void }
    slots.inject('conversation.chat.node', () => slots.register({ name: 'conversation.chat.node',
      key: 'gpt-context-operation', id: 'gpt-context-operation' }, CompactionTraceRow))
  })
}
