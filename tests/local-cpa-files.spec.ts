import { expect, it, vi } from 'vitest'
vi.mock('node:fs/promises', async original => ({ ...await original<object>(), stat: vi.fn() }))
import { stat } from 'node:fs/promises'
import { checkLocalLaunch } from '../src/accounts/local.ts'
const config = { executable: 'C:/CPA/cli-proxy-api.exe', configFile: 'C:/CPA/config.yaml', passwordFile: 'C:/private/management-password.txt' }
it.runIf(process.platform === 'win32')('reports a file access failure without logging paths or error text', async () => {
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(stat).mockImplementation(async path => {
    if (path === config.passwordFile) throw Object.assign(new Error('private data must not be logged'), { code: 'EACCES' })
    return { isFile: () => true } as Awaited<ReturnType<typeof stat>>
  })
  try {
    expect(await checkLocalLaunch(config)).toBe('localPasswordMissing')
    expect(await checkLocalLaunch(config)).toBe('localPasswordMissing')
    expect(log).toHaveBeenCalledTimes(1)
    const diagnostic = JSON.parse(log.mock.calls[0]![1])
    expect(diagnostic).toMatchObject({ code: 'EACCES', issue: 'localPasswordMissing', pathLength: config.passwordFile.length })
    expect(diagnostic.pathSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(log.mock.calls)).not.toContain(config.passwordFile)
    expect(JSON.stringify(log.mock.calls)).not.toContain('private data')
  } finally { log.mockRestore() }
})
