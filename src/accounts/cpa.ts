import { createHash, randomUUID } from 'node:crypto'
import type { AccountView, AccountSnapshot, AccountQuota, QuotaWindow } from './types.ts'

type Row = Record<string, unknown>
const record = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
export class AccountError extends Error { constructor(public code: string) { super(code) } }
export interface AccountCredentials { get(): Promise<string | undefined>; set(value: string): Promise<void> }
interface Account extends AccountView { index: string; name: string; accountId: string }

/** CPA remains the sole owner of OAuth tokens; this bridge only calls management APIs. */
export class CpaAccounts {
  readonly endpoint: string
  private tail: Promise<unknown> = Promise.resolve()
  private logins = new Map<string, { state: string; expires: number }>()
  constructor(endpoint: string, private credentials: AccountCredentials, private request: typeof fetch = fetch) {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AccountError('invalidEndpoint')
    this.endpoint = url.origin
  }
  private async api(path: string, method = 'GET', body?: unknown, key?: string): Promise<Row> {
    const secret = key ?? await this.credentials.get()
    if (!secret) throw new AccountError('notConfigured')
    let response: Response
    try {
      response = await this.request(this.endpoint + '/v0/management/' + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(65000),
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new AccountError('unreachable') }
    if (!response.ok) {
      await response.body?.cancel()
      throw new AccountError(response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 404 ? 'fixedUnsupported' : response.status === 409 ? 'stale' : 'cpaFailed')
    }
    // Never include upstream error bodies, request headers, or credential paths in errors.
    const reader = response.body?.getReader()
    if (!reader) throw new AccountError('invalidResponse')
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 4 * 1024 * 1024) throw new AccountError('invalidResponse')
        chunks.push(chunk.value)
      }
      return record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch { throw new AccountError('invalidResponse') }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  private async accounts(key?: string): Promise<Account[]> {
    const data = await this.api('auth-files', 'GET', undefined, key)
    if (!Array.isArray(data.files)) throw new AccountError('invalidResponse')
    const all = data.files.map(record)
    const result = all.filter(row => (row.provider || row.type) === 'codex').map(row => {
      const index = text(row.auth_index), id = text(row.id) || text(row.name)
      if (!index || !id || typeof row.disabled !== 'boolean') throw new AccountError('unsupportedAccount')
      const name = text(row.name), claims = record(row.id_token)
      return {
        id: index, index, name, accountId: text(claims.chatgpt_account_id),
        label: text(row.email) || text(row.label) || name || index,
        ...(text(row.email) ? { email: text(row.email) } : {}),
        ...(text(claims.plan_type) ? { plan: text(claims.plan_type) } : {}),
        disabled: row.disabled, unavailable: row.unavailable === true,
        canLogout: row.runtime_only !== true && row.source === 'file' && /^[^/\\]+\.json$/i.test(name)
          && all.filter(other => other.name === name).length === 1,
      }
    })
    if (new Set(result.map(a => a.id)).size !== result.length) throw new AccountError('unsupportedAccount')
    return result
  }
  private revision(accounts: Account[], selected: string): string {
    return createHash('sha256').update(JSON.stringify([selected, accounts.map(a => [a.id, a.name, a.accountId, a.disabled, a.canLogout]).sort()])).digest('hex')
  }
  private async selection(): Promise<string> {
    const data = await this.api('routing/codex-account')
    if (data.contract !== 'codex-fixed-account/v1' || typeof data.auth_index !== 'string') throw new AccountError('fixedUnsupported')
    return data.auth_index
  }
  private snapshot(accounts: Account[], selected: string): AccountSnapshot {
    return { configured: true, endpoint: this.endpoint, revision: this.revision(accounts, selected), selected,
      mode: !selected ? 'legacy' : selected === 'paused' ? 'paused' : 'fixed',
      accounts: accounts.map(({ index, name, accountId, ...view }) => view) }
  }
  async list(): Promise<AccountSnapshot> {
    if (!await this.credentials.get()) return { configured: false, endpoint: this.endpoint, revision: '', selected: '', accounts: [], mode: 'paused' }
    return this.snapshot(await this.accounts(), await this.selection())
  }
  async identity(endpoint: string): Promise<string | undefined> {
    if (new URL(endpoint).origin !== this.endpoint || !await this.credentials.get()) return undefined
    return await this.selection() || undefined
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work)
    this.tail = next.catch(() => {})
    return next
  }
  configure(key: string): Promise<AccountSnapshot> {
    return this.exclusive(async () => {
      if (!key.trim() || key.length > 4096) throw new AccountError('invalidInput')
      const accounts = await this.accounts(key.trim())
      await this.credentials.set(key.trim())
      return this.snapshot(accounts, await this.selection())
    })
  }
  private target(accounts: Account[], id: string): Account {
    const account = accounts.find(a => a.id === id)
    if (!account) throw new AccountError('stale')
    return account
  }
  private async toggle(account: Account, disabled: boolean): Promise<void> {
    const result = await this.api('auth-files/status', 'PATCH', { name: account.name, auth_index: account.index, disabled })
    if (result.status !== 'ok') throw new AccountError('cpaFailed')
  }
  switch(id: string, revision: string): Promise<AccountSnapshot> {
    return this.exclusive(async () => {
      const before = await this.accounts(), selected = await this.selection()
      if (this.revision(before, selected) !== revision) throw new AccountError('stale')
      const target = id === 'paused' ? undefined : this.target(before, id)
      // Persist the fixed choice before enabling it: errors stop requests rather
      // than briefly exposing an unpinned pool or falling back to another account.
      await this.api('routing/codex-account', 'PUT', { auth_index: id, expected: selected })
      if (target?.disabled) await this.toggle(target, false)
      const after = await this.list()
      if (after.selected !== id) throw new AccountError('stale')
      return after
    })
  }
  logout(id: string, revision: string): Promise<AccountSnapshot> {
    return this.exclusive(async () => {
      const accounts = await this.accounts(), selected = await this.selection()
      if (this.revision(accounts, selected) !== revision) throw new AccountError('stale')
      const target = this.target(accounts, id)
      if (!target.canLogout) throw new AccountError('logoutUnsupported')
      // Removing the selected credential pauses the proxy; no replacement is chosen.
      if (selected === id) await this.api('routing/codex-account', 'PUT', { auth_index: 'paused', expected: selected })
      await this.api('auth-files?name=' + encodeURIComponent(target.name), 'DELETE')
      const after = await this.list()
      if (after.accounts.some(a => a.id === id)) throw new AccountError('logoutFailed')
      return after
    })
  }
  async quota(id: string): Promise<AccountQuota> {
    const account = this.target(await this.accounts(), id)
    if (!account.accountId) throw new AccountError('quotaUnavailable')
    const response = await this.api('api-call', 'POST', {
      auth_index: account.index, method: 'GET', url: 'https://chatgpt.com/backend-api/wham/usage',
      header: { Authorization: 'Bearer $TOKEN$', 'Chatgpt-Account-Id': account.accountId, Accept: 'application/json' },
    })
    if (response.status_code !== 200) throw new AccountError('quotaUnavailable')
    let data: Row
    try { data = record(JSON.parse(text(response.body))) } catch { throw new AccountError('invalidResponse') }
    return normalizeQuota(id, data)
  }
  login(): Promise<{ id: string; url: string }> { return this.exclusive(async () => {
    const selected = await this.selection()
    if (!selected) await this.api('routing/codex-account', 'PUT', { auth_index: 'paused', expected: selected })
    for (const [id, login] of this.logins) if (login.expires < Date.now()) this.logins.delete(id)
    if (this.logins.size) throw new AccountError('loginPending')
    const data = await this.api('codex-auth-url?is_webui=true')
    let url: URL
    try { url = new URL(text(data.url)) } catch { throw new AccountError('invalidResponse') }
    if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password || (url.port && url.port !== '443') || !text(data.state)) throw new AccountError('invalidResponse')
    const id = randomUUID()
    this.logins.set(id, { state: text(data.state), expires: Date.now() + 5 * 60_000 })
    return { id, url: url.href }
  }) }
  async loginStatus(id: string): Promise<{ status: 'wait' | 'ok' | 'error' }> {
    const pending = this.logins.get(id)
    if (!pending || pending.expires < Date.now()) { this.logins.delete(id); throw new AccountError('loginExpired') }
    const result = await this.api('get-auth-status?state=' + encodeURIComponent(pending.state))
    const status = result.status
    if (!['wait', 'ok', 'error'].includes(text(status))) throw new AccountError('invalidResponse')
    if (status !== 'wait') this.logins.delete(id)
    return { status: status as 'wait' | 'ok' | 'error' }
  }
}

export function normalizeQuota(id: string, data: Row): AccountQuota {
  const windows: QuotaWindow[] = []
  const add = (name: string, value: unknown) => {
    const rate = record(value)
    for (const part of ['primary_window', 'secondary_window']) {
      if (!rate[part]) continue
      const window = record(rate[part]), used = number(window.used_percent), seconds = number(window.limit_window_seconds)
      const validUsed = used !== null && used >= 0 && used <= 100 ? used : null
      windows.push({ name: name + '/' + part, usedPercent: validUsed, remainingPercent: validUsed === null ? null : 100 - validUsed,
        durationMinutes: seconds !== null && seconds > 0 ? seconds / 60 : null, resetsAt: number(window.reset_at) })
    }
  }
  add('main', data.rate_limit)
  if (Array.isArray(data.additional_rate_limits)) for (const limit of data.additional_rate_limits) {
    const row = record(limit); add(text(row.limit_name) || 'additional', row.rate_limit)
  }
  add('code-review', data.code_review_rate_limit)
  return { accountId: id, checkedAt: new Date().toISOString(), ...(text(data.plan_type) ? { plan: text(data.plan_type) } : {}), windows }
}
