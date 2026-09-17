import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { Bindings, type BindingSettings, type Face } from './Bindings.tsx'
import styles from './bindings.css?inline'
import { accountEn, accountZh } from './Accounts.tsx'

const en = {
  ...accountEn,
  title: 'GPT compatibility', description: 'Enable compatible editing and command tools for the selected provider and models. Each conversation switches at its next step.',
  provider: 'Provider ID', models: 'Models', binding: 'Binding', remove: 'Remove', add: 'Add binding', save: 'Save', saving: 'Saving…', discard: 'Discard',
  unavailable: 'Compatibility settings are unavailable.', disabled: 'No bindings. Compatibility tools are disabled.',
  hint: 'Use the provider ID shown in model settings. Separate model IDs with commas; a trailing * matches a prefix, such as gpt-*. Changes apply to subsequent steps.',
  refused: 'The settings were not saved or changed elsewhere. Keep this draft and try again after reloading.',
}
const zh: typeof en = {
  ...accountZh,
  title: 'GPT 兼容工具', description: '为指定提供商和模型启用兼容的编辑与命令工具。每个会话在下一步自动切换。',
  provider: '提供商 ID', models: '模型', binding: '绑定', remove: '移除', add: '添加绑定', save: '保存', saving: '保存中…', discard: '放弃修改',
  unavailable: '兼容工具设置暂不可用。', disabled: '尚未绑定，兼容工具处于关闭状态。',
  hint: '填写模型设置中的提供商 ID。多个模型 ID 用逗号分隔；末尾 * 表示前缀匹配，例如 gpt-*。修改从后续步骤开始生效。',
  refused: '设置未保存，或已被其他页面修改。草稿已保留，请刷新后重试。',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'gpt.compat': keyof typeof en }
}
export const inject = ['slots', 'locale', 'settingsScope']
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-gpt-compat/bindings'
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'GPT compatibility settings styles')
  ctx.effect(() => ctx.locale.register('gpt.compat', { en, zh }), 'GPT compatibility copy')
  const scope = ctx.settingsScope.bind<BindingSettings>({ namespace: 'gpt-compat' })
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'gpt-compat', order: 100, locale: 'gpt.compat',
    inject: (): Face => ({ hooks: { bindings: scope }, save: async (bindings, revision) => {
      await scope.mutate([{ op: 'set', path: ['bindings'], value: bindings.map(binding => ({ provider: binding.provider, models: [...binding.models] })) }], revision)
      if (JSON.stringify(scope.getSnapshot().value?.bindings) !== JSON.stringify(bindings)) throw new Error(ctx.locale.bind('gpt.compat')('refused'))
    } }),
  }, Bindings))
}
