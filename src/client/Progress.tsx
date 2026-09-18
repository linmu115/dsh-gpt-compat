import { useEffect, useState } from 'react'
import type { ProgressData } from '../progress.ts'

export function ProgressCard({ value, elapsed, disconnected = false }: { value: ProgressData; elapsed: number; disconnected?: boolean }) {
  if (value.phase === 'sent' && value.pass === 0) return null
  const busy = !['sent', 'failed', 'cancelled'].includes(value.phase)
  const label = value.phase === 'compressing' ? `正在压缩上下文 · 第 ${value.pass} 段`
    : value.phase === 'preparing' ? '正在准备发送'
    : value.phase === 'ready' ? '上下文已就绪，正在提交消息'
    : value.phase === 'sent' ? '上下文压缩完成'
    : value.phase === 'cancelled' ? '发送已停止' : '发送未完成'
  return <section className="gpt-context-progress" aria-label="发送进度">
    {value.preview && <div className="gpt-context-preview">
      <div className="gpt-context-preview-text">{value.text || '已提交引用'}</div>
      <small>{busy ? '发送准备中' : '未发送 · 原输入已保留'}</small>
    </div>}
    <div className="gpt-context-status" role={value.phase === 'failed' ? 'alert' : 'status'} aria-live="polite">
      <span className={busy ? 'gpt-context-spinner' : 'gpt-context-done'} aria-hidden="true" />
      <span>{label}{busy && <span className="gpt-context-time" aria-hidden="true"> · {elapsed} 秒</span>}</span>
    </div>
    {busy && value.phase === 'compressing' && <p>正在整理较早的历史，本次输入和引用原文会保留。</p>}
    {value.error && <p className="gpt-context-error">{value.error}</p>}
    {disconnected && <p>进度连接暂时中断，正在重新连接；请勿重复发送。</p>}
  </section>
}

export function ContextProgress({ sessionId }: { sessionId: string }) {
  const [value, setValue] = useState<ProgressData | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [disconnected, setDisconnected] = useState(false)
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    setValue(null); setDisconnected(false)
    const poll = async () => {
      try {
        const response = await fetch('/api/gpt-compat.progress', { method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }), signal: abort.signal })
        if (!response.ok) throw new Error('Progress unavailable')
        const next = await response.json() as ProgressData | null
        if (stopped) return
        setValue(next); setDisconnected(false)
        setElapsed(next ? Math.max(0, Math.floor((Date.now() - next.startedAt) / 1000)) : 0)
      } catch { if (!stopped) setDisconnected(true) }
      finally { if (!stopped) timer = setTimeout(poll, document.visibilityState === 'hidden' ? 5000 : 1000) }
    }
    void poll()
    return () => { stopped = true; abort.abort(); clearTimeout(timer) }
  }, [sessionId])
  return value && <ProgressCard value={value} elapsed={elapsed} disconnected={disconnected} />
}
