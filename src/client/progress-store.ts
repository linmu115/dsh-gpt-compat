import { useSyncExternalStore } from 'react'
import type { ProgressData } from '../progress.ts'

const empty = { value: null as ProgressData | null, disconnected: false, elapsed: 0 }
// A single connection per mounted Session, shared by the draft and all durable
// operation rows. History length must not multiply polling requests.
const sessions = new Map<string, ReturnType<typeof createStore>>()
function createStore(sessionId: string) {
  let snapshot = empty, abort: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const poll = async (controller: AbortController) => {
    try {
      const response = await fetch('/api/gpt-compat.progress', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }), signal: controller.signal })
      if (!response.ok) throw new Error('Progress unavailable')
      const value = await response.json() as ProgressData | null
      if (controller.signal.aborted) return
      snapshot = { value, disconnected: false, elapsed: value ? Math.max(0, Math.floor((Date.now() - value.startedAt) / 1000)) : 0 }
    } catch {
      if (controller.signal.aborted) return
      snapshot = { ...snapshot, disconnected: true }
    }
    listeners.forEach(listener => listener())
    if (!controller.signal.aborted) timer = setTimeout(() => void poll(controller), document.visibilityState === 'hidden' ? 5000 : 1000)
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (!abort) { abort = new AbortController(); void poll(abort) }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) { abort?.abort(); abort = undefined; clearTimeout(timer); snapshot = empty; sessions.delete(sessionId) }
      }
    },
  }
}
export function useProgress(sessionId: string) {
  let store = sessions.get(sessionId)
  if (!store) { store = createStore(sessionId); sessions.set(sessionId, store) }
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => empty)
}
