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
  private readonly exitChecks = new Map<ShellProcess, Promise<void>>()
  private readonly verified = new WeakSet<ShellProcess>()
  private readonly stopRequested = new WeakSet<ShellProcess>()
  private closing?: Promise<string[]>
  constructor(private readonly shell: ShellExecutor, private readonly config: Config) {}

  async start(command: string, workdir: string | undefined, signal: AbortSignal, policy: Parameters<ShellExecutor['resolve']>[0]['sandboxPolicy'], yieldMs: number, dshEnv?: Parameters<ShellExecutor['resolve']>[0]['dshEnv']): Promise<string> {
    signal.throwIfAborted()
    if (this.closed) throw new Error('Command scope is closed')
    if (new Set([...this.processes.keys(), ...this.owned.keys()]).size + this.preparing.size >= this.config.maxProcesses) throw new Error('Collect or cancel an existing command before starting another')
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
      let id: number
      do { id = randomInt(1, 2147483647) } while (this.processes.has(id) || this.owned.has(id))
      // Acquire ownership even if execute resolves after cancellation or close.
      // Neither a completed parent nor a failed observer releases its range.
      this.processes.set(id, process)
      this.owned.set(id, process)
      this.preparing.delete(preparation); finish()
      if (this.closed || signal.aborted) {
        await this.stopAndVerify(id, process)
        this.processes.delete(id)
        signal.throwIfAborted(); throw new Error('Command scope closed during preparation')
      }
      try { return await this.collect(id, '', signal, yieldMs) }
      catch (error) {
        try { await this.stopAndVerify(id, process) }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Command call failed and process exit could not be verified') }
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
        await this.stopAndVerify(id, process)
        this.processes.delete(id)
        signal.throwIfAborted()
      }
      if (chars === '\u0003') this.stop(process)
      else if (chars === '\u0004') process.closeStdin?.()
      else if (chars) {
        if (!process.writeStdin) throw new Error('This shell backend does not support stdin writes')
        await process.writeStdin(chars)
      }
      const deadline = performance.now() + yieldMs
      const wait = new AbortController()
      try {
        await Promise.race([process.done, sleep(yieldMs, undefined, { signal: wait.signal }).catch(error => {
          if (!wait.signal.aborted) throw error
        })])
      } finally { wait.abort() }
      if (signal.aborted) {
        await this.stopAndVerify(id, process)
        this.processes.delete(id)
        signal.throwIfAborted()
      }
      const running = process.status === 'running'
      let exited = false
      if (!running) {
        // Parent completion is not range completion. Ordinary collection must
        // still return a handle within its yield budget while descendants live.
        const observation = new AbortController()
        try {
          exited = await Promise.race([
            this.verifyExit(id, process).then(() => true),
            sleep(Math.max(0, deadline - performance.now()), false, { signal: observation.signal }).catch(error => {
              if (!observation.signal.aborted) throw error
              return false
            }),
          ])
        } finally { observation.abort() }
        if (signal.aborted) {
          await this.stopAndVerify(id, process)
          this.processes.delete(id)
          signal.throwIfAborted()
        }
        if (exited) this.processes.delete(id)
      }
      const output = process.readOutput()
      const status = running ? `Process running with session ID ${id}` : exited
        ? `Process exited with code ${process.exitCode ?? 'null'}${process.signal ? ` (${process.signal})` : ''}`
        : `Process closing with session ID ${id} (process range exit not yet verified)`
      const info = output.lossy ? '\n[older output was dropped by the backend]' : ''
      const sandbox = process.sandbox?.denied ? '\n[sandbox denied the command]' : ''
      return boundText(`${status}${info}${sandbox}\nOutput:\n${output.delta}`, this.config.maxOutputBytes)
    } finally { signal.removeEventListener('abort', cancel) }
  }

  /** Stop owned processes, await settlement, and retain their final output for a switch notice. */
  close(): Promise<string[]> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this.closeOwned().finally(() => { this.closing = undefined })
    return this.closing
  }
  private async closeOwned(): Promise<string[]> {
    const preparing = [...this.preparing.values()]
    for (const controller of this.preparing.keys()) controller.abort(new Error('Command scope closed'))
    // Start cleanup now, then join preparation and include every late handle.
    // allSettled prevents one failed range from abandoning the other owners.
    const initial = [...new Map([...this.owned, ...this.processes]).entries()]
    const settling = Promise.allSettled(initial.map(([id, process]) => this.stopAndVerify(id, process)))
    await Promise.all(preparing)
    const entries = [...new Map([...this.owned, ...this.processes]).entries()]
    const initialIds = new Set(initial.map(([id]) => id))
    const late = await Promise.allSettled(entries.filter(([id]) => !initialIds.has(id)).map(([id, process]) => this.stopAndVerify(id, process)))
    const results = [...await settling, ...late]
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason)
    if (errors.length) throw new AggregateError(errors, 'Command scope close failed: process exit could not be verified; ownership retained')
    const notices = entries.map(([id, process]) => boundText(`Command session ${id} stopped on compatibility deactivation.\n${process.readOutput().delta}`, this.config.maxOutputBytes))
    this.processes.clear()
    this.owned.clear()
    return notices
  }
  private async stopAndVerify(id: number, process: ShellProcess): Promise<void> {
    this.stop(process)
    await this.verifyExit(id, process)
  }
  private verifyExit(id: number, process: ShellProcess): Promise<void> {
    if (this.verified.has(process)) return Promise.resolve()
    const pending = this.exitChecks.get(process)
    if (pending) return pending
    const check = (async () => {
      await process.done
      if (!process.waitForExit) throw new Error(`Command session ${id} has no process exit observer`)
      if (await process.waitForExit() !== true) throw new Error(`Command session ${id} process exit is not verified`)
      this.verified.add(process)
      this.owned.delete(id)
    })().finally(() => { this.exitChecks.delete(process) })
    this.exitChecks.set(process, check)
    return check
  }
  private stop(process: ShellProcess): void {
    if (this.verified.has(process) || this.stopRequested.has(process)) return
    if (process.terminate) process.terminate()
    else process.kill()
    this.stopRequested.add(process)
  }
}
