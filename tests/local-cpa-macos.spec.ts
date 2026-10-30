import { expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkLocalLaunch, normalizeLocalLaunch } from '../src/accounts/local.ts'
import { matchCpaProcess, processConfig } from '../src/accounts/local-process.ts'
import { decodeDarwinArguments, readDarwinCpaProcesses } from '../src/accounts/local-process-darwin.ts'

it('preserves POSIX case and literal spaces while retaining Windows normalization', async () => {
  const config = { executable: '/Apps/CPA App/cpa', configFile: '/配置/A.yaml', passwordFile: '/Private/key' }
  expect(normalizeLocalLaunch(config, 'darwin')).toEqual(config)
  expect(processConfig([config.executable, '--config', config.configFile], 'darwin')).toBe(config.configFile)
  expect(processConfig(['cpa', '--config', 'C:/Windows.yaml'], 'darwin')).toBeUndefined()
  const canonical = async (path: string) => path
  expect(await matchCpaProcess(config.executable, config.configFile, [{ executable: config.executable, args: [config.executable, '--config', '/配置/a.yaml'] }], canonical, 'darwin')).toBe('none')
  expect(normalizeLocalLaunch({ executable: 'C:/CPA/cpa.exe', configFile: 'C:/CPA/config', passwordFile: 'C:/CPA/password' }, 'win32').executable).toBe('C:\\CPA\\cpa.exe')
})

it('decodes native argv with spaces, Unicode and empty arguments without returning environment', () => {
  const head = Buffer.alloc(4); head.writeInt32LE(4)
  const payload = Buffer.concat([head, Buffer.from('/Apps/My CPA\0\0\0/Apps/My CPA\0--config\0/配置 A/config.yaml\0\0SECRET=never-return\0')])
  expect(decodeDarwinArguments(payload)).toEqual({ executable: '/Apps/My CPA', args: ['/Apps/My CPA', '--config', '/配置 A/config.yaml', ''] })
  expect(() => decodeDarwinArguments(payload.subarray(0, 12))).toThrow()
})

it.runIf(process.platform === 'darwin')('requires a runnable macOS executable and checks real kernel argv of an owned child', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cpa-mac-'))
  const executable = join(root, 'test CPA 中文')
  const config = { executable, configFile: join(root, 'config.yaml'), passwordFile: join(root, 'password.txt') }
  let child: ReturnType<typeof spawn> | undefined
  try {
    await copyFile('/bin/sleep', executable)
    await writeFile(config.configFile, 'fixture: true')
    await writeFile(config.passwordFile, 'synthetic')
    await chmod(executable, 0o600)
    expect(await checkLocalLaunch(config, 'darwin')).toBe('localExecutableNotRunnable')
    await chmod(executable, 0o700)
    expect(await checkLocalLaunch(config, 'darwin')).toBeUndefined()
    child = spawn(executable, ['30'], { stdio: 'ignore' })
    await once(child, 'spawn')
    const rows = await readDarwinCpaProcesses(executable)
    expect(rows).toContainEqual({ executable, args: [executable, '30'] })
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
    await rm(root, { recursive: true, force: true })
  }
})
