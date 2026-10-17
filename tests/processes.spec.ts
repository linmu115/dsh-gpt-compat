import { expect, it, vi } from 'vitest'
import { ProcessPool } from '../src/processes.ts'
import { Config } from '../src/config.ts'
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve} }
function handle() {
  const done=deferred<void>()
  const process:any={status:'running',done:done.promise,readOutput:()=>({delta:'ok'}),writeStdin:vi.fn(),closeStdin:vi.fn(),waitForExit:async()=>true}
  process.finish=()=>{process.status='exited';process.exitCode=0;done.resolve()}
  process.terminate=vi.fn(()=>{process.status='killed';done.resolve()})
  return process
}
function shell(execute:any) {return {resolve:(input:any)=>input,execute} as any}
it('joins asynchronous preparation on scope close and never publishes a late handle', async()=>{
  const prepared=deferred<any>();const process=handle()
  const pool=new ProcessPool(shell(()=>prepared.promise),Config({}))
  const start=pool.start('command',undefined,new AbortController().signal,undefined,0)
  const failed=expect(start).rejects.toThrow('closed during preparation')
  let closed=false;const close=pool.close().then(()=>{closed=true})
  await Promise.resolve();expect(closed).toBe(false)
  prepared.resolve(process);await failed;await close
  expect(process.terminate).toHaveBeenCalled();expect(closed).toBe(true)
})
it('keeps a yielded command alive after its original call signal ends, then forwards stdin and cancels per-call', async()=>{
  const process=handle();const execute=vi.fn(async()=>process)
  const pool=new ProcessPool(shell(execute),Config({}))
  const initial=new AbortController()
  const output=await pool.start('command',undefined,initial.signal,undefined,0)
  const id=Number(/session ID (\d+)/.exec(output)![1])
  expect(execute.mock.calls[0]![0].onExpiry).toBe('none')
  initial.abort();expect(process.terminate).not.toHaveBeenCalled()
  await pool.collect(id,'hello',new AbortController().signal,0)
  expect(process.writeStdin).toHaveBeenCalledWith('hello')
  await pool.collect(id,'\u0003',new AbortController().signal,0)
  expect(process.terminate).toHaveBeenCalled()
  await pool.close()
})
it('counts asynchronous reservations once and isolates another agent pool',async()=>{
  const prepared=deferred<any>();const first=handle(),second=handle(),other=handle()
  const pool=new ProcessPool(shell(vi.fn().mockReturnValueOnce(prepared.promise).mockResolvedValueOnce(second)),Config({maxProcesses:2}))
  const running=pool.start('first',undefined,new AbortController().signal,undefined,30)
  prepared.resolve(first);await Promise.resolve();await Promise.resolve()
  const secondOutput=await pool.start('second',undefined,new AbortController().signal,undefined,0)
  const isolated=new ProcessPool(shell(async()=>other),Config({}))
  await isolated.start('other',undefined,new AbortController().signal,undefined,0)
  await expect(pool.start('third',undefined,new AbortController().signal,undefined,0)).rejects.toThrow('Collect or cancel')
  expect(secondOutput).toContain('running')
  await pool.close();await running;expect(other.terminate).not.toHaveBeenCalled()
  await isolated.close()
})

const freshSignal = () => new AbortController().signal
async function startHandle(pool: ProcessPool) {
  const result = await pool.start('command', undefined, freshSignal(), undefined, 0)
  return Number(/session ID (\d+)/.exec(result)![1])
}

it.each(['false', 'throw', 'missing'] as const)('retains ownership when close exit observation is %s and permits a verified retry', async failure => {
  const process = handle()
  process.waitForExit = failure === 'missing' ? undefined : vi.fn(async () => {
    if (failure === 'throw') throw new Error('observer failed')
    return false
  })
  const pool = new ProcessPool(shell(async () => process), Config({}))
  const id = await startHandle(pool)
  await expect(pool.close()).rejects.toThrow('ownership retained')
  // A failed close must not discard the unpublished final output or its handle.
  process.waitForExit = vi.fn(async () => true)
  const notices = await pool.close()
  expect(notices).toEqual([`Command session ${id} stopped on compatibility deactivation.\nok`])
  expect(process.waitForExit).toHaveBeenCalledOnce()
  expect(process.terminate).toHaveBeenCalledOnce()
  expect(await pool.close()).toEqual([])
})

