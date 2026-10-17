import { useEffect, useId, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiagnosticSnapshot } from '../diagnostics.ts'

export const diagnosticEn = {
  diagnosticTitle: 'Read-only diagnostics', diagnosticRefresh: 'Refresh diagnostics', diagnosticLoading: 'Checking…',
  diagnosticsUnavailable: 'Diagnostics are unavailable. Check the local proxy in Accounts and start it there if needed, then retry.',
  diagnosticHint: 'Reads configuration and CPA status only. No model request, account switch or process start. Configured capability is not proof of endpoint support.',
  diagnosticContext: 'Local context management', diagnosticEnabled: 'Enabled', diagnosticDisabled: 'Disabled',
  diagnosticMissing: 'Provider diagnostics are unavailable.', diagnosticDeclared: 'Declared model capabilities',
  diagnosticMode: 'Context mode', diagnosticFixed: 'Fixed-account protocol', diagnosticCpa: 'CPA public identity',
  diagnosticServer: 'Server compaction', diagnosticAccounting: 'Usage accounting', diagnosticModel: 'Model',
  diagnosticWindow: 'Context capacity', diagnosticOutput: 'Maximum output', diagnosticEfforts: 'Reasoning levels',
  diagnosticConfigured: 'Configured only; model request not tested', diagnosticNotChecked: 'Not checked',
  diagnosticUnknown: 'Unknown', diagnosticVerified: 'Protocol read verified', diagnosticPaused: 'Proxy paused',
  diagnosticUnauthorized: 'Authentication rejected', diagnosticUnsupported: 'Fixed-account contract unavailable',
  diagnosticUnavailable: 'Unavailable; check the local proxy in Accounts and start it there if needed.', diagnosticRunning: 'CPA identity verified', diagnosticNotEnabled: 'Not enabled',
  diagnosticNotVerified: 'Configured; endpoint support not verified', diagnosticOrdinary: 'Ordinary response usage; extra compaction shown separately',
  diagnosticIncluded: 'Inline compaction is included in response usage; do not add it again',
}
export type DiagnosticKey = keyof typeof diagnosticEn
export const diagnosticZh: Record<DiagnosticKey, string> = {
  diagnosticTitle: '只读诊断', diagnosticRefresh: '刷新诊断', diagnosticLoading: '正在检查…',
  diagnosticsUnavailable: '暂时无法读取诊断。可到账号管理检查本地代理并启动，再回来重试。',
  diagnosticHint: '仅检查配置与 CPA 状态，不发模型请求、不换账号、不启动进程。已配置不代表端点已支持或实际生成已验收。',
  diagnosticContext: '本地上下文管理', diagnosticEnabled: '已启用', diagnosticDisabled: '未启用',
  diagnosticMissing: '提供商诊断暂不可用。', diagnosticDeclared: '已声明的模型能力',
  diagnosticMode: '上下文模式', diagnosticFixed: '固定账号协议', diagnosticCpa: 'CPA 服务标识',
  diagnosticServer: '服务端压缩', diagnosticAccounting: '用量归属', diagnosticModel: '模型',
  diagnosticWindow: '上下文容量', diagnosticOutput: '最大输出', diagnosticEfforts: '推理档位',
  diagnosticConfigured: '仅配置；未测试模型请求', diagnosticNotChecked: '未检查', diagnosticUnknown: '未知',
  diagnosticVerified: '协议只读验证通过', diagnosticPaused: '代理已暂停', diagnosticUnauthorized: '认证被拒绝',
  diagnosticUnsupported: '固定账号契约不可用', diagnosticUnavailable: '不可用；可到账号管理检查本地代理并启动。', diagnosticRunning: 'CPA 标识验证通过',
  diagnosticNotEnabled: '未启用', diagnosticNotVerified: '已配置；端点支持未验证',
  diagnosticOrdinary: '普通响应计量；额外压缩单独显示', diagnosticIncluded: '流内压缩已包含在响应计量中，不重复相加',
}
const states: Record<string, DiagnosticKey> = {
  verified: 'diagnosticVerified', paused: 'diagnosticPaused', 'not-checked': 'diagnosticNotChecked', unknown: 'diagnosticUnknown',
  unavailable: 'diagnosticUnavailable', unauthorized: 'diagnosticUnauthorized', unsupported: 'diagnosticUnsupported',
  running: 'diagnosticRunning', 'not-enabled': 'diagnosticNotEnabled', 'not-verified': 'diagnosticNotVerified',
}
export async function loadDiagnostics(signal: AbortSignal): Promise<DiagnosticSnapshot> {
  const response = await fetch(new URL('api/gpt-compat.diagnostics', document.baseURI), { credentials: 'same-origin', signal })
  const result = await response.json()
  if (!response.ok || !result.ok || result.value?.version !== 1 || !Array.isArray(result.value.providers)) throw new Error('diagnosticsUnavailable')
  return result.value
}
export function Diagnostics({ t, load = loadDiagnostics }: { t: (key: DiagnosticKey) => string; load?: typeof loadDiagnostics }) {
  const id = useId(), [refresh, setRefresh] = useState(0), [value, setValue] = useState<DiagnosticSnapshot>()
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    let active = true
    setLoading(true); setFailed(false); setValue(undefined)
    const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('diagnosticsUnavailable')), { once: true }))
    Promise.race([load(controller.signal), cancelled]).then(result => { if (active) setValue(result) }, () => { if (active) setFailed(true) })
      .finally(() => { clearTimeout(timer); if (active) setLoading(false) })
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [load, refresh])
  return <section className="gpt-compat-settings gpt-compat-diagnostics-section" aria-labelledby={`${id}-title`} aria-busy={loading}>
    <div className="gpt-compat-settings__card-heading"><h3 id={`${id}-title`}>{t('diagnosticTitle')}</h3>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => setRefresh(n => n + 1)}>{t('diagnosticRefresh')}</Button></div>
    <p className="gpt-compat-settings__hint">{t('diagnosticHint')}</p>
    {loading ? <p role="status">{t('diagnosticLoading')}</p> : failed ? <p role="alert">{t('diagnosticsUnavailable')}</p> : value && <>
      <p>{t('diagnosticContext')}：{t(value.contextEnabled ? 'diagnosticEnabled' : 'diagnosticDisabled')}</p>
      {value.providerState === 'unavailable' && <p role="status">{t('diagnosticMissing')}</p>}
      {value.providers.map(provider => <div key={provider.provider} className="gpt-compat-settings__card gpt-compat-diagnostics">
        <h4>{provider.provider}</h4><dl>
          <dt>{t('diagnosticMode')}</dt><dd>{provider.mode}</dd>
          <dt>{t('diagnosticFixed')}</dt><dd>{t(states[provider.fixedAccount] ?? 'diagnosticUnknown')}</dd>
          <dt>{t('diagnosticCpa')}</dt><dd>{t(states[provider.cpa] ?? 'diagnosticUnknown')}</dd>
          <dt>{t('diagnosticServer')}</dt><dd>{t(states[provider.serverCompaction] ?? 'diagnosticUnknown')}</dd>
          <dt>{t('diagnosticAccounting')}</dt><dd>{t(provider.responseAccounting === 'ordinary-response-includes-inline-compaction' ? 'diagnosticIncluded' : 'diagnosticOrdinary')}</dd>
        </dl><details><summary>{t('diagnosticDeclared')}</summary><p className="gpt-compat-settings__hint">{t('diagnosticConfigured')}</p>
          {provider.models.map(model => <div key={model.id} className="gpt-compat-diagnostics__model"><strong>{model.id}</strong>
            <dl><dt>{t('diagnosticWindow')}</dt><dd>{model.contextWindow}</dd>
              <dt>{t('diagnosticOutput')}</dt><dd>{model.maxTokens}</dd>
              <dt>{t('diagnosticEfforts')}</dt><dd>{model.reasoningEfforts.join(', ') || t('diagnosticUnknown')}</dd></dl></div>)}
        </details>
      </div>)}
    </>}
  </section>
}
