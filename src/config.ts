/** Validated provider/model bindings. All selection changes take effect at a step boundary. */
import z from '@deepseek-ai/schemastery'

export interface Binding { provider: string; models: string[] }
export interface ContextConfig {
  enabled: boolean
  triggerRatio: number
  reserveTokens: number
  marginTokens: number
  retainGroups: number
  maxPasses: number
  summaryMaxTokens: number
  summaryProvider: string
  summaryModel: string
}
export interface Config {
  context: ContextConfig
  bindings: Binding[]
  hiddenTools: string[]
  maxPatchBytes: number
  maxFileBytes: number
  maxOutputBytes: number
  maxProcesses: number
  yieldMs: number
  maxYieldMs: number
}
export const Config: z<Config> = z.object({
  context: z.object({
    enabled: z.boolean().default(false), triggerRatio: z.number().min(0.1).max(0.95).default(0.8),
    reserveTokens: z.number().step(1).min(1).default(4096), marginTokens: z.number().step(1).min(0).default(1024),
    retainGroups: z.number().step(1).min(1).default(2), maxPasses: z.number().step(1).min(1).default(64),
    summaryMaxTokens: z.number().step(1).min(1).default(2048),
    summaryProvider: z.string().default(''), summaryModel: z.string().default(''),
  }).default({ enabled: false, triggerRatio: 0.8, reserveTokens: 4096, marginTokens: 1024, retainGroups: 2,
    maxPasses: 64, summaryMaxTokens: 2048, summaryProvider: '', summaryModel: '' }),
  bindings: z.array(z.object({ provider: z.string().required(), models: z.array(z.string()).required() })).default([]),
  hiddenTools: z.array(z.string()).default(['write', 'edit', 'str_replace_editor', 'bash', 'pwsh']),
  maxPatchBytes: z.number().step(1).min(1).default(1048576),
  maxFileBytes: z.number().step(1).min(1).default(4194304),
  maxOutputBytes: z.number().step(1).min(128).default(16384),
  maxProcesses: z.number().step(1).min(1).default(16),
  yieldMs: z.number().step(1).min(0).default(1000),
  maxYieldMs: z.number().step(1).min(1).max(60000).default(10000),
})

/** Reject ambiguous or overly broad configuration before publishing it. */
export function validateConfig(config: Config): void {
  if (Boolean(config.context.summaryProvider) !== Boolean(config.context.summaryModel)) throw new Error('Portable summary provider and model must be configured together')
  const seen = new Set<string>()
  for (const binding of config.bindings) {
    if (!binding.provider.trim() || !binding.models.length) throw new Error('Each binding requires a provider and explicit model names or trailing * patterns')
    for (const model of binding.models) {
      if (!model.trim() || model === '*' || model.slice(0, -1).includes('*')) throw new Error(`Invalid model pattern: ${model}`)
      const key = `${binding.provider}\0${model}`
      if (seen.has(key)) throw new Error(`Duplicate binding: ${binding.provider}/${model}`)
      seen.add(key)
    }
  }
  if (config.yieldMs > config.maxYieldMs) throw new Error('yieldMs exceeds maxYieldMs')
  if (config.hiddenTools.some(name => ['apply_patch', 'exec_command', 'write_stdin'].includes(name))) throw new Error('Compatibility tools cannot hide themselves')
}

/** Exact provider identity plus exact model or an explicit trailing-prefix match. */
export function matches(config: Config, provider: string | undefined, model: string | undefined): boolean {
  return provider !== undefined && model !== undefined && config.bindings.some(binding =>
    binding.provider === provider && binding.models.some(pattern => pattern.endsWith('*')
      ? model.startsWith(pattern.slice(0, -1)) : model === pattern))
}

/** Only our registered native providers receive automatic GPT compatibility. */
export function withNativeBindings(config: Config, directory: readonly { provider: string; settingsNs: string }[]): Config {
  const native = new Set(directory.filter(entry => entry.settingsNs === 'gpt-responses').map(entry => entry.provider))
  return { ...config, bindings: [...config.bindings.filter(binding => !native.has(binding.provider)),
    ...[...native].map(provider => ({ provider, models: ['gpt-*'] }))] }
}
