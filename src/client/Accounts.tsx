import { useEffect, useId, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountQuota, AccountSnapshot } from '../accounts/types.ts'
import type { LocalStatus } from '../accounts/local.ts'

export const accountEn = {
  localTitle: 'Local CPA service', localStart: 'Start local CPA', localStarting: 'CPA is starting or another launcher holds the startup lock. Refresh its status shortly.', localStartingLabel: 'Starting CPA…',
  localRunning: 'CPA is running', localStopped: 'CPA is not running', localChecking: 'Checking CPA…', localRefresh: 'Refresh service status',
  localUnavailable: 'The endpoint did not identify itself as CPA. Check the port or service configuration before starting.',
  localNotConfigured: 'Local startup has not been configured by the administrator.', localConfigInvalid: 'The configured CPA executable, configuration, or password file is missing or invalid.',
  localUnsupported: 'Local startup currently supports Windows hosts only.', localLaunchFailed: 'Could not start CPA. Check local startup permissions and configuration.',
  localStartTimeout: 'CPA did not become ready in time. Check its logs and refresh the status; an existing process will not be started again.',
  localUpgradeRequired: 'The startup module is installed but the running DSH instance must be restarted normally to enable it.',
  accountTitle: 'CPA accounts', accountHint: 'Keep multiple accounts signed in, and proxy through one selected account. No automatic failover. This selection applies to all clients using this CPA.',
  refreshAccounts: 'Refresh accounts', connectAccount: 'Connect CPA', managementKey: 'CPA management key', keyHint: 'Use the CPA management password, not a model API key. Stored in DSH credentials; never sent to the model.',
  changeKey: 'Connection settings', accountCurrent: 'Current proxy account', accountStandby: 'Standby', accountDisabled: 'Disabled', accountUnavailable: 'Unavailable',
  accountChoose: 'Use this account', accountRemove: 'Remove and sign out', accountAdd: 'Add account', accountPause: 'Pause proxy', accountPaused: 'Proxy paused. Choose an account to resume.',
  accountLegacy: 'CPA is using its original routing. Choose one account to enable fixed routing. Adding an account first pauses the proxy until you choose one.',
  accountMissing: 'The selected account is missing. Requests will fail instead of using a different account.', accountEmpty: 'No Codex accounts are signed in.',
  refreshQuota: 'Refresh quota', quotaUnknown: 'Quota not available', remaining: 'remaining', resets: 'Resets', checked: 'Checked', mainQuota: 'GPT', reviewQuota: 'Code review', primaryQuota: 'Primary window', secondaryQuota: 'Secondary window',
  accountBusy: 'Working…', accountConfirm: 'Confirm', accountCancel: 'Cancel',
  switchConfirm: 'Use this account for all new Codex requests through this CPA? In-flight requests may finish with the previous account. Other accounts remain saved.',
  logoutConfirm: 'Remove this account’s local credential from CPA? If selected, proxying will pause. Signing in again will be required; this does not sign out other OpenAI devices.',
  pauseConfirm: 'Pause new Codex requests through this CPA? Saved accounts are retained.',
  openLogin: 'Open sign-in page', loginWaiting: 'Complete sign-in in your browser. The new account will stay on standby until selected.', loginDone: 'Account added. Choose it below when you want to switch.', loginFailed: 'Sign-in failed or expired. Please try again.',
  accountError: 'Operation failed. Refresh to check the current state.', accountUnavailableService: 'Account management module is not installed or running.',
  notConfigured: 'Connect CPA with its management key first.', unauthorized: 'CPA rejected the management key. Check it in Connection settings.', unreachable: 'Cannot reach CPA. Check that it is running.',
  fixedUnsupported: 'This CPA needs the fixed-account extension before this panel can manage accounts.', stale: 'The account pool or selection changed. Refresh before trying again.',
  quotaUnavailable: 'CPA could not retrieve this account’s quota. This does not mean the remaining quota is zero.',
  loginPending: 'A sign-in is already pending. Complete it or wait for it to expire before starting another.', loginExpired: 'Sign-in expired. Start again.',
}
export type AccountKey = keyof typeof accountEn
export const accountZh: Record<AccountKey, string> = {
  localTitle: '本机 CPA 服务', localStart: '启动本机 CPA', localStarting: 'CPA 正在启动，或另一个启动器持有启动锁，请稍后刷新状态。', localStartingLabel: '正在启动 CPA…',
  localRunning: 'CPA 已运行', localStopped: 'CPA 未运行', localChecking: '正在检查 CPA…', localRefresh: '刷新服务状态',
  localUnavailable: '此端点未返回 CPA 服务标识，请检查端口占用或服务配置后再启动。',
  localNotConfigured: '尚未配置本机 CPA 启动路径，请由部署者完成配置。', localConfigInvalid: '配置的 CPA 程序、配置文件或密码文件不存在或无效。',
  localUnsupported: '本机启动目前仅支持 Windows 宿主。', localLaunchFailed: '未能启动 CPA，请检查本机权限与启动配置。',
  localStartTimeout: 'CPA 未在规定时间内就绪。请检查其日志并刷新状态；已存在的进程不会重复启动。',
  localUpgradeRequired: '启动模块已安装，当前 DSH 实例需要正常重启后才能启用。',
  accountTitle: 'CPA 账号', accountHint: '可保存多个已登录账号，代理只使用你指定的一个，不自动换号。此选择对使用这台 CPA 的所有客户端生效。',
  refreshAccounts: '刷新账号', connectAccount: '连接 CPA', managementKey: 'CPA 管理密钥', keyHint: '填写 CPA 管理页的密码，不是模型 API Key。保存在 DSH 凭据中，不会发送给模型。',
  changeKey: '连接设置', accountCurrent: '当前代理账号', accountStandby: '待用', accountDisabled: '已停用', accountUnavailable: '暂不可用',
  accountChoose: '设为代理账号', accountRemove: '移除并退出登录', accountAdd: '新增账号', accountPause: '暂停代理', accountPaused: '代理已暂停。选择账号后恢复。',
  accountLegacy: 'CPA 仍使用原有路由。请选择一个账号以启用固定代理；如果先新增账号，将暂停代理，直到你指定账号。',
  accountMissing: '指定账号已不存在。请求会停止，不会改用其他账号。', accountEmpty: '尚未登录 Codex 账号。',
  refreshQuota: '刷新额度', quotaUnknown: '额度暂未获取', remaining: '剩余', resets: '重置时间', checked: '查询时间', mainQuota: 'GPT', reviewQuota: '代码审查', primaryQuota: '主额度窗口', secondaryQuota: '次额度窗口',
  accountBusy: '处理中…', accountConfirm: '确认', accountCancel: '取消',
  switchConfirm: '将这台 CPA 的新 Codex 请求固定到此账号？正在执行的请求可能仍使用旧账号，其他账号会保留待用。',
  logoutConfirm: '从 CPA 移除此账号的本地登录凭据？若是当前账号，代理将暂停。以后需要重新登录；这不会退出其他设备上的 OpenAI 会话。',
  pauseConfirm: '暂停这台 CPA 的新 Codex 请求？已登录账号会保留。',
  openLogin: '打开登录页', loginWaiting: '请在浏览器中完成登录。新账号会保留待用，手动指定后才代理请求。', loginDone: '账号已添加。需要切换时，在下方将它设为代理账号。', loginFailed: '登录失败或已过期，请重试。',
  accountError: '操作未完成，请刷新确认当前状态。', accountUnavailableService: '账号管理模块尚未安装或运行。',
  notConfigured: '请先填写 CPA 管理密钥并连接。', unauthorized: 'CPA 拒绝了管理密钥，请在“连接设置”中检查。', unreachable: '无法连接 CPA，请检查服务是否运行。',
  fixedUnsupported: '当前 CPA 需要安装固定账号扩展，才能使用此面板管理账号。', stale: '账号池或当前选择已改变，请刷新后再操作。',
  quotaUnavailable: 'CPA 未能查询此账号的额度，这不代表剩余额度为零。', loginPending: '已有登录正在进行，请完成登录或等它过期后再试。', loginExpired: '登录已过期，请重新发起。',
}

