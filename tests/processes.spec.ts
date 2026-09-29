import { expect, it, vi } from 'vitest'
import { ProcessPool } from '../src/processes.ts'
import { Config } from '../src/config.ts'
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve} }
function handle() {
  const done=deferred<void>()
  const process:any={status:'running',done:done.promise,readOutput:()=>({delta:'ok'}),writeStdin:vi.fn(),closeStdin:vi.fn(),waitForExit:async()=>true}
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
