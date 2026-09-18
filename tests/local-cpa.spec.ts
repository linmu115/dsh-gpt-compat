import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { LocalCpa, probeLocal } from '../src/accounts/local.ts'

const config = { executable: 'C:/CPA/cli-proxy-api.exe', configFile: 'C:/CPA/config.yaml', passwordFile: 'C:/CPA/key.txt' }
it('coalesces clicks, waits for readiness, and never launches an already running CPA', async () => {
  let running = false
  const launch = vi.fn(async () => { await new Promise(r => setTimeout(r, 10)); running = true })
  const local = new LocalCpa('http://127.0.0.1:8317', config, { probe: async () => running ? 'running' : 'stopped', launch })
  const first = local.start(), second = local.start()
  expect(first).toBe(second)
  expect((await local.status()).state).toBe('starting')
  expect(await first).toMatchObject({ state: 'running' })
  await local.start()
  expect(launch).toHaveBeenCalledTimes(1)
})
it('does not launch without configuration or over a foreign/unrecognized service', async () => {
  const launch = vi.fn()
  await expect(new LocalCpa('http://127.0.0.1:8317', undefined, { probe: async () => 'stopped', launch }).start()).rejects.toThrow('localNotConfigured')
  await expect(new LocalCpa('http://127.0.0.1:8317', config, { probe: async () => 'unavailable', launch }).start()).rejects.toThrow('localUnavailable')
  expect(() => new LocalCpa('http://example.com', config)).toThrow('invalidEndpoint')
  expect(launch).not.toHaveBeenCalled()
})
it('does not equate spawned with ready and permits status checks after timeout', async () => {
  const local = new LocalCpa('http://127.0.0.1:8317', config, { probe: async () => 'stopped', launch: async () => {} }, 1)
  await expect(local.start()).rejects.toThrow('localStartTimeout')
  expect((await local.status()).state).toBe('stopped')
})

it('clears the pending operation when launching fails so a corrected configuration can retry', async () => {
  const launch = vi.fn(async () => { throw new Error('localLaunchFailed') })
  const local = new LocalCpa('http://127.0.0.1:8317', config, { probe: async () => 'stopped', launch })
  await expect(local.start()).rejects.toThrow('localLaunchFailed')
  await expect(local.start()).rejects.toThrow('localLaunchFailed')
  expect(launch).toHaveBeenCalledTimes(2)
  expect((await local.status()).state).toBe('stopped')
})
it('identifies CPA by its bounded HTTP response, not an open TCP port', async () => {
  let body = JSON.stringify({ message: 'CLI Proxy API Server' })
  const server = createServer((_req, res) => { res.end(body) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    expect(await probeLocal(url)).toBe('running')
    body = 'Other server'; expect(await probeLocal(url)).toBe('unavailable')
    body = 'x'.repeat(17000); expect(await probeLocal(url)).toBe('unavailable')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  expect(await probeLocal(url)).toBe('stopped')
})
