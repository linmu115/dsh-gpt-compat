/** Incremental SSE framing and visible Responses output, with terminal reconciliation. */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import { record, type Item } from './responses-wire.ts'
import { validateServerCompaction } from './responses-server-compaction.ts'

function invalid(): never { throw new LlmError('Responses stream disagrees with its terminal output', 'INVALID_RESPONSES_PAYLOAD') }

/** CR, LF and CRLF may all straddle reads; UTF-8 decoding belongs to the reader. */
export class SseFrames {
  private line = ''
  private data: string[] = []
  private afterCR = false
  push(text: string, eof = false): string[] {
    const frames: string[] = []
    const line = () => {
      if (!this.line) {
        if (this.data.length) frames.push(this.data.join('\n'))
        this.data = []
      } else if (this.line === 'data') this.data.push('')
      else if (this.line.startsWith('data:')) this.data.push(this.line.slice(5).replace(/^ /, ''))
      this.line = ''
    }
    for (const char of text) {
      if (this.afterCR) { this.afterCR = false; if (char === '\n') continue }
      if (char === '\r' || char === '\n') { line(); this.afterCR = char === '\r' }
      else this.line += char
    }
    if (eof) { if (this.line) line(); if (this.data.length) { frames.push(this.data.join('\n')); this.data = [] } }
    return frames
  }
}

interface Part { kind: 'text' | 'reasoning'; wire: string; text: string; sent: number; done: boolean; index?: number }
interface Output { id?: string; type?: string; done?: Item; parts: Map<number, Part> }
const integer = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : invalid()

export class ResponsesStreamProjection {
  private readonly outputs = new Map<number, Output>()
  private readonly opened: Part[] = []
  private responseId?: string
  private sequence?: number
  constructor(private readonly allowServerCompaction = false) {}

