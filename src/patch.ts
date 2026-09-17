/** Parser and preflight planner for Codex Begin/End Patch text; no filesystem side effects. */
export interface Hunk { anchor?: string; before: string[]; after: string[]; eof: boolean }
export type Patch = { kind: 'add'; path: string; text: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo?: string; hunks: Hunk[] }

function filePath(value: string): string {
  if (!value.trim() || value.includes('\0') || /[\r\n]/.test(value)) throw new Error('Patch requires a nonempty file path')
  return value
}

/** Parse a complete patch before any file is read or mutated. */
export function parsePatch(input: string): Patch[] {
  const lines = input.replace(/\r\n/g, '\n').trimEnd().split('\n')
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') throw new Error('Expected *** Begin Patch and *** End Patch')
  const result: Patch[] = []
  let i = 0
  while (i < lines.length) {
    const header = lines[i++]!
    if (header.startsWith('*** Add File: ')) {
      const path = filePath(header.slice(14)); const content: string[] = []
      while (i < lines.length && !lines[i]!.startsWith('*** ')) {
        const line = lines[i++]!
        if (!line.startsWith('+')) throw new Error(`Added lines must start with + (${path})`)
        content.push(line.slice(1))
      }
      result.push({ kind: 'add', path, text: content.length ? content.join('\n') + '\n' : '' })
    } else if (header.startsWith('*** Delete File: ')) {
      result.push({ kind: 'delete', path: filePath(header.slice(17)) })
    } else if (header.startsWith('*** Update File: ')) {
      const patch: Extract<Patch, { kind: 'update' }> = { kind: 'update', path: filePath(header.slice(17)), hunks: [] }
      if (lines[i]?.startsWith('*** Move to: ')) patch.moveTo = filePath(lines[i++]!.slice(13))
      while (i < lines.length && !/^\*\*\* (?:Add|Delete|Update) File:/.test(lines[i]!)) {
        const line = lines[i++]!
        if (line !== '@@' && !line.startsWith('@@ ')) throw new Error(`Expected @@ hunk (${patch.path})`)
        const hunk: Hunk = { before: [], after: [], eof: false, ...(line === '@@' ? {} : { anchor: line.slice(3) }) }
        while (i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('*** ')) {
          const row = lines[i++]!
          if (![' ', '+', '-'].includes(row[0] ?? '')) throw new Error(`Invalid patch line (${patch.path})`)
          if (row[0] !== '+') hunk.before.push(row.slice(1))
          if (row[0] !== '-') hunk.after.push(row.slice(1))
        }
        if (lines[i] === '*** End of File') { hunk.eof = true; i++ }
        if (!hunk.before.length && !hunk.after.length) throw new Error('Empty patch hunk')
        patch.hunks.push(hunk)
      }
      if (!patch.hunks.length) throw new Error(`Update has no hunks (${patch.path})`)
      result.push(patch)
    } else throw new Error(`Unrecognized patch header: ${header}`)
  }
  if (!result.length) throw new Error('Patch contains no file operations')
  return result
}

/** Apply ordered hunks, rejecting ambiguous matches and retaining existing line endings. */
export function editText(original: string, hunks: Hunk[]): string {
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  let cursor = 0
  for (const hunk of hunks) {
    if (hunk.anchor !== undefined) {
      const anchor = lines.findIndex((line, index) => index >= cursor && line === hunk.anchor)
      if (anchor < 0) throw new Error(`Patch context not found: ${hunk.anchor}`)
      cursor = anchor + 1
    }
    const candidates: number[] = []
    for (let start = cursor; start <= lines.length - hunk.before.length; start++) {
      if (hunk.eof && start + hunk.before.length !== lines.length) continue
      if (hunk.before.every((line, offset) => lines[start + offset] === line)) candidates.push(start)
    }
    const position = hunk.before.length === 0 ? lines.length : candidates.length === 1 ? candidates[0] : undefined
    if (position === undefined) throw new Error(candidates.length ? 'Patch context is ambiguous; include more context' : 'Patch context does not match the current file')
    lines.splice(position, hunk.before.length, ...hunk.after)
    cursor = position + hunk.after.length
  }
  return lines.length ? lines.join(newline) + newline : ''
}
