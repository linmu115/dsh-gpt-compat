import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import type { CpaProcess } from './local-process.ts'

/** Decode only argv from KERN_PROCARGS2; environment entries are never returned. */
export function decodeDarwinArguments(buffer: Buffer): CpaProcess {
  if (buffer.length < 5) throw new Error('Incomplete process arguments')
  const argc = buffer.readInt32LE(0)
  if (argc < 1 || argc > 65536) throw new Error('Invalid argument count')
  let offset = 4
  const read = () => {
    const end = buffer.indexOf(0, offset)
    if (end < 0) throw new Error('Incomplete process arguments')
    const value = buffer.toString('utf8', offset, end)
    offset = end + 1
    return value
  }
  const executable = read()
  while (offset < buffer.length && buffer[offset] === 0) offset++
  const args: string[] = []
  for (let index = 0; index < argc; index++) args.push(read())
  return { executable, args }
}

/** Observe native argv without guessing where spaces in ps output split arguments. */
export async function readDarwinCpaProcesses(executable: string): Promise<CpaProcess[]> {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-ww', '-U', String(process.getuid!()), '-o', 'pid=,comm='], { timeout: 10000, maxBuffer: 1048576 })
  const pids = stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    return match && basename(match[2]!) === basename(executable) ? [Number(match[1])] : []
  })
  if (!pids.length) return []
  const { default: koffi } = await import('koffi')
  const libc = koffi.load('/usr/lib/libSystem.B.dylib')
  const sysctl = libc.func('int sysctl(const int *name, unsigned int namelen, void *oldp, _Inout_ size_t *oldlenp, const void *newp, size_t newlen)')
  try {
    return pids.map(pid => {
      const bytes = Buffer.alloc(1048576)
      const length = [bytes.length]
      if (sysctl([1, 49, pid], 3, bytes, length, null, 0) !== 0) {
        // A matching process can exit or deny inspection. Preserve ambiguity.
        return { executable: null, args: null }
      }
      try { return decodeDarwinArguments(bytes.subarray(0, length[0])) }
      catch { return { executable: null, args: null } }
    })
  } finally { libc.unload() }
}
