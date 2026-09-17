/** Opt-in Responses provider. Existing provider registrations are never replaced. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from './accounts/host.ts'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { GenerateOptions, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import { NATIVE_FORMAT, blocksFromOutput, fingerprint, record, replayEnvelope, requestBody, usageFromResponse, type Item } from './responses-wire.ts'
import { post, type Connection } from './responses-http.ts'
import { codexCompactionWindow, estimateNativeTokens } from './native-budget.ts'
import { hydrateImages, imageTokens, type ImageReader } from './responses-images.ts'

export interface ModelConfig {
  id: string; contextWindow: number; maxTokens: number
  reasoningEfforts?: string[]
  defaultReasoningEffort?: string
}
export interface ProviderConfig {
  baseURL: string
  apiKeyEnv: string
  models: ModelConfig[]
  customApplyPatch: boolean
  timeoutMs: number
  maxResponseBytes: number
  maxRequestBytes: number
  nativeContextMode: 'responses' | 'codex-v2'
  tokenEstimateMultiplier: number
}
export interface Config { providers: Record<string, ProviderConfig> }
export const Config: z<Config> = z.object({ providers: z.dict(z.object({
  baseURL: z.string().required(), apiKeyEnv: z.string().required(),
  models: z.array(z.object({ id: z.string().required(), contextWindow: z.number().step(1).min(1).required(), maxTokens: z.number().step(1).min(1).required(),
    reasoningEfforts: z.array(z.string()), defaultReasoningEffort: z.string(),
  })).required(),
  customApplyPatch: z.boolean().default(true), timeoutMs: z.number().step(1).min(1).max(2147483647).default(300000),
  maxResponseBytes: z.number().step(1).min(1).default(16777216),
  maxRequestBytes: z.number().step(1).min(1).default(16777216),
  nativeContextMode: z.union(['responses', 'codex-v2']).default('responses'),
  tokenEstimateMultiplier: z.number().min(1).max(8).default(1.5),
})).required() })

/** Validate routes before publishing a new settings generation. Capacities are explicit. */
export function validateConfig(config: Config): void {
  if (!Object.keys(config.providers).length) throw new Error('At least one Responses provider is required')
  for (const [id, profile] of Object.entries(config.providers)) {
    const url = new URL(profile.baseURL)
    if (!id.trim() || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Responses route or base URL')
    credentialRef(profile.apiKeyEnv)
    const names = new Set<string>()
    if (!profile.models.length) throw new Error('Declare at least one model with its actual context and output capacities')
    for (const model of profile.models) {
      if (!model.id.trim() || names.has(model.id) || model.maxTokens >= model.contextWindow) throw new Error('Invalid or duplicate model capacity declaration')
      names.add(model.id)
      const efforts = model.reasoningEfforts ?? []
      if (efforts.some(effort => !effort.trim() || effort.trim() !== effort)
        || new Set(efforts).size !== efforts.length
        || (model.defaultReasoningEffort !== undefined && !efforts.includes(model.defaultReasoningEffort))) {
        throw new Error('Invalid reasoning effort declaration: use distinct IDs and a default from the supported list')
      }
    }
  }
}

/** Native wire entry point with a generation frozen at prepareCall, including endpoint and key reference. */
export class ResponsesAdapter extends LlmAdapter {
  constructor(private readonly config: () => Config, private readonly key: (profile: ProviderConfig) => Promise<string>,
    private readonly account?: (endpoint: string) => Promise<string | undefined>,
    private readonly discover?: (endpoint: string) => Promise<ModelConfig[] | undefined>,
    private readonly readImage?: ImageReader) { super() }
  override imageRequestPricing(_provider: string, _model: string) {
    return { priceImages: (images: Parameters<NonNullable<ReturnType<LlmAdapter['imageRequestPricing']>>['priceImages']>[0]) =>
      images.map(ref => ({ visualTokens: imageTokens(ref), text: '' })) }
  }
  private async models(profile: ProviderConfig): Promise<ModelConfig[]> {
    return (profile.nativeContextMode === 'codex-v2' ? await this.discover?.(profile.baseURL) : undefined) ?? profile.models
  }
  private async snapshot(provider: string, model: string): Promise<{ profile: ProviderConfig; model: LlmResolvedModelInfo }> {
    const profile = structuredClone(this.config().providers[provider])
    if (!profile) throw new LlmError('Responses provider is no longer configured', 'NO_ADAPTER')
    const info = (await this.models(profile)).find(value => value.id === model)
    if (!info) throw new LlmError('Declare context and output capacities for this Responses model', 'UNKNOWN_MODEL')
    return { profile, model: { provider, id: model, name: model, inputModalities: ['text', 'image'],
      context: { contextWindow: info.contextWindow }, defaultMaxTokens: info.maxTokens,
      ...(info.reasoningEfforts?.length ? { reasoning: {
        efforts: info.reasoningEfforts.map(id => ({ id: ReasoningEffortId(id), name: id })),
        ...(info.defaultReasoningEffort === undefined ? {} : { defaultEffort: ReasoningEffortId(info.defaultReasoningEffort) }),
      } } : {}),
    } }
  }
  override async listModels(provider: string) {
    const profile = structuredClone(this.config().providers[provider])
    return profile ? (await this.models(profile)).map(model => ({ provider, id: model.id, name: model.id, inputModalities: ['text', 'image'] as const })) : []
  }
  override async resolveModel(provider: string, model: string) { return (await this.snapshot(provider, model)).model }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    signal?.throwIfAborted()
    const snapshot = await this.snapshot(provider, model)
    const connection = await this.connection(snapshot.profile, signal)
    const origin = this.origin(provider, model, connection, snapshot.profile.nativeContextMode)
    const wire = (options: GenerateOptions, input: JsonValue[]) => requestBody({ ...options,
      messages: options.messages.filter(message => message.role === 'system'),
      adapterContext: { format: NATIVE_FORMAT, scope: origin, input },
    }, origin, snapshot.profile.customApplyPatch)
    return { model: snapshot.model, stream: options => this.generate(options, snapshot.profile, connection), nativeContext: {
      format: NATIVE_FORMAT, scope: origin,
      encode: messages => requestBody({ provider, model, messages }, origin, snapshot.profile.customApplyPatch).input as JsonValue[],
      count: async (options, input) => {
        const body = wire(options, input)
        const counted = { model, input: body.input, ...body.tools ? { tools: body.tools } : {} }
        this.checkSize(snapshot.profile, counted)
        if (snapshot.profile.nativeContextMode === 'codex-v2') return estimateNativeTokens(counted, snapshot.profile.tokenEstimateMultiplier)
        const hydrated = await hydrateImages(counted, this.readImage, snapshot.profile.maxRequestBytes, options.signal)
        this.checkSize(snapshot.profile, hydrated.body)
        const response = await post(connection, 'responses/input_tokens', hydrated.body, options.signal)
        if (!Number.isSafeInteger(response.input_tokens) || (response.input_tokens as number) < 0) throw new LlmError('Native token counter returned no valid count', 'INVALID_TOKEN_COUNT')
        return response.input_tokens as number
      },
      compact: async (options, input) => {
        if (snapshot.profile.nativeContextMode === 'codex-v2') {
          const body = wire(options, [...input, { type: 'compaction_trigger' }])
          this.checkSize(snapshot.profile, body)
          const hydrated = await hydrateImages(body, this.readImage, snapshot.profile.maxRequestBytes, options.signal)
          this.checkSize(snapshot.profile, hydrated.body)
          const response = await post(connection, 'responses', hydrated.body, options.signal)
          return codexCompactionWindow(input as Item[], response) as JsonValue[]
        }
        const instructions = options.messages.filter(message => message.role === 'system').flatMap(message => message.content.map(block => block.type === 'text' ? block.text : '')).join('\n')
        const body = { model, input, ...instructions ? { instructions } : {} }
        this.checkSize(snapshot.profile, body)
        const hydrated = await hydrateImages(body, this.readImage, snapshot.profile.maxRequestBytes, options.signal)
        this.checkSize(snapshot.profile, hydrated.body)
        const response = await post(connection, 'responses/compact', hydrated.body, options.signal)
        return hydrated.restore(this.compactOutput(response)) as JsonValue[]
      },
    } }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* (await this.prepareCall(options.provider, options.model, options.signal)).stream(options)
  }
  private async connection(profile: ProviderConfig, signal?: AbortSignal): Promise<Connection> {
    signal?.throwIfAborted()
    const apiKey = await this.key(profile)
    signal?.throwIfAborted()
    const accountIdentity = await this.account?.(profile.baseURL)
    signal?.throwIfAborted()
    return { ...profile, apiKey, accountIdentity }
  }
  private origin(provider: string, model: string, connection: Connection, mode: ProviderConfig['nativeContextMode']): string {
    const base = [provider, model, connection.baseURL.replace(/\/+$/, ''), fingerprint(connection.apiKey)]
    if (connection.accountIdentity) base.push('cpa-account', connection.accountIdentity)
    return fingerprint(mode === 'codex-v2' ? [...base, 'codex-v2'] : base)
  }
  private checkSize(profile: ProviderConfig, body: Item): void {
    if (Buffer.byteLength(JSON.stringify(body)) > profile.maxRequestBytes) throw new LlmError('Responses request exceeds configured limit', 'RESPONSES_SIZE_LIMIT')
  }
  private async *generate(options: GenerateOptions, profile: ProviderConfig, connection: Connection): AsyncIterable<StreamChunk> {
    const origin = this.origin(options.provider, options.model, connection, profile.nativeContextMode)
    const body = requestBody(options, origin, profile.customApplyPatch)
    if (Buffer.byteLength(JSON.stringify(body)) > profile.maxRequestBytes) throw new LlmError('Responses request exceeds configured limit', 'RESPONSES_SIZE_LIMIT')
    const hydrated = await hydrateImages(body, this.readImage, profile.maxRequestBytes, options.signal)
    this.checkSize(profile, hydrated.body)
    const response = await post(connection, 'responses', hydrated.body, options.signal)
    options.signal?.throwIfAborted()
    const incomplete = response.status === 'incomplete'
    if (response.status !== 'completed' && !incomplete) throw new LlmError('Responses did not complete', 'RESPONSES_GENERATION_FAILED')
    if (typeof response.id !== 'string' || !response.id) throw new LlmError('Responses response has no identity', 'INVALID_RESPONSES_PAYLOAD')
    const blocks = blocksFromOutput(response.output)
    const usage = usageFromResponse(response.usage)
    // Never execute partial tool inputs. A truncated reply reports usage and its terminal reason only.
    if (incomplete) {
      if (!record(response.incomplete_details) || response.incomplete_details.reason !== 'max_output_tokens') throw new LlmError('Responses stopped before completion', 'RESPONSES_GENERATION_FAILED')
      if (usage) yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
      return
    }
    if (!blocks.length) throw new LlmError('Responses produced no visible output or tools', 'EMPTY_RESPONSE')
    for (const [index, block] of blocks.entries()) {
      yield { type: 'block-start', index, blockType: block.type }
      if (block.type === 'text') yield { type: 'text-delta', index, text: block.text }
      else if (block.type === 'reasoning') yield { type: 'reasoning-delta', index, text: block.text }
      else if (block.type === 'tool-call') yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index, block }
    }
    if (usage) yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: blocks.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' },
      replayState: replayEnvelope(response.output as Item[], response.id, origin, blocks) }
  }

  /** Explicit compact transport only. Caller owns context budgeting, durable commit, and selection. */
  async compact(provider: string, model: string, input: readonly Item[], signal?: AbortSignal): Promise<{ output: Item[]; usage?: ReturnType<typeof usageFromResponse> }> {
    const { profile } = await this.snapshot(provider, model)
    const v2 = profile.nativeContextMode === 'codex-v2'
    const body = v2 ? { model, input: [...structuredClone(input), { type: 'compaction_trigger' }], stream: true, store: false, include: ['reasoning.encrypted_content'] } : { model, input: structuredClone(input) }
    if (Buffer.byteLength(JSON.stringify(body)) > profile.maxRequestBytes) throw new LlmError('Compact request exceeds configured limit', 'RESPONSES_SIZE_LIMIT')
    const hydrated = await hydrateImages(body, this.readImage, profile.maxRequestBytes, signal)
    this.checkSize(profile, hydrated.body)
    const response = await post(await this.connection(profile, signal), v2 ? 'responses' : 'responses/compact', hydrated.body, signal)
    signal?.throwIfAborted()
    return { output: v2 ? codexCompactionWindow([...input], response) : hydrated.restore(this.compactOutput(response)), usage: usageFromResponse(response.usage) }
  }
  private compactOutput(response: Item): Item[] {
    if (!Array.isArray(response.output) || !response.output.every(record)
      || !response.output.some(item => item.type === 'compaction' && typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0)) {
      throw new LlmError('Compact response has no complete encrypted window', 'INVALID_COMPACTION')
    }
    // Retained messages/tool items are part of the checkpoint, never discard them.
    return structuredClone(response.output)
  }
}

