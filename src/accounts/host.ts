import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import { AccountError, CpaAccounts } from './cpa.ts'
import type { ModelConfig } from '../responses.ts'

export const name = 'dsh-gpt-compat-accounts'
export const inject = ['connection', 'credentials']
declare module '@deepseek-ai/cordis' {
  interface Context { gptCpaAccounts: { identity(endpoint: string): Promise<string | undefined>; models(endpoint: string): Promise<ModelConfig[] | undefined> } }
}
export interface Config { endpoint: string; managementKeyRef: string }
export const Config: z<Config> = z.object({
  endpoint: z.string().default('http://127.0.0.1:8317'),
  managementKeyRef: z.string().default('DSH_GPT_CPA_MANAGEMENT_KEY'),
})
export function apply(ctx: Context, config: Config): void {
  const ref = credentialRef(config.managementKeyRef)
  const service = new CpaAccounts(config.endpoint, {
    get: async () => (await ctx.credentials.resolve(ref))?.value,
    set: value => ctx.credentials.set(ref, value),
  })
  let catalogSignature: string | undefined
  const notify = () => ctx.emit('llm/adapters-updated')
  ctx.provide('gptCpaAccounts', { identity: endpoint => service.identity(endpoint), models: async endpoint => {
    const models = await service.models(endpoint)
    if (models !== undefined) {
      const signature = JSON.stringify(models), previous = catalogSignature
      catalogSignature = signature
      if (previous !== undefined && previous !== signature) notify()
    }
    return models
  } })
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/gpt-compat.accounts', methods: ['POST'], requestBody: 'buffered',
    fetch: request => handleAccounts(service, request, notify),
  }), 'GPT account management')
}

/** The Connection service supplies authentication and Host/Origin validation. */
export async function handleAccounts(service: CpaAccounts, request: Request, catalogChanged?: () => void): Promise<Response> {
  const headers = { 'cache-control': 'no-store' }
  let refreshCatalog = false
  try {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AccountError('invalidInput')
    const raw = await request.text()
    if (raw.length > 8192) throw new AccountError('invalidInput')
    let input: Record<string, unknown>
    try { input = JSON.parse(raw) } catch { throw new AccountError('invalidInput') }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccountError('invalidInput')
    refreshCatalog = ['list', 'configure', 'switch', 'logout', 'login', 'loginStatus'].includes(String(input.action))
    const str = (key: string) => { if (typeof input[key] !== 'string' || (input[key] as string).length > 4096) throw new AccountError('invalidInput'); return input[key] as string }
    let value: unknown
    switch (input.action) {
      case 'list': value = await service.list(); break
      case 'configure': value = await service.configure(str('key')); break
      case 'quota': value = await service.quota(str('id')); break
      case 'switch': value = await service.switch(str('id'), str('revision')); break
      case 'logout': value = await service.logout(str('id'), str('revision')); break
      case 'login': value = await service.login(); break
      case 'loginStatus': value = await service.loginStatus(str('id')); break
      default: throw new AccountError('invalidInput')
    }
    return Response.json({ ok: true, value }, { headers })
  } catch (error) {
    return Response.json({ ok: false, code: error instanceof AccountError ? error.code : 'internal' }, { headers, status: 400 })
  } finally { if (refreshCatalog) catalogChanged?.() }
}
