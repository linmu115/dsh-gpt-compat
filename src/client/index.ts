import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { Bindings, type ProviderSettings, type Face } from './Bindings.tsx'
import styles from './bindings.css?inline'
import { accountEn, accountZh } from './Accounts.tsx'

const en = {
  ...accountEn,
  nav: 'GPT compatibility', title: 'GPT models',
  description: 'Available GPT conversation models are discovered automatically. Compatible tools are enabled when you use them.',
  refreshModels: 'Refresh', loadingModels: 'Loading models…',
  emptyModels: 'No GPT conversation models are available. Check your CPA connection and account.',
  failedModels: 'Could not read the model list. Check the CPA connection and retry.',
  unavailable: 'Provider settings are unavailable.',
  hint: 'Switch models and reasoning effort in the conversation. No model names or compatibility bindings need to be entered here. Image generation models are not conversation models.',
}
const zh: typeof en = {
  ...accountZh,
  nav: 'GPT 适配', title: 'GPT 模型',
  description: '自动读取可用的 GPT 会话模型，使用时自动启用兼容工具。',
  refreshModels: '刷新列表', loadingModels: '正在读取模型列表…',
  emptyModels: '暂无可用的 GPT 会话模型，请检查 CPA 连接和账号。',
  failedModels: '模型列表读取失败，请检查 CPA 连接后重试。',
  unavailable: '提供商设置暂不可用。',
  hint: '在会话页面切换模型和推理强度；这里无需填写模型名称或兼容绑定。图片生成模型不属于会话模型。',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'gpt.compat': keyof typeof en }
}
export const inject = ['slots', 'locale', 'settingsScope', 'remote', 'remote.session']
export function apply(ctx: Context): void {
  // The development host may only emit owner types, without generated Remote declarations.
  const remote = ctx.remote as typeof ctx.remote & { session: { modelCatalog(): Promise<{ ok: true; value: ModelCatalog } | { ok: false }> } }
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-gpt-compat/bindings'
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'GPT compatibility settings styles')
  ctx.effect(() => ctx.locale.register('gpt.compat', { en, zh }), 'GPT compatibility copy')
  const scope = ctx.settingsScope.bind<ProviderSettings>({ namespace: 'gpt-responses' })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'gpt-compat', order: 15, locale: 'gpt.compat',
    label: () => ctx.locale.bind('gpt.compat')('nav'),
    inject: (): Face => ({ hooks: { providers: scope }, loadModels: async providers => {
      const result = await remote.session.modelCatalog()
      if (!result.ok || result.value.failures.some(failure => providers.includes(failure.id))) throw new Error('Model catalog unavailable')
      return result.value.groups.filter(group => providers.includes(group.id)).map(group => ({ ...group, models: group.models.filter(model => model.id.startsWith('gpt-')) }))
    } }),
  }, Bindings))
}