it('does not report exited or release capacity when the parent finishes but its process range survives', async () => {
  const process = handle()
  process.readOutput = vi.fn(() => ({ delta: 'final output' }))
  process.waitForExit = vi.fn(async () => false)
  const pool = new ProcessPool(shell(async () => process), Config({ maxProcesses: 1 }))
  const id = await startHandle(pool)
  process.readOutput.mockClear()
  process.finish()
  await expect(pool.collect(id, '', freshSignal(), 0)).rejects.toThrow('exit is not verified')
  expect(process.readOutput).not.toHaveBeenCalled()
  await expect(pool.start('another', undefined, freshSignal(), undefined, 0)).rejects.toThrow('Collect or cancel')
  process.waitForExit = vi.fn(async () => true)
  expect(await pool.collect(id, '', freshSignal(), 0)).toBe('Process exited with code 0\nOutput:\nfinal output')
  expect(await pool.close()).toEqual([])
})

it.each(['false', 'throw', 'missing'] as const)('owns a late prepared process even when its exit observer is %s', async failure => {
  const prepared = deferred<any>()
  const process = handle()
  process.waitForExit = failure === 'missing' ? undefined : async () => {
    if (failure === 'throw') throw new Error('observer failed')
    return false
  }
  const pool = new ProcessPool(shell(() => prepared.promise), Config({}))
  const start = pool.start('command', undefined, freshSignal(), undefined, 0)
  const failedStart = expect(start).rejects.toThrow()
  const close = pool.close()
  const failedClose = expect(close).rejects.toThrow('ownership retained')
  prepared.resolve(process)
  await failedStart
  await failedClose
  process.waitForExit = async () => true
  expect(await pool.close()).toHaveLength(1)
  expect(process.terminate).toHaveBeenCalledOnce()
})

it('joins concurrent close calls and emits final output once', async () => {
  const process = handle()
  const observed = deferred<boolean>()
  process.waitForExit = vi.fn(() => observed.promise)
  const pool = new ProcessPool(shell(async () => process), Config({}))
  await startHandle(pool)
  const first = pool.close()
  const second = pool.close()
  expect(first).toBe(second)
  await Promise.resolve()
  expect(process.waitForExit).toHaveBeenCalledOnce()
  observed.resolve(true)
  expect(await first).toHaveLength(1)
  await second
  expect(process.terminate).toHaveBeenCalledOnce()
  expect(await pool.close()).toEqual([])
})

it.each(['before', 'during'] as const)('retains a cancelled collection owner when observation fails (%s wait)', async when => {
  const process = handle()
  process.waitForExit = vi.fn(async () => false)
  const pool = new ProcessPool(shell(async () => process), Config({}))
  const id = await startHandle(pool)
  const controller = new AbortController()
  if (when === 'before') controller.abort(new Error('cancelled'))
  const collecting = pool.collect(id, '', controller.signal, 1000)
  const rejected = expect(collecting).rejects.toThrow('exit is not verified')
  controller.abort(new Error('cancelled'))
  await rejected
  await expect(pool.close()).rejects.toThrow('ownership retained')
  process.waitForExit = async () => true
  expect(await pool.close()).toHaveLength(1)
})

it('retains ownership when an initial call is cancelled during preparation', async () => {
  const prepared = deferred<any>()
  const process = handle()
  process.waitForExit = async () => false
  const pool = new ProcessPool(shell(() => prepared.promise), Config({ maxProcesses: 1 }))
  const controller = new AbortController()
  const starting = pool.start('command', undefined, controller.signal, undefined, 0)
  const rejected = expect(starting).rejects.toThrow('exit is not verified')
  controller.abort(new Error('cancelled'))
  prepared.resolve(process)
  await rejected
  await expect(pool.start('another', undefined, freshSignal(), undefined, 0)).rejects.toThrow('Collect or cancel')
  process.waitForExit = async () => true
  expect(await pool.close()).toHaveLength(1)
})

