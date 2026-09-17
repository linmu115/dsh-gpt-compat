/** Public account views deliberately exclude upstream credentials and raw responses. */
export interface AccountView {
  id: string
  label: string
  email?: string
  plan?: string
  disabled: boolean
  unavailable: boolean
  canLogout: boolean
}
export interface AccountSnapshot {
  configured: boolean
  endpoint: string
  revision: string
  accounts: AccountView[]
  mode: 'legacy' | 'fixed' | 'paused'
  selected: string
}
export interface QuotaWindow {
  name: string
  usedPercent: number | null
  remainingPercent: number | null
  durationMinutes: number | null
  resetsAt: number | null
}
export interface AccountQuota { accountId: string; checkedAt: string; plan?: string; windows: QuotaWindow[] }