async function invoke<T>(action: string, data: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL('api/gpt-compat.accounts', document.baseURI), {
    method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...data }),
  })
  if (response.status === 404) throw new Error('accountUnavailableService')
  const result = await response.json()
  if (!result.ok) throw new Error(action === 'localStatus' && result.code === 'invalidInput' ? 'localUpgradeRequired' : typeof result.code === 'string' ? result.code : 'accountError')
  return result.value as T
}

export function Accounts({ t, onChanged }: { t: (key: AccountKey) => string; onChanged?: () => void }) {
  const id = useId()
  const [snapshot, setSnapshot] = useState<AccountSnapshot>()
  const [local, setLocal] = useState<LocalStatus>(), [starting, setStarting] = useState(false)
  const [localError, setLocalError] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [key, setKey] = useState('')
  const [quotas, setQuotas] = useState<Record<string, AccountQuota | string>>({})
  const [pending, setPending] = useState<{ action: 'switch' | 'logout'; id: string; label: string; revision: string }>()
  const [login, setLogin] = useState<{ id: string; url: string }>(), [notice, setNotice] = useState('')
  const friendly = (cause: unknown) => {
    const code = cause instanceof Error ? cause.message : ''
    return Object.hasOwn(accountEn, code) ? t(code as AccountKey) : t('accountError')
  }
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await work() } catch (cause) {
      setError(friendly(cause)); setPending(undefined)
      try { setSnapshot(await invoke<AccountSnapshot>('list')) } catch { setSnapshot(undefined) }
    } finally { setBusy(false) }
  }
  const reload = async () => { setSnapshot(await invoke<AccountSnapshot>('list')) }
  const refreshLocal = async () => {
    try { setLocal(await invoke<LocalStatus>('localStatus')); setLocalError('') }
    catch (cause) { setLocal(undefined); setLocalError(friendly(cause)) }
  }
  const startLocal = async () => {
    setStarting(true); setLocalError('')
    try {
      setLocal(await invoke<LocalStatus>('localStart'))
      setError(''); await reload(); onChanged?.()
    } catch (cause) { setLocalError(friendly(cause)) }
    finally {
      try { setLocal(await invoke<LocalStatus>('localStatus')) } catch { /* retain the actionable startup error */ }
      setStarting(false)
    }
  }
  useEffect(() => { if (snapshot) onChanged?.() }, [snapshot?.revision, snapshot?.configured])
  useEffect(() => {
    const abort = new AbortController()
    invoke<LocalStatus>('localStatus', {}, abort.signal).then(setLocal).catch(cause => { if (!abort.signal.aborted) setLocalError(friendly(cause)) })
    invoke<AccountSnapshot>('list', {}, abort.signal).then(setSnapshot).catch(cause => { if (!abort.signal.aborted) setError(friendly(cause)) })
    return () => abort.abort()
  }, [])
  useEffect(() => {
    if (!login) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await invoke<{ status: string }>('loginStatus', { id: login.id }, abort.signal)
        if (abort.signal.aborted) return
        if (result.status === 'wait') { timer = setTimeout(poll, 2500); return }
        setLogin(undefined); setNotice(t(result.status === 'ok' ? 'loginDone' : 'loginFailed'))
        await reload()
      } catch (cause) { if (!abort.signal.aborted) { setError(friendly(cause)); setLogin(undefined) } }
    }
    timer = setTimeout(poll, 2500)
    return () => { abort.abort(); clearTimeout(timer) }
  }, [login?.id])
  const quota = async (accountId: string) => {
    try { const value = await invoke<AccountQuota>('quota', { id: accountId }); setQuotas(prev => ({ ...prev, [accountId]: value })) }
    catch (cause) { setQuotas(prev => ({ ...prev, [accountId]: friendly(cause) })) }
  }
  useEffect(() => {
    if (snapshot?.mode === 'fixed' && snapshot.accounts.some(a => a.id === snapshot.selected)) void quota(snapshot.selected)
  }, [snapshot?.selected])
  useEffect(() => {
    if (pending) document.getElementById(`${id}-confirmation`)?.scrollIntoView({ block: 'nearest' })
  }, [pending?.id, pending?.action])
  return <section className="gpt-compat-settings gpt-compat-accounts" aria-labelledby={`${id}-title`} aria-busy={busy}>
    <header className="gpt-compat-settings__heading"><h3 id={`${id}-title`}>{t('accountTitle')}</h3><p className="gpt-compat-settings__intro">{t('accountHint')}</p></header>
    <div className="gpt-compat-settings__card" aria-busy={starting}>
      <h4>{t('localTitle')}</h4>
      {(!localError || local) && <p role="status" className="gpt-compat-settings__hint">{t(starting || local?.state === 'starting' ? 'localStartingLabel' : local?.state === 'running' ? 'localRunning' : local?.state === 'stopped' ? 'localStopped' : local?.state === 'unavailable' ? 'localUnavailable' : 'localChecking')}</p>}
      {local && !local.canStart && local.state !== 'running' && <p className="gpt-compat-settings__hint">{t('localNotConfigured')}</p>}
      <div className="gpt-compat-settings__actions">
        <Button variant="primary" disabled={starting || busy || !local?.canStart || local.state !== 'stopped'} onClick={() => void startLocal()}>{t(starting ? 'localStartingLabel' : 'localStart')}</Button>
        <Button variant="outline" disabled={starting} onClick={() => void refreshLocal()}>{t('localRefresh')}</Button>
      </div>
      {localError && <p role="alert" className="gpt-compat-settings__error">{localError}</p>}
    </div>
    <details open={snapshot?.configured === false}>
      <summary>{t('changeKey')}{snapshot?.endpoint ? ` · ${snapshot.endpoint}` : ''}</summary>
      <div className="gpt-compat-settings__card">
        <label className="gpt-compat-settings__field"><span>{t('managementKey')}</span><Input type="password" autoComplete="new-password" value={key} disabled={busy} onChange={event => setKey(event.target.value)} /></label>
        <p className="gpt-compat-settings__hint">{t('keyHint')}</p>
        <Button variant="outline" disabled={busy || !key.trim()} onClick={() => void run(async () => { setSnapshot(await invoke('configure', { key })); setKey('') })}>{t('connectAccount')}</Button>
      </div>
    </details>
    {error && <p role="alert" className="gpt-compat-settings__error">{error}</p>}
    {notice && <p role="status" className="gpt-compat-settings__hint">{notice}</p>}
    <div className="gpt-compat-settings__actions">
      <Button variant="outline" disabled={busy} onClick={() => void run(reload)}>{t('refreshAccounts')}</Button>
      <Button variant="outline" disabled={busy || !snapshot?.configured || !!login} onClick={() => void run(async () => { setLogin(await invoke('login')); setNotice(''); await reload() })}>{t('accountAdd')}</Button>
      <Button disabled={busy || !snapshot?.configured || snapshot.mode === 'paused'} onClick={() => setPending({ action: 'switch', id: 'paused', label: '', revision: snapshot!.revision })}>{t('accountPause')}</Button>
    </div>
    {busy && <p role="status" className="gpt-compat-settings__hint">{t('accountBusy')}</p>}
    {login && <div className="gpt-compat-settings__card"><p className="gpt-compat-settings__hint">{t('loginWaiting')}</p><a href={login.url} target="_blank" rel="noopener noreferrer">{t('openLogin')}</a></div>}
    {snapshot?.configured && <>
      {snapshot.mode !== 'fixed' && <p className="gpt-compat-settings__notice">{t(snapshot.mode === 'legacy' ? 'accountLegacy' : 'accountPaused')}</p>}
      {snapshot.mode === 'fixed' && !snapshot.accounts.some(a => a.id === snapshot.selected) && <p className="gpt-compat-settings__error">{t('accountMissing')}</p>}
      {!snapshot.accounts.length && <p className="gpt-compat-settings__empty">{t('accountEmpty')}</p>}
      {snapshot.accounts.map(account => {
        const usage = quotas[account.id], selected = snapshot.selected === account.id
        return <div className="gpt-compat-settings__card" key={account.id}>
          <div className="gpt-compat-settings__card-heading"><h4>{account.label}</h4><span className="gpt-compat-settings__hint">{t(selected ? 'accountCurrent' : 'accountStandby')}</span></div>
          <p className="gpt-compat-settings__hint">{[account.plan, account.disabled && t('accountDisabled'), account.unavailable && t('accountUnavailable')].filter(Boolean).join(' · ')}</p>
          {typeof usage === 'object' && usage.windows.length ? <div className="gpt-compat-accounts__quotas">{usage.windows.map((window, index) => {
            const [group, kind] = window.name.split('/')
            const duration = window.durationMinutes === null ? t(kind === 'primary_window' ? 'primaryQuota' : 'secondaryQuota') : window.durationMinutes >= 1440 ? `${window.durationMinutes / 1440}d` : `${window.durationMinutes / 60}h`
            return <div key={index} className="gpt-compat-accounts__quota"><span>{group === 'main' ? t('mainQuota') : group === 'code-review' ? t('reviewQuota') : group} · {duration}</span><strong>{window.remainingPercent === null ? '—' : `${Math.round(window.remainingPercent)}% ${t('remaining')}`}</strong><progress max={100} value={window.remainingPercent ?? undefined} aria-label={`${group} ${duration}`} /><span>{t('resets')}：{window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString() : '—'}</span></div>
          })}<p className="gpt-compat-settings__hint">{t('checked')}：{new Date(usage.checkedAt).toLocaleString()}</p></div> : <p className="gpt-compat-settings__hint">{typeof usage === 'string' ? usage : t('quotaUnknown')}</p>}
          <div className="gpt-compat-settings__actions">
            <Button variant={selected ? 'ghost' : 'outline'} disabled={busy || selected && !account.disabled} onClick={() => setPending({ action: 'switch', id: account.id, label: account.label, revision: snapshot.revision })}>{t('accountChoose')}</Button>
            <Button disabled={busy} onClick={() => void run(() => quota(account.id))}>{t('refreshQuota')}</Button>
            <Button className="gpt-compat-settings__remove" disabled={busy || !account.canLogout} onClick={() => setPending({ action: 'logout', id: account.id, label: account.label, revision: snapshot.revision })}>{t('accountRemove')}</Button>
          </div>
        </div>
      })}
    </>}
    {pending && <div id={`${id}-confirmation`} className="gpt-compat-settings__card" role="alertdialog" aria-label={pending.label || t('accountPause')} aria-describedby={`${id}-confirm`}>
      <h4>{pending.label || t('accountPause')}</h4><p id={`${id}-confirm`} className="gpt-compat-settings__intro">{t(pending.action === 'logout' ? 'logoutConfirm' : pending.id === 'paused' ? 'pauseConfirm' : 'switchConfirm')}</p>
      <div className="gpt-compat-settings__actions"><Button variant="primary" disabled={busy} onClick={() => void run(async () => { const value = await invoke<AccountSnapshot>(pending.action, { id: pending.id, revision: pending.revision }); setSnapshot(value); setPending(undefined) })}>{t('accountConfirm')}</Button><Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>{t('accountCancel')}</Button></div>
    </div>}
  </section>
}
