import { usageFields, type AuxiliaryUsage } from '../auxiliary-usage.ts'
export const usageEn = {
  usageTitle: 'Extra compaction usage', usageUnknown: 'Unknown', usageSeparate: 'Separate auxiliary request; not added to ordinary generation totals.',
  usageIncluded: 'Included in normal response usage; do not add again.',
  inputTokens: 'Uncached input', outputTokens: 'Output', totalTokens: 'Total', cacheReadTokens: 'Cache read', cacheWriteTokens: 'Cache write', reasoningTokens: 'Reasoning (part of output)',
}
export type UsageKey = keyof typeof usageEn
export const usageZh: Record<UsageKey, string> = {
  usageTitle: '额外压缩用量', usageUnknown: '未知', usageSeparate: '独立辅助请求；与宿主普通生成统计分开显示。',
  usageIncluded: '已包含在普通响应计量中，请勿再次相加。',
  inputTokens: '未缓存输入', outputTokens: '输出', totalTokens: '总量', cacheReadTokens: '缓存读取', cacheWriteTokens: '缓存写入', reasoningTokens: '推理（包含在输出内）',
}
export function UsageDetails({ usage, t = key => usageZh[key] }: { usage: AuxiliaryUsage; t?: (key: UsageKey) => string }) {
  return <div className="gpt-compat-usage"><h4>{t('usageTitle')}</h4><dl>{usageFields.map(key => <div key={key}>
    <dt>{t(key)}</dt><dd>{usage[key] === null ? t('usageUnknown') : usage[key]}</dd></div>)}</dl>
    <p>{t(usage.accounting === 'included-in-response' ? 'usageIncluded' : 'usageSeparate')}</p></div>
}
