// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ProgressCard } from '../src/client/Progress.tsx'
afterEach(cleanup)
const value = { id: 'one', text: 'my pending input', phase: 'compressing' as const, pass: 2, startedAt: 1, updatedAt: 1, preview: true }
it('places pending input before real compaction feedback and never invents a percentage', () => {
  const view = render(<ProgressCard value={value} elapsed={125} />)
  expect(view.container.textContent?.indexOf('my pending input')).toBeLessThan(view.container.textContent!.indexOf('正在压缩上下文'))
  expect(screen.getByRole('status').textContent).toContain('第 2 段')
  expect(view.container.textContent).not.toContain('%')
  view.rerender(<ProgressCard value={{ ...value, phase: 'sent', preview: false }} elapsed={130} />)
  expect(screen.queryByText('my pending input')).toBeNull()
})
it('keeps failure beside the pending message instead of a transient toast', () => {
  render(<ProgressCard value={{ ...value, phase: 'failed', error: 'network interrupted' }} elapsed={10} />)
  expect(screen.getByRole('alert').textContent).toContain('发送未完成')
  expect(screen.getByText('network interrupted')).toBeTruthy()
  expect(screen.getByText('未发送 · 原输入已保留')).toBeTruthy()
})