export const name = 'dsh-gpt-responses'
export const inject = ['llm']
/** Install a separate provider entry; duplicate IDs fail rather than hijacking another adapter. */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  let current = config
  const adapter = new ResponsesAdapter(() => current, async profile => {
    const ref = credentialRef(profile.apiKeyEnv)
    const credentials = ctx.get('credentials')
    const value = credentials ? (await credentials.resolve(ref))?.value : launchEnvironmentOf(ctx).get(ref)?.value
    if (value === undefined) throw new LlmError(`No credential configured for ${ref}`, 'MISSING_CREDENTIAL')
    return assertUsableApiKey(value, name, ref)
  }, endpoint => ctx.get('gptCpaAccounts')?.identity(endpoint) ?? Promise.resolve(undefined),
  endpoint => ctx.get('gptCpaAccounts')?.models(endpoint) ?? Promise.resolve(undefined),
  async (ref, signal) => {
    const attachments = ctx.get('attachments')
    if (!attachments) throw new LlmError('DSH image storage is unavailable', 'IMAGE_STORAGE_UNAVAILABLE')
    return attachments.readImage(ref, signal)
  })
  const registration = ctx.llm.registerAdapter(Object.keys(current.providers), adapter)
  const directoryEntries = (value: Config) => Object.keys(value.providers).map(provider => ({
    provider, displayName: provider, settingsNs: 'gpt-responses', settingsPath: ['providers', provider], declared: true,
  }))
  const directory = ctx.llm.registerConfigurableProviders(directoryEntries(current))
  const validate = (candidate: Config) => {
    validateConfig(candidate)
    const occupied = new Set([
      ...ctx.llm.listProviders().map(value => value.id),
      ...ctx.llm.listConfigurableProviders().map(value => value.provider),
    ])
    for (const id of Object.keys(candidate.providers)) {
      if (!(id in current.providers) && occupied.has(id)) throw new Error(`Provider ${id} belongs to another adapter`)
    }
  }
  ctx.inject(['settings'], settingsCtx => {
    let source = () => config
    const update = () => {
      const candidate = source()
      validate(candidate)
      const previous = current
      current = structuredClone(candidate)
      try {
        registration.replace(Object.keys(current.providers))
        directory.replace(directoryEntries(current))
      } catch (error) { current = previous; throw error }
    }
    settingsCtx.settings.installSection(ctx, 'gpt-responses', Config, config, {
      validate,
      setSource: value => { source = value },
      onChange: update,
    })
  })
}
