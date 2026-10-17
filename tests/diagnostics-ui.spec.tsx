// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Diagnostics, diagnosticEn, diagnosticZh } from '../src/client/Diagnostics.tsx'
import { UsageDetails, usageEn } from '../src/client/Usage.tsx'
import { sanitizeUsage } from '../src/auxiliary-usage.ts'
import type { DiagnosticSnapshot } from '../src/diagnostics.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })
const value: DiagnosticSnapshot = { version: 1, checkedAt: 1, contextEnabled: true, bindingCount: 1, providerState: 'available',
  credential: 'not-inspected', modelRequest: 'not-performed', providers: [{ provider: 'fixture', mode: 'responses-server', models: [
    { id: 'gpt-fixture', contextWindow: 1000, maxTokens: 100, reasoningEfforts: ['high'] },
  ], capabilityEvidence: 'configured', serverCompaction: 'not-verified', responseAccounting: 'ordinary-response-includes-inline-compaction', fixedAccount: 'verified', cpa: 'running' }] }

it('shows failure then a read-only refresh with configured versus verified capability labels', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_FAILURE')).mockResolvedValueOnce(value)
  render(<Diagnostics load={load} t={key => diagnosticEn[key]} />)
  await screen.findByRole('alert')
  expect(screen.queryByText('PRIVATE_FAILURE')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: diagnosticEn.diagnosticRefresh }))
  await screen.findByText('fixture')
  expect(screen.getByText(diagnosticEn.diagnosticNotVerified)).toBeTruthy()
  expect(screen.getByText(diagnosticEn.diagnosticVerified)).toBeTruthy()
  expect(screen.getByText(diagnosticEn.diagnosticIncluded)).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(2)
  expect(screen.getAllByRole('button')).toHaveLength(1)
})

it('times out a stalled read and aborts it without an automatic retry loop', async () => {
  vi.useFakeTimers()
  let signal!: AbortSignal
  const load = vi.fn((input: AbortSignal) => { signal = input; return new Promise<DiagnosticSnapshot>(() => {}) })
  const view = render(<Diagnostics load={load} t={key => diagnosticZh[key]} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(5001) })
  expect(signal.aborted).toBe(true)
  expect(screen.getByRole('alert').textContent).toBe(diagnosticZh.diagnosticsUnavailable)
  await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
  expect(load).toHaveBeenCalledOnce()
  view.unmount()
})

it('cancels an unmounted read and renders unknown extra counters rather than zero', async () => {
  let signal!: AbortSignal
  const load = (input: AbortSignal) => { signal = input; return new Promise<DiagnosticSnapshot>(() => {}) }
  const view = render(<Diagnostics load={load} t={key => diagnosticEn[key]} />)
  view.unmount(); expect(signal.aborted).toBe(true)
  render(<UsageDetails usage={sanitizeUsage({ inputTokens: 0, outputTokens: 2 })} t={key => usageEn[key]} />)
  expect(screen.getAllByText('Unknown')).toHaveLength(4)
  expect(screen.getByText('0')).toBeTruthy()
  expect(screen.getByText(usageEn.usageSeparate)).toBeTruthy()
})
