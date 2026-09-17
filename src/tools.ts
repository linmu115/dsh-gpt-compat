/** Compatibility tools use DSH's guarded execution pipeline and filesystem/shell services. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { editText, parsePatch } from './patch.ts'
import { boundText, ProcessPool } from './processes.ts'
import type { Config } from './config.ts'

interface PlannedFile { path: string; target: FsTarget; before?: { text: string; version: FsVersion }; after?: string }

/** All syntax, input limits and hunk matches are checked before the first mutation. */
export async function applyPatch(ctx: Context, agent: Agent, config: Config, text: string, exec: ToolRunContext): Promise<string> {
  if (Buffer.byteLength(text) > config.maxPatchBytes) throw new Error('Patch exceeds configured input limit')
  const patches = parsePatch(text)
  if (patches.some(patch => patch.kind === 'delete' || (patch.kind === 'update' && patch.moveTo)) && !ctx.fs.supportsFileRemoval) {
    throw new Error('This filesystem provider does not support guarded deletion or moves')
  }
  const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
  if (ctx.fs.sandboxMode !== undefined && !policy) throw new Error('Sandboxed filesystem requires sandboxPolicy')
  const plan: PlannedFile[] = []
  const seen = new Set<string>()
  const inspect = async (path: string, required: boolean): Promise<PlannedFile> => {
    const target = await ctx.fs.resolve(path, { cwd: agent.session.header.cwd, signal: exec.signal })
    if (seen.has(target.targetKey)) throw new Error(`Patch addresses the same file more than once: ${path}`)
    seen.add(target.targetKey)
    const info = await ctx.fs.stat(target, exec.signal)
    if (!required) {
      if (info) throw new Error(`Add/move target already exists: ${path}`)
      return { path, target }
    }
    if (!info || info.type !== 'file') throw new Error(`Patch target is not a regular file: ${path}`)
    if (info.size !== undefined && info.size > config.maxFileBytes) throw new Error(`File exceeds patch limit: ${path}`)
    const before = await ctx.fs.readText(target, exec.signal)
    if (Buffer.byteLength(before) > config.maxFileBytes) throw new Error(`File exceeds patch limit: ${path}`)
    const afterRead = await ctx.fs.stat(target, exec.signal)
    if (afterRead?.version !== info.version) throw new Error(`File changed while reading: ${path}`)
    ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
    return { path, target, before: { text: before, version: info.version } }
  }
  for (const patch of patches) {
    const file = await inspect(patch.path, patch.kind !== 'add')
    if (patch.kind === 'add') file.after = patch.text
    if (patch.kind === 'update') {
      const after = editText(file.before!.text, patch.hunks)
      if (patch.moveTo) {
        const destination = await inspect(patch.moveTo, false)
        destination.after = after
        if (Buffer.byteLength(after) > config.maxFileBytes) throw new Error(`Patched file exceeds limit: ${destination.path}`)
        plan.push(destination)
      } else file.after = after
    }
    if (file.after !== undefined && Buffer.byteLength(file.after) > config.maxFileBytes) throw new Error(`Patched file exceeds limit: ${file.path}`)
    plan.push(file)
  }
  const committed: string[] = []
  try {
    for (const file of plan) {
      exec.signal.throwIfAborted()
      if (file.after === undefined) {
        await ctx.fs.removeFile(file.target, { version: file.before!.version }, exec.signal, policy)
        ctx.emit('fs/observed', file.target, { kind: 'absent' }, exec)
        committed.push(`D ${file.path}`)
      } else {
        const result = await ctx.fs.writeText(file.target, file.after, file.before
          ? { kind: 'replaceIfVersion', version: file.before.version } : { kind: 'createIfAbsent' }, exec.signal, policy)
        ctx.emit('fs/observed', file.target, { kind: 'present', version: result.version }, exec)
        committed.push(`${file.before ? 'M' : 'A'} ${file.path}`)
      }
    }
  } catch (error) {
    throw new Error(`Patch stopped: ${String(error)}. Applied files: ${committed.join(', ') || '(none)'}. Re-read these files before retrying.`, { cause: error })
  }
  return boundText(`Success. Updated the following files:\n${committed.join('\n')}`, config.maxOutputBytes)
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], execute: ToolDefinition['execute']): ToolDefinition {
  return {
    name, description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
    execute,
  }
}

/** Register only in the provided agent scope; returning disposers makes every contribution reversible. */
export function installTools(ctx: Context, agent: Agent, config: Config, pool: ProcessPool): (() => void)[] {
  const assertOwner = (exec: ToolRunContext) => {
    if (exec.agent !== agent) throw new Error('Compatibility tool belongs to another agent')
  }
  const yieldMs = (value?: number) => value ?? config.yieldMs
  const waitField = { type: 'integer', minimum: 0, maximum: config.maxYieldMs, description: 'Wait before returning incremental output, in milliseconds.' }
  const definitions = [
    tool('apply_patch', 'Apply a patch using *** Begin Patch, Add/Update/Delete File, @@ hunks, and *** End Patch. Use exact context. Moves require a new destination.', { patch: { type: 'string' } }, ['patch'], async (raw, exec) => {
      assertOwner(exec)
      return applyPatch(ctx, agent, config, (raw as { patch: string }).patch, exec)
    }),
    tool('exec_command', 'Run a command in the configured DSH shell. Returns output and a session ID while running. Use write_stdin to collect more output, send input, or cancel.', {
      cmd: { type: 'string', minLength: 1 }, workdir: { type: 'string' }, yield_time_ms: waitField,
    }, ['cmd'], async (raw, exec) => {
      assertOwner(exec)
      const args = raw as { cmd: string; workdir?: string; yield_time_ms?: number }
      const policy = ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
      if (ctx.shell.sandboxMode !== undefined && !policy) throw new Error('Sandboxed shell requires sandboxPolicy')
      return pool.start(args.cmd, args.workdir ?? agent.session.header.cwd, exec.signal, policy, yieldMs(args.yield_time_ms), ctx.shellEnv.collect(exec))
    }),
    tool('write_stdin', 'Collect incremental command output. Supply chars to write stdin; \\u0003 cancels the command and \\u0004 closes stdin.', {
      session_id: { type: 'integer', minimum: 1 }, chars: { type: 'string' }, yield_time_ms: waitField,
    }, ['session_id'], async (raw, exec) => {
      assertOwner(exec)
      const args = raw as { session_id: number; chars?: string; yield_time_ms?: number }
      return pool.collect(args.session_id, args.chars ?? '', exec.signal, yieldMs(args.yield_time_ms))
    }),
  ]
  const disposers: (() => void)[] = []
  try {
    for (const definition of definitions) disposers.push(ctx.tools.register(definition))
    return disposers
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
}
