/** Durable image references stay in checkpoints; bytes exist only at the HTTP boundary. */
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { LlmError } from '@deepseek-ai/dsh-llm'

type Item = Record<string, unknown>
export type ImageReader = (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>
const object = (value: unknown): value is Item => !!value && typeof value === 'object' && !Array.isArray(value)

/** Neutral budget allowance, not a provider billing/tokenizer guarantee. */
export function imageTokens(ref: ImageAttachmentRef): number {
  if (!ref || typeof ref.attachmentId !== 'string' || !ref.attachmentId
    || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(ref.mediaType)
    || ![ref.width, ref.height, ref.bytes].every(n => Number.isSafeInteger(n) && n > 0))
    throw new LlmError('Invalid durable image reference', 'INVALID_IMAGE_REFERENCE')
  return Math.max(4096, Math.ceil(ref.width / 32) * Math.ceil(ref.height / 32) * 2)
}

export function imagePart(ref: ImageAttachmentRef): Item {
  imageTokens(ref)
  return { type: 'input_image', detail: 'auto', dsh_attachment: structuredClone(ref) }
}

/** Visit only message/tool content, never JSON tool arguments or tool schemas. */
export function mapImages(body: Item, map: (part: Item) => Item): Item {
  const parts = (value: unknown) => Array.isArray(value)
    ? value.map(part => object(part) && part.type === 'input_image' ? map(part) : part) : value
  return { ...body, input: Array.isArray(body.input) ? body.input.map(item => {
    if (!object(item)) return item
    return { ...item, ...('content' in item ? { content: parts(item.content) } : {}),
      ...('output' in item ? { output: parts(item.output) } : {}) }
  }) : body.input }
}

export async function hydrateImages(body: Item, read: ImageReader | undefined, maxBytes: number, signal?: AbortSignal) {
  const pending = new Map<string, { ref: ImageAttachmentRef; url?: string }>()
  let projectedBytes = Buffer.byteLength(JSON.stringify(body))
  mapImages(body, part => {
    if (part.dsh_attachment === undefined) return part
    const ref = part.dsh_attachment as ImageAttachmentRef
    imageTokens(ref)
    projectedBytes += 4 * Math.ceil(ref.bytes / 3) + 64
    pending.set(JSON.stringify(ref), { ref })
    return part
  })
  if (projectedBytes > maxBytes) throw new LlmError('Image request exceeds configured byte limit', 'RESPONSES_SIZE_LIMIT')
  for (const value of pending.values()) {
    signal?.throwIfAborted()
    if (!read) throw new LlmError('DSH image storage is unavailable', 'IMAGE_STORAGE_UNAVAILABLE')
    const stored = await read(value.ref, signal)
    signal?.throwIfAborted()
    if (stored.data.byteLength !== value.ref.bytes || stored.ref.attachmentId !== value.ref.attachmentId
      || stored.ref.mediaType !== value.ref.mediaType)
      throw new LlmError('Stored image does not match its reference', 'INVALID_IMAGE_REFERENCE')
    value.url = `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`
  }
  const hydrated = mapImages(body, part => part.dsh_attachment === undefined ? part : {
    type: 'input_image', detail: part.detail ?? 'auto', image_url: pending.get(JSON.stringify(part.dsh_attachment))!.url,
  })
  const restore = (input: Item[]): Item[] => mapImages({ input }, part => {
    const match = [...pending.values()].find(value => value.url === part.image_url)
    return match ? imagePart(match.ref) : part
  }).input as Item[]
  return { body: hydrated, restore }
}
