import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { win32 } from 'node:path'

/** Native Windows tokenization, including quoted paths and escaped quotes. */
export const WINDOWS_ARGUMENT_PARSER = String.raw`
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class DshCpaArguments {
 [DllImport("shell32.dll", SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string command, out int count);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
 public static string[] Parse(string command) {
  if (String.IsNullOrWhiteSpace(command)) throw new ArgumentException();
  int count; IntPtr ptr=CommandLineToArgvW(command,out count);
  if(ptr==IntPtr.Zero) throw new InvalidOperationException();
  try { var result=new string[count]; for(int i=0;i<count;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(ptr,i*IntPtr.Size)); return result; }
  finally { LocalFree(ptr); }
 }
}
'@
`

export interface CpaProcess { executable: string | null; args: string[] | null }
export async function readCpaProcesses(executable: string): Promise<CpaProcess[]> {
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();
${WINDOWS_ARGUMENT_PARSER}
$rows=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq $env:DSH_CPA_EXECUTABLE_NAME } | ForEach-Object {
 $argv=$null
 try { $argv=[DshCpaArguments]::Parse($_.CommandLine) } catch {}
 @{executable=$_.ExecutablePath;args=$argv}
})
ConvertTo-Json -InputObject $rows -Depth 4 -Compress`
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 10000, maxBuffer: 262144,
    env: { ...process.env, DSH_CPA_EXECUTABLE_NAME: win32.basename(executable) },
  })
  const rows: unknown = JSON.parse(stdout)
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object'
    || (row.executable !== null && typeof row.executable !== 'string')
    || (row.args !== null && (!Array.isArray(row.args) || row.args.some((arg: unknown) => typeof arg !== 'string'))))) throw new Error('Invalid process observation')
  return rows as CpaProcess[]
}

/** A relative/default/duplicate config cannot be tied to a process cwd safely. */
export function processConfig(args: readonly string[] | null): string | undefined {
  if (!args?.length) return undefined
  let config: string | undefined
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--config' || arg === '-config') {
      if (config !== undefined || !args[i + 1] || args[i + 1]!.startsWith('-')) return undefined
      config = args[++i]
    } else if (arg.startsWith('--config=') || arg.startsWith('-config=')) {
      if (config !== undefined) return undefined
      config = arg.slice(arg.indexOf('=') + 1)
    } else if (arg === '--local-management-password-file' || arg === '-local-management-password-file') {
      if (!args[++i]) return undefined
    } else if (!arg.startsWith('--local-management-password-file=') && !arg.startsWith('-local-management-password-file=')) {
      // Unknown options, positional arguments and -- can change Go flag parsing.
      return undefined
    }
  }
  return config && win32.isAbsolute(config) ? config : undefined
}

export type ProcessMatch = 'same' | 'none' | 'ambiguous'
export async function matchCpaProcess(executable: string, configFile: string, rows: readonly CpaProcess[], canonical: (path: string) => Promise<string> = realpath): Promise<ProcessMatch> {
  const key = async (value: string) => win32.normalize(await canonical(value)).toLowerCase()
  const expectedExe = await key(executable), expectedConfig = await key(configFile)
  let found = false
  for (const row of rows) {
    if (!row.executable) return 'ambiguous'
    let actualExe: string
    try { actualExe = await key(row.executable) } catch { return 'ambiguous' }
    if (actualExe !== expectedExe) continue
    const selected = processConfig(row.args)
    if (!selected) return 'ambiguous'
    try { if (await key(selected) === expectedConfig) found = true } catch { return 'ambiguous' }
  }
  return found ? 'same' : 'none'
}
