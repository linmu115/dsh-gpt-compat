import { expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { win32 } from 'node:path'
import { launchLocal } from '../src/accounts/local.ts'
import { matchCpaProcess, processConfig, WINDOWS_ARGUMENT_PARSER, type CpaProcess } from '../src/accounts/local-process.ts'

const config = { executable: 'D:/AI/CPA/cli-proxy-api.exe', configFile: 'D:/AI/CPA/config.yaml', passwordFile: 'D:/AI/CPA/.local/key.txt' }
const canonical = async (value: string) => win32.normalize(value)
const process = (file: string): CpaProcess => ({ executable: config.executable, args: [config.executable, '--config', file] })

it('reuses only the same canonical executable and config, not another config of that executable', async () => {
  expect(await matchCpaProcess(config.executable, config.configFile, [process('D:/AI/CPA-Friends/config.yaml')], canonical)).toBe('none')
  expect(await matchCpaProcess(config.executable, config.configFile, [process('d:\\ai\\cpa\\sub\\..\\CONFIG.yaml')], canonical)).toBe('same')
  expect(await matchCpaProcess(config.executable, config.configFile, [{ executable: 'D:/Other/cli-proxy-api.exe', args: null }], canonical)).toBe('none')
})
it('compares realpath identities so a config alias is not treated as a distinct launch', async () => {
  const resolve = async (p: string) => p === 'D:/alias.yaml' ? win32.normalize(config.configFile) : canonical(p)
  expect(await matchCpaProcess(config.executable, config.configFile, [process('D:/alias.yaml')], resolve)).toBe('same')
})
it.each([
  null, [], ['cpa.exe'], ['cpa.exe', '--config'], ['cpa.exe', '--config', 'relative.yaml'],
  ['cpa.exe', '--config', config.configFile, '--config', config.configFile],
  ['cpa.exe', '--', '--config', config.configFile], ['cpa.exe', 'positional', '--config', config.configFile],
])('rejects ambiguous process config %j', args => { expect(processConfig(args as string[] | null)).toBeUndefined() })
it('accepts Go config flag spellings and an unrelated password-file option', () => {
  for (const args of [ ['x', '-config', config.configFile], ['x', `--config=${config.configFile}`], ['x', `-config=${config.configFile}`, '--local-management-password-file', config.passwordFile] ]) expect(processConfig(args)).toBe(config.configFile)
})
it('does not ignore unreadable metadata or an ambiguous same-executable process', async () => {
  expect(await matchCpaProcess(config.executable, config.configFile, [{ executable: null, args: null }], canonical)).toBe('ambiguous')
  expect(await matchCpaProcess(config.executable, config.configFile, [{ executable: config.executable, args: null }], canonical)).toBe('ambiguous')
  expect(await matchCpaProcess(config.executable, config.configFile, [process(config.configFile), { executable: config.executable, args: null }], canonical)).toBe('ambiguous')
})

function ports(rows: CpaProcess[] = []) {
  return { check: vi.fn(async () => undefined), canonical, lock: vi.fn(async () => ({ close: vi.fn(async () => {}) })), remove: vi.fn(async () => {}),
    probe: vi.fn(async () => 'stopped' as const), processes: vi.fn(async () => rows),
    match: (exe: string, file: string, values: readonly CpaProcess[]) => matchCpaProcess(exe, file, values, canonical), spawn: vi.fn(async () => {}), }
}
it('launches the requested configuration when the same executable owns a different configuration', async () => {
  const p = ports([process('D:/AI/CPA-Friends/config.yaml')])
  await launchLocal(config, 'http://127.0.0.1:8317', p)
  expect(p.spawn).toHaveBeenCalledWith({ executable: win32.normalize(config.executable), configFile: win32.normalize(config.configFile), passwordFile: win32.normalize(config.passwordFile) })
  expect(p.remove).toHaveBeenCalledTimes(1)
})
it('waits for the exact existing process rather than spawning another one', async () => {
  const p = ports([process(config.configFile)])
  await launchLocal(config, 'http://127.0.0.1:8317', p)
  expect(p.spawn).not.toHaveBeenCalled()
  expect(p.remove).toHaveBeenCalledTimes(1)
})
it('fails closed on ambiguity without spawning or touching other processes', async () => {
  const p = ports([{ executable: config.executable, args: null }])
  await expect(launchLocal(config, 'http://127.0.0.1:8317', p)).rejects.toThrow('localLaunchFailed')
  expect(p.spawn).not.toHaveBeenCalled(); expect(p.remove).toHaveBeenCalledTimes(1)
})
it('rechecks endpoint identity under the lock and does not spawn over an already ready endpoint', async () => {
  const p = { ...ports(), probe: vi.fn(async () => 'running' as const) }
  await launchLocal(config, 'http://127.0.0.1:8317', p)
  expect(p.probe).toHaveBeenCalledWith('http://127.0.0.1:8317')
  expect(p.processes).not.toHaveBeenCalled(); expect(p.spawn).not.toHaveBeenCalled()
})
it('never removes another owner lock, but recognizes the requested endpoint becoming ready', async () => {
  const p = { ...ports(), lock: vi.fn(async () => { throw Object.assign(Error(), { code: 'EEXIST' }) }) }
  await expect(launchLocal(config, 'http://127.0.0.1:8317', p)).rejects.toThrow('localStarting')
  expect(p.remove).not.toHaveBeenCalled(); expect(p.spawn).not.toHaveBeenCalled()
  await launchLocal(config, 'http://127.0.0.1:8317', { ...p, probe: async () => 'running' })
  expect(p.remove).not.toHaveBeenCalled()
})
it('does not launch over an endpoint whose bounded HTTP identity is unavailable', async () => {
  const p = { ...ports(), probe: async () => 'unavailable' as const }
  await expect(launchLocal(config, 'http://127.0.0.1:8317', p)).rejects.toThrow('localLaunchFailed')
  expect(p.spawn).not.toHaveBeenCalled(); expect(p.remove).toHaveBeenCalledTimes(1)
})
it.runIf(globalThis.process.platform === 'win32')('uses real CommandLineToArgvW for spaces, Unicode, equals syntax and escaped quotes', async () => {
  const fixtures = [
    '"D:\\AI Test\\cli-proxy-api.exe" --config "D:\\配置 Test\\config.yaml" --local-management-password-file "D:\\Private Space\\key.txt"',
    'D:\\CPA\\cli-proxy-api.exe --config="D:\\A B\\config.yaml"',
    'cpa.exe "a\\\"b"',
  ]
  const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $ErrorActionPreference='Stop';\n${WINDOWS_ARGUMENT_PARSER}\n$commands=ConvertFrom-Json $env:DSH_CPA_TEST_COMMANDS; $rows=@(foreach($command in $commands) { @{args=[DshCpaArguments]::Parse($command)} }); ConvertTo-Json -InputObject $rows -Depth 4 -Compress`
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000, env: { ...globalThis.process.env, DSH_CPA_TEST_COMMANDS: JSON.stringify(fixtures) } })
  const rows = JSON.parse(stdout) as { args: string[] }[]
  expect(processConfig(rows[0]!.args)).toBe('D:\\配置 Test\\config.yaml')
  expect(processConfig(rows[1]!.args)).toBe('D:\\A B\\config.yaml')
  expect(rows[2]!.args).toEqual(['cpa.exe', 'a"b'])
})
