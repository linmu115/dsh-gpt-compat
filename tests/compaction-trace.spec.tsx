// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CompactionTraceRow, compactionTraceDefinition as chat, compactionTrajectoryDefinition as trajectory } from '../src/client/Compaction.tsx'
import { ContextProgress } from '../src/client/Progress.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const operation = { type: 'context/operation', seq: 12, time: 1000, data: { kind: 'native-compact', request: { provider: 'cpa', model: 'gpt-test', instructions: 'PRIVATE', input: ['SECRET'] } } } as any
const result = { type: 'context/operation-result', seq: 13, time: 5000, data: { operation: 12, output: ['ENCRYPTED'] } } as any
function replay(events: any[]) {
  const context: any = { key: 'trace', kind: chat.kind, id: '12' }
  for (const event of events) {
    const match = chat.match(event)
    if (!match || match.id !== context.id) continue
    context.state = match.role === 'start' ? chat.start(context, { event }) : chat.update(context, { event })
  }
  return context
}
it('reconstructs completed traces from durable events after reload without leaking payloads', () => {
  const context = replay([operation, result])
  expect(chat.buildViewNode(context)).toEqual(chat.buildViewNode(replay(JSON.parse(JSON.stringify([operation, result])))))
  expect(trajectory.buildViewNode(context)).toMatchObject({ data: { kind: 'compaction', request: { status: 'complete', startedAt: 1000, completedAt: 5000 } } })
  expect(JSON.stringify(chat.buildViewNode(context))).not.toMatch(/PRIVATE|SECRET|ENCRYPTED/)
  expect(replay([operation, { ...result, data: { ...result.data, operation: 99 } }]).state.completedAt).toBeUndefined()
})
it('does not mistake an interrupted historical operation for an active or successful compaction', () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => null })))
  const context = replay([operation])
  expect(trajectory.buildViewNode(context)).toBeNull()
  render(<CompactionTraceRow sessionId="interrupted" node={{ data: context.state }} />)
  expect(screen.getByText(/未记录完成结果/)).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
})
it('shares one progress read across history rows and draft, moves draft before its event, removes it on acceptance', async () => {
  let value: any = { id: 'one', phase: 'compressing', pass: 1, text: 'Pending input', operationSeq: 12, preview: true, startedAt: Date.now(), updatedAt: Date.now() }
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => value }))
  vi.stubGlobal('fetch', fetcher)
  const context = replay([operation])
  const view = render(<><CompactionTraceRow sessionId="live" node={{ data: context.state }} /><CompactionTraceRow sessionId="live" node={{ data: { ...context.state, seq: 8 } }} /><ContextProgress sessionId="live" /></>)
  await waitFor(() => expect(screen.getAllByText('Pending input')).toHaveLength(1))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(view.container.textContent!.indexOf('Pending input')).toBeLessThan(view.container.textContent!.indexOf('正在压缩上下文'))
  value = { ...value, phase: 'sent', preview: false }
  await waitFor(() => expect(screen.queryByText('Pending input')).toBeNull(), { timeout: 2200 })
})