it('retains ownership when cancellation interrupts the initial collection', async () => {
  const process = handle()
  process.waitForExit = async () => false
  const pool = new ProcessPool(shell(async () => process), Config({ maxProcesses: 1 }))
  const controller = new AbortController()
  const starting = pool.start('command', undefined, controller.signal, undefined, 1000)
  const rejected = expect(starting).rejects.toThrow('process exit could not be verified')
  await Promise.resolve()
  controller.abort(new Error('cancelled'))
  await rejected
  await expect(pool.start('another', undefined, freshSignal(), undefined, 0)).rejects.toThrow('Collect or cancel')
  process.waitForExit = async () => true
  expect(await pool.close()).toHaveLength(1)
})

it('waits for every owner even when one exit observer fails', async () => {
  const first = handle(), second = handle()
  const observed = deferred<boolean>()
  first.waitForExit = async () => { throw new Error('first observer failed') }
  second.waitForExit = () => observed.promise
  const pool = new ProcessPool(shell(vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)), Config({}))
  await startHandle(pool)
  await startHandle(pool)
  let settled = false
  const closing = pool.close().finally(() => { settled = true })
  const rejected = expect(closing).rejects.toThrow('ownership retained')
  await Promise.resolve(); await Promise.resolve()
  expect(settled).toBe(false)
  expect(second.terminate).toHaveBeenCalledOnce()
  observed.resolve(true)
  await rejected
  first.waitForExit = async () => true
  expect(await pool.close()).toHaveLength(2)
})

it.each([0, 20])('returns an initial handle within yield %i when the parent exited but the exit observer is pending', async yieldMs => {
  const process = handle()
  const observed = deferred<boolean>()
  process.finish()
  process.waitForExit = vi.fn(() => observed.promise)
  const pool = new ProcessPool(shell(async () => process), Config({ maxProcesses: 1 }))
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      pool.start('command', undefined, freshSignal(), undefined, yieldMs),
      new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error('ordinary collection exceeded yield budget')), 1000) }),
    ])
    const id = Number(/session ID (\d+)/.exec(result)![1])
    expect(result).toContain('Process closing')
    expect(result).not.toContain('Process exited')
    expect(id).toBeGreaterThan(0)
    expect(process.terminate).not.toHaveBeenCalled()
    await expect(pool.start('another', undefined, freshSignal(), undefined, 0)).rejects.toThrow('Collect or cancel')
    let closed = false
    const closing = pool.close().then(notices => { closed = true; return notices })
    await Promise.resolve(); await Promise.resolve()
    expect(closed).toBe(false)
    observed.resolve(true)
    expect(await closing).toHaveLength(1)
    expect(process.waitForExit).toHaveBeenCalledOnce()
  } finally {
    if (watchdog) clearTimeout(watchdog)
    observed.resolve(true)
    await pool.close()
  }
})

it('returns the same write_stdin handle while range observation is pending, then reports a verified exit', async () => {
  const process = handle()
  const observed = deferred<boolean>()
  process.waitForExit = vi.fn(() => observed.promise)
  const pool = new ProcessPool(shell(async () => process), Config({}))
  const id = await startHandle(pool)
  process.finish()
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      pool.collect(id, '', freshSignal(), 0),
      new Promise<never>((_, reject) => { watchdog = setTimeout(() => reject(new Error('write_stdin exceeded yield budget')), 1000) }),
    ])
    expect(result).toContain(`Process closing with session ID ${id}`)
    expect(result).not.toContain('Process exited')
    expect(process.terminate).not.toHaveBeenCalled()
    observed.resolve(true)
    expect(await pool.collect(id, '', freshSignal(), 0)).toContain('Process exited with code 0')
    expect(process.waitForExit).toHaveBeenCalledOnce()
    expect(await pool.close()).toEqual([])
  } finally {
    if (watchdog) clearTimeout(watchdog)
    observed.resolve(true)
    await pool.close()
  }
})