  accept(event: Item): StreamChunk[] {
    if (event.sequence_number !== undefined) {
      const sequence = integer(event.sequence_number)
      if (this.sequence !== undefined && sequence <= this.sequence) invalid()
      this.sequence = sequence
    }
    if ((event.type === 'response.created' || event.type === 'response.in_progress') && record(event.response)) {
      if (typeof event.response.id !== 'string' || !event.response.id) invalid()
      if (this.responseId && this.responseId !== event.response.id) invalid()
      this.responseId = event.response.id
    }
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
      if (!record(event.item) || typeof event.item.type !== 'string') invalid()
      const output = this.output(integer(event.output_index), event.item.id)
      if (output.type && output.type !== event.item.type) invalid()
      output.type = event.item.type
      if (event.type === 'response.output_item.done') {
        if (output.done) invalid()
        output.done = event.item
      }
    }
    const types: Record<string, [Part['kind'], string, string]> = {
      'response.output_text.delta': ['text', 'output_text', 'delta'],
      'response.output_text.done': ['text', 'output_text', 'text'],
      'response.refusal.delta': ['text', 'refusal', 'delta'],
      'response.refusal.done': ['text', 'refusal', 'refusal'],
      'response.reasoning_summary_text.delta': ['reasoning', 'summary_text', 'delta'],
      'response.reasoning_summary_text.done': ['reasoning', 'summary_text', 'text'],
    }
    const descriptor = typeof event.type === 'string' ? types[event.type] : undefined
    if (descriptor) {
      const [kind, wire, field] = descriptor
      const output = this.output(integer(event.output_index), event.item_id)
      const type = kind === 'text' ? 'message' : 'reasoning'
      if (output.type && output.type !== type) invalid()
      output.type = type
      const partIndex = integer(kind === 'reasoning' ? event.summary_index : event.content_index)
      const part = output.parts.get(partIndex) ?? { kind, wire, text: '', sent: 0, done: false }
      if (part.kind !== kind || part.wire !== wire || part.done || typeof event[field] !== 'string') invalid()
      if (field === 'delta') part.text += event[field]
      else {
        // A done-only proxy can still stream this text before response.completed.
        if (part.text && part.text !== event[field]) invalid()
        part.text = event[field] as string
        part.done = true
      }
      output.parts.set(partIndex, part)
    }
    return this.drain()
  }

  /** Nothing executable is yielded until every streamed part is reconciled. */
  complete(response: Item, blocks: ContentBlock[], allowTools = true): StreamChunk[] {
    if (this.responseId && response.id !== this.responseId) invalid()
    if (!Array.isArray(response.output)) invalid()
    const positions: { output: number; part: number; wire: string; block: ContentBlock }[] = []
    let cursor = 0
    for (const [index, raw] of response.output.entries()) {
      if (!record(raw)) invalid()
      const seen = this.outputs.get(index)
      if (seen && (seen.id !== undefined && seen.id !== raw.id || seen.type !== undefined && seen.type !== raw.type)) invalid()
      const parts = raw.type === 'message' ? raw.content : raw.type === 'reasoning' ? raw.summary : undefined
      if (Array.isArray(parts)) for (const [partIndex, part] of parts.entries()) {
        if (!record(part)) invalid()
        const text = part.type === 'refusal' ? part.refusal : part.text
        const streamed = seen?.parts.get(partIndex)
        if (streamed && (streamed.wire !== part.type || streamed.text !== text)) invalid()
        if (typeof text === 'string' && text.length) positions.push({ output: index, part: partIndex, wire: String(part.type), block: blocks[cursor++]! })
      }
      if (allowTools && (raw.type === 'function_call' || raw.type === 'custom_tool_call')) positions.push({ output: index, part: 0, wire: String(raw.type), block: blocks[cursor++]! })
      if (seen) for (const partIndex of seen.parts.keys()) if (!Array.isArray(parts) || partIndex >= parts.length) invalid()
    }
    if (cursor !== blocks.length || [...this.outputs.keys()].some(index => index >= (response.output as unknown[]).length)) invalid()
    // DSH assembles in first-seen order, not numeric index order. Incremental
    // delivery therefore advances only over a known contiguous visible prefix.
    for (const [index, part] of this.opened.entries()) {
      const position = positions[index]
      if (!position || this.outputs.get(position.output)?.parts.get(position.part) !== part) invalid()
    }
    const chunks: StreamChunk[] = []
    for (const [index, position] of positions.entries()) {
      const block = position.block
      if (!block) invalid()
      const part = this.outputs.get(position.output)?.parts.get(position.part)
      if (part?.index !== undefined) {
        if (part.index !== index || block.type !== part.kind || !('text' in block) || block.text !== part.text) invalid()
        if (part.sent < part.text.length) chunks.push({ type: part.kind === 'text' ? 'text-delta' : 'reasoning-delta', index, text: part.text.slice(part.sent) })
      } else {
        chunks.push({ type: 'block-start', index, blockType: block.type })
        if (block.type === 'text' || block.type === 'reasoning') chunks.push({ type: block.type === 'text' ? 'text-delta' : 'reasoning-delta', index, text: block.text })
        else if (block.type === 'tool-call') chunks.push({ type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments })
      }
      chunks.push({ type: 'block-end', index, block })
    }
    return chunks
  }

  private output(index: number, id: unknown): Output {
    if (id !== undefined && (typeof id !== 'string' || !id)) invalid()
    let output = this.outputs.get(index)
    if (!output) { output = { parts: new Map() }; this.outputs.set(index, output) }
    if (id !== undefined) {
      if (output.id !== undefined && output.id !== id) invalid()
      output.id = id as string
    }
    return output
  }
  private drain(): StreamChunk[] {
    const chunks: StreamChunk[] = []
    for (let index = 0; ; index++) {
      const output = this.outputs.get(index)
      if (output?.type === 'compaction' && this.allowServerCompaction && output.done) {
        validateServerCompaction(output.done)
        continue
      }
      if (!output || !['message', 'reasoning'].includes(output.type ?? '')) break
      const finalParts = output.done && (output.type === 'message' ? output.done.content : output.done.summary)
      for (let partIndex = 0; ; partIndex++) {
        const part = output.parts.get(partIndex)
        if (!part) {
          if (Array.isArray(finalParts) && partIndex >= finalParts.length) break
          return chunks
        }
        if (part.text) {
          if (part.index === undefined) { part.index = this.opened.length; this.opened.push(part); chunks.push({ type: 'block-start', index: part.index, blockType: part.kind }) }
          if (part.sent < part.text.length) chunks.push({ type: part.kind === 'text' ? 'text-delta' : 'reasoning-delta', index: part.index, text: part.text.slice(part.sent) })
          part.sent = part.text.length
        }
        if (!part.done) return chunks
      }
      if (!output.done) break
    }
    return chunks
  }
}
