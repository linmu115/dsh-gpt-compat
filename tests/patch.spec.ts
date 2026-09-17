import { describe, expect, it } from 'vitest'
import { parsePatch, editText } from '../src/patch.ts'
import { Config, matches, validateConfig } from '../src/config.ts'
import { boundText } from '../src/processes.ts'

describe('patch format', () => {
  it('parses add, update with move, and delete before editing', () => {
    const operations = parsePatch('*** Begin Patch\n*** Add File: 新.txt\n+你好\n*** Update File: a\n*** Move to: b\n@@\n-old\n+new\n*** Delete File: c\n*** End Patch')
    expect(operations).toHaveLength(3)
    expect(operations[0]).toEqual({ kind: 'add', path: '新.txt', text: '你好\n' })
    expect(operations[1]).toMatchObject({ kind: 'update', moveTo: 'b' })
  })
  it('applies multiple ordered hunks and preserves CRLF', () => {
    expect(editText('a\r\nb\r\nc\r\n', [
      { before: ['a'], after: ['A'], eof: false },
      { before: ['c'], after: ['C'], eof: true },
    ])).toBe('A\r\nb\r\nC\r\n')
  })
  it('refuses ambiguous or missing context and malformed input', () => {
    expect(() => editText('x\nx\n', [{ before: ['x'], after: ['y'], eof: false }])).toThrow('ambiguous')
    expect(() => editText('x\n', [{ before: ['z'], after: ['y'], eof: false }])).toThrow('does not match')
    expect(() => parsePatch('*** Begin Patch\n*** Add File: x\nnot-prefixed\n*** End Patch')).toThrow()
    expect(() => parsePatch('*** Begin Patch\n*** End Patch')).toThrow()
  })
})
describe('binding and limits', () => {
  it('matches only an explicit provider and model range', () => {
    const config = Config({ bindings: [{ provider: 'cpa', models: ['gpt-*'] }] })
    validateConfig(config)
    expect(matches(config, 'cpa', 'gpt-5')).toBe(true)
    expect(matches(config, 'other', 'gpt-5')).toBe(false)
    expect(matches(config, 'cpa', 'deepseek')).toBe(false)
    expect(() => validateConfig(Config({ bindings: [{ provider: 'cpa', models: ['*'] }] }))).toThrow()
  })
  it('bounds Unicode output including the truncation marker', () => {
    const result = boundText('中文🙂'.repeat(100), 128)
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(128)
    expect(result).not.toContain('\uFFFD')
    expect(result).toContain('truncated')
  })
})
