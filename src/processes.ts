/** Agent-owned incremental command handles over DSH's shell and sandbox services. */
import { randomInt } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import type { ShellExecutor, ShellProcess } from '@deepseek-ai/dsh-shell'
import type { Config } from './config.ts'

/** Bound output by UTF-8 bytes without cutting a code point. */
export function boundText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const suffix = '\n[output truncated]'
  const bytes = Buffer.from(text).subarray(0, Math.max(0, maxBytes - Buffer.byteLength(suffix)))
  return bytes.toString('utf8').replace(/\uFFFD$/, '') + suffix
}
export class ProcessPool {
  private readonly processes = new Map<number, ShellProcess>()
  private readonly owned = new Map<number, ShellProcess>()
  private closed = false
  private readonly preparing = new Map<AbortController, Promise<void>>()
  constructor(private readonly shell: ShellExecutor, private readonly config: Config) {}

  async start(command: string, workdir: string | undefined, signal: AbortSignal, policy: Parameters<ShellExecutor['resolve']>[0]['sandboxPolicy'], yieldMs: number, dshEnv?: Parameters<ShellExecutor['resolve']>[0]['dshEnv']): Promise<string> {
    signal.throwIfAborted()
    if (this.closed) throw new Error('Command scope is closed')
    if (this.processes.size + this.preparing.size >= this.config.maxProcesses) throw new Error('Collect or cancel an existing command before starting another')
    const spec = this.shell.resolve({ command, workdir, interactive: true, onExpiry: 'none', sandboxPolicy: policy, dshEnv })
    if (!spec.interactive) throw new Error('This DSH shell does not support interactive process handles; install the host extension')
    const preparation = new AbortController()
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    this.preparing.set(preparation, finished)
    const abortPreparation = () => preparation.abort(signal.reason)
    signal.addEventListener('abort', abortPreparation, { once: true })
    if (signal.aborted) abortPreparation()
    try {
      const process = await this.shell.execute({ ...spec, signal: preparation.signal })
      // Only preparation follows the original call signal permanently. Once a
      // handle exists, collect() owns cancellation while each call is waiting.
      signal.removeEventListener('abort', abortPreparation)
      if (this.closed || signal.aborted) {
        this.stop(process); await process.done; await process.waitForExit?.();
        signal.throwIfAborted(); throw new Error('Command scope closed during preparation')
      }
      let id: number
      do { id = randomInt(1, 2147483647) } while (this.processes.has(id))
      this.processes.set(id, process)
      this.owned.set(id, process)
      this.preparing.delete(preparation); finish()
      void process.done.then(async () => {
        if (await process.waitForExit?.() !== false) this.owned.delete(id)
      }).catch(() => { /* Retain ownership so teardown reports observation failure. */ })
      try { return await this.collect(id, '', signal, yieldMs) }
      catch (error) {
        this.stop(process)
        await process.done
        await process.waitForExit?.()
        this.processes.delete(id)
        throw error
      }
    } finally {
      signal.removeEventListener('abort', abortPreparation)
      this.preparing.delete(preparation); finish()
    }
  }

  async collect(id: number, chars: string, signal: AbortSignal, yieldMs: number): Promise<string> {
    const process = this.processes.get(id)
    if (!process) throw new Error('Unknown command session in this agent')
    const cancel = () => { this.stop(process) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      if (signal.aborted) {
        this.stop(process)
        await process.done
        await process.waitForExit?.()
        this.processes.delete(id)
        signal.throwIfAborted()
      }
      if (chars === '\u0003') this.stop(process)
      else if (chars === '\u0004') process.closeStdin?.()
      else if (chars) {
        if (!process.writeStdin) throw new Error('This shell backend does not support stdin writes')
        await process.writeStdin(chars)
      }
      const wait = new AbortController()
      try {
        await Promise.race([process.done, sleep(yieldMs, undefined, { signal: wait.signal }).catch(error => {
          if (!wait.signal.aborted) throw error
        })])
      } finally { wait.abort() }
      if (signal.aborted) {
        await process.done
        await process.waitForExit?.()
        this.processes.delete(id)
        signal.throwIfAborted()
      }
      const output = process.readOutput()
      const running = process.status === 'running'
      if (!running) this.processes.delete(id)
      const status = running ? `Process running with session ID ${id}` : `Process exited with code ${process.exitCode ?? 'null'}${process.signal ? ` (${process.signal})` : ''}`
      const info = output.lossy ? '\n[older output was dropped by the backend]' : ''
      const sandbox = process.sandbox?.denied ? '\n[sandbox denied the command]' : ''
      return boundText(`${status}${info}${sandbox}\nOutput:\n${output.delta}`, this.config.maxOutputBytes)
    } finally { signal.removeEventListener('abort', cancel) }
  }

  /** Stop owned processes, await settlement, and retain their final output for a switch notice. */
  async close(): Promise<string[]> {
    this.closed = true
    const preparing = [...this.preparing.values()]
    for (const controller of this.preparing.keys()) controller.abort(new Error('Command scope closed'))
    const entries = [...new Map([...this.owned, ...this.processes]).entries()]
    for (const [, process] of entries) this.stop(process)
    await Promise.all(entries.map(async ([, process]) => {
      await process.done
      await process.waitForExit?.()
    }))
    await Promise.all(preparing)
    this.processes.clear()
    this.owned.clear()
    return entries.map(([id, process]) => boundText(`Command session ${id} stopped on compatibility deactivation.\n${process.readOutput().delta}`, this.config.maxOutputBytes))
  }
  private stop(process: ShellProcess): void {
    if (process.terminate) process.terminate()
    else process.kill()
  }
}
