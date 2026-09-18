import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { open, stat, unlink } from 'node:fs/promises'
import { dirname, win32 } from 'node:path'
import { connect } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { AccountError } from './cpa.ts'

export interface LocalLaunchConfig { executable: string; configFile: string; passwordFile: string }
export type LocalState = 'running' | 'stopped' | 'starting' | 'unavailable'
export interface LocalStatus { state: LocalState; canStart: boolean; issue?: string }
interface Runtime {
  probe(endpoint: string): Promise<LocalState>
  launch(config: LocalLaunchConfig): Promise<void>
  check?(config: LocalLaunchConfig): Promise<string | undefined>
}

export function normalizeLocalLaunch(config: LocalLaunchConfig): LocalLaunchConfig {
  return { executable: win32.normalize(config.executable), configFile: win32.normalize(config.configFile), passwordFile: win32.normalize(config.passwordFile) }
}
export async function checkLocalLaunch(config: LocalLaunchConfig): Promise<string | undefined> {
  if (process.platform !== 'win32') return 'localUnsupported'
  if (![config.executable, config.configFile, config.passwordFile].every(path => win32.isAbsolute(path)) || !config.executable.toLowerCase().endsWith('.exe')) return 'localConfigInvalid'
  for (const [path, issue] of [[config.executable, 'localExecutableMissing'], [config.configFile, 'localConfigMissing'], [config.passwordFile, 'localPasswordMissing']]) {
    try { if (!(await stat(path!)).isFile()) return issue }
    catch { return issue }
  }
}

// A listening port alone is not proof that CPA is ready. The public root has
// a small, stable CPA identity; account authentication is checked separately.
export async function probeLocal(endpoint: string): Promise<LocalState> {
  const url = new URL(endpoint)
  const listening = await new Promise<'open' | 'closed' | 'unknown'>(resolve => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 80) })
    const finish = (value: 'open' | 'closed' | 'unknown') => { socket.destroy(); resolve(value) }
    socket.setTimeout(1500, () => finish('unknown'))
    socket.once('connect', () => finish('open'))
    socket.once('error', error => finish((error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? 'closed' : 'unknown'))
  })
  if (listening !== 'open') return listening === 'closed' ? 'stopped' : 'unavailable'
  try {
    const response = await fetch(endpoint, { redirect: 'error', signal: AbortSignal.timeout(1500) })
    const reader = response.body?.getReader()
    if (!reader) return 'unavailable'
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 16384) return 'unavailable'
        chunks.push(part.value)
      }
      return response.ok && JSON.parse(Buffer.concat(chunks).toString()).message === 'CLI Proxy API Server' ? 'running' : 'unavailable'
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  } catch { return 'unavailable' }
}

async function launchLocal(config: LocalLaunchConfig): Promise<void> {
  const issue = await checkLocalLaunch(config)
  if (issue) throw new AccountError(issue)
  config = normalizeLocalLaunch(config)
  // Also serialize separate DSH instances sharing this CPA executable. A stale
  // lock is reported, never silently removed while another owner might launch.
  const lockPath = config.executable + '.dsh-start.lock'
  let lock
  try { lock = await open(lockPath, 'wx') }
  catch (error) { throw new AccountError((error as NodeJS.ErrnoException).code === 'EEXIST' ? 'localStarting' : 'localLaunchFailed') }
  try {
    // Detect an existing process even when it has not opened its port yet.
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference = "Stop"; $p = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:DSH_CPA_EXECUTABLE }; if ($p) { "running" }'],
    { windowsHide: true, timeout: 5000, maxBuffer: 1024, env: { ...process.env, DSH_CPA_EXECUTABLE: config.executable } })
    if (stdout.trim() === 'running') return
    const child = spawn(config.executable, ['--config', config.configFile, '--local-management-password-file', config.passwordFile], {
      cwd: dirname(config.executable), windowsHide: true, detached: true, stdio: 'ignore', shell: false,
    })
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
  } catch { throw new AccountError('localLaunchFailed') }
  finally { await lock.close(); await unlink(lockPath).catch(() => {}) }
}

export class LocalCpa {
  private pending?: Promise<LocalStatus>
  readonly endpoint: string
  constructor(endpoint: string, private config?: LocalLaunchConfig, private runtime: Runtime = { probe: probeLocal, launch: launchLocal, check: checkLocalLaunch }, private waitMs = 20000) {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new AccountError('invalidEndpoint')
    this.endpoint = url.origin
  }
  async status(): Promise<LocalStatus> {
    const state = this.pending ? 'starting' : await this.runtime.probe(this.endpoint)
    const configured = !!this.config?.executable && !!this.config.configFile && !!this.config.passwordFile
    const issue = configured && state === 'stopped' ? await this.runtime.check?.(this.config!) : undefined
    return { state, canStart: configured && !issue, ...(issue ? { issue } : {}) }
  }
  start(): Promise<LocalStatus> {
    if (this.pending) return this.pending
    this.pending = this.startOnce().finally(() => { this.pending = undefined })
    return this.pending
  }
  private async startOnce(): Promise<LocalStatus> {
    const state = await this.runtime.probe(this.endpoint)
    if (state === 'running') return { state, canStart: !!this.config?.executable }
    if (state !== 'stopped') throw new AccountError('localUnavailable')
    if (!this.config?.executable || !this.config.configFile || !this.config.passwordFile) throw new AccountError('localNotConfigured')
    await this.runtime.launch(this.config)
    const deadline = Date.now() + this.waitMs
    do {
      if (await this.runtime.probe(this.endpoint) === 'running') return { state: 'running', canStart: true }
      await sleep(300)
    } while (Date.now() < deadline)
    throw new AccountError('localStartTimeout')
  }
}
