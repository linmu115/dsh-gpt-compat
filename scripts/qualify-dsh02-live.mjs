/** Opt-in RC2 qualifier. Credentials stay in inherited memory, never in argv or receipts. */
import { copyFile, mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const check = (ok, code) => { if (!ok) throw new Error('QUALIFIER_' + code) }
const hash = data => createHash('sha256').update(data).digest('hex')
const nested = (base, target) => { const rel = relative(base, target); return !rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)) }
export function validateOptions(runtime, dataRoot, env = process.env) {
  check(env.GPT_COMPAT_LIVE_TEST === '1', 'OPT_IN_REQUIRED')
  check(env.GPT_COMPAT_LIVE_MODEL === 'gpt-6-astra', 'MODEL_MUST_BE_ASTRA')
  check(typeof env.GPT_COMPAT_LIVE_KEY === 'string' && !!env.GPT_COMPAT_LIVE_KEY && typeof env.GPT_COMPAT_LIVE_ACCOUNT === 'string' && !!env.GPT_COMPAT_LIVE_ACCOUNT.trim(), 'FIXED_ACCOUNT_AND_KEY_REQUIRED')
  let endpoint
  try { endpoint = new URL(env.GPT_COMPAT_LIVE_URL) } catch { throw new Error('QUALIFIER_BAD_ENDPOINT') }
  check(['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 'BAD_ENDPOINT')
  if (env.GPT_COMPAT_QUALIFIER_TEST_ENDPOINT === '1') check(['127.0.0.1', '[::1]'].includes(endpoint.hostname), 'TEST_ENDPOINT_NOT_LOOPBACK')
  check(typeof runtime === 'string' && isAbsolute(runtime) && typeof dataRoot === 'string' && isAbsolute(dataRoot), 'ABSOLUTE_PATHS_REQUIRED')
  check(!nested(runtime, dataRoot) && !nested(dataRoot, runtime), 'RUNTIME_DATA_OVERLAP')
  check(!/in\.dsh-plug\.dsh-launcher[\\/](?:homes|versions)(?:[\\/]|$)/i.test(runtime + '\n' + dataRoot), 'LAUNCHER_PATH_FORBIDDEN')
  return { runtime: resolve(runtime), dataRoot: resolve(dataRoot), offlineSynthetic: env.GPT_COMPAT_QUALIFIER_TEST_ENDPOINT === '1' }
}
async function child(worker, dataRoot, phase, env) {
  return await new Promise(resolveChild => {
    const child = spawn(process.execPath, [worker, dataRoot, phase], { cwd: dataRoot, windowsHide: true,
      env: { ...env, DSH_HOME: join(dataRoot, 'home') }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    let stdoutBytes = 0, stderrBytes = 0, timedOut = false, spawnFailed = false
    child.stdout.on('data', data => { stdoutBytes += data.length })
    child.stderr.on('data', data => { stderrBytes += data.length })
    // Only this child is signalled. It handles cancellation through agent.cancel,
    // followed by native flush/dispose. There is no PID-based process termination.
    const timeout = setTimeout(() => { timedOut = true; if (child.connected) child.send({ type: 'qualifier-cancel' }) }, 300_000)
    child.on('error', () => { spawnFailed = true })
    child.on('close', code => { clearTimeout(timeout); resolveChild({ pid: child.pid, exitCode: code, stdoutBytes, stderrBytes, timedOut, spawnFailed }) })
  })
}
export async function qualify(runtime, dataRoot, env = process.env) {
  const options = validateOptions(runtime, dataRoot, env)
  const actualRuntime = await realpath(options.runtime)
  // A separately staged runtime may link read-only host dependencies to the
  // installed independent host. Only the fresh data root is writable here.
  check(!nested(actualRuntime, options.dataRoot) && !nested(options.dataRoot, actualRuntime), 'RUNTIME_DATA_OVERLAP')
  const runtimePackage = JSON.parse(await readFile(join(actualRuntime, 'package.json'), 'utf8'))
  check(runtimePackage.private === true && (runtimePackage.name === 'dsh-gpt-compat-host-candidate' ||
    (runtimePackage.name === 'dsh-gpt-compat-independent-host' && runtimePackage.version === '0.2.1-rc.2+gpt-dsh021.1' &&
      runtimePackage.dshManagedPatch?.id === 'gpt-dsh021.1' && runtimePackage.dshManagedPatch?.requiresIndependentRuntime === true && runtimePackage.dshManagedPatch?.upstreamVersion === '0.2.1-rc.2')), 'INDEPENDENT_RUNTIME_REQUIRED')
  const installed = JSON.parse(await readFile(join(actualRuntime, 'node_modules/dsh-gpt-compat/package.json'), 'utf8'))
  const session = JSON.parse(await readFile(join(actualRuntime, 'node_modules/@deepseek-ai/dsh-session/package.json'), 'utf8'))
  check(session.version === '0.2.1-rc.2+gpt-dsh021.1', 'WRONG_HOST_BASELINE')
  // mkdir without recursive prevents a replay from touching an existing data root.
  await mkdir(options.dataRoot)
  const report = { schemaVersion: 1, passed: false, mode: options.offlineSynthetic ? 'offline-synthetic' : 'live-fixed-account',
    model: 'gpt-6-astra', reasoningEffort: 'high', accountHash: hash(env.GPT_COMPAT_LIVE_ACCOUNT),
    installedPlugin: { name: installed.name, version: installed.version }, hostSessionVersion: session.version,
    sourceAliases: false, qualificationBudget: { contextWindow: 32000, maxTokens: 2048, triggerRatio: .1 }, processes: [] }
  try {
    check(!nested(actualRuntime, await realpath(options.dataRoot)), 'RUNTIME_DATA_OVERLAP')
    await symlink(join(actualRuntime, 'node_modules'), join(options.dataRoot, 'node_modules'), 'junction')
    const worker = join(options.dataRoot, 'artifact-worker-dsh02-live.fixture.mjs')
    await copyFile(new URL('./artifact-worker-dsh02-live.fixture.mjs', import.meta.url), worker)
    await copyFile(new URL('./qualify-dsh02-log.mjs', import.meta.url), join(options.dataRoot, 'qualify-dsh02-log.mjs'))
    report.workerSha256 = hash(await readFile(worker))
    report.nativeDecoderSha256 = hash(await readFile(join(options.dataRoot, 'qualify-dsh02-log.mjs')))
    await writeFile(join(options.dataRoot, 'fixture.json'), JSON.stringify({ marker: 'qualifier-marker-' + randomUUID(), sessionId: 'qualifier-' + randomUUID() }), { flag: 'wx' })
    let before
    for (const phase of ['create', 'resume']) {
      const processResult = await child(worker, options.dataRoot, phase, env)
      report.processes.push({ phase, ...processResult })
      let receipt
      try { receipt = JSON.parse(await readFile(join(options.dataRoot, phase + '-receipt.json'), 'utf8')) }
      catch { throw new Error('QUALIFIER_CHILD_RECEIPT_MISSING') }
      report[phase] = receipt
      check(processResult.exitCode === 0 && !processResult.timedOut && !processResult.spawnFailed && receipt.passed && receipt.normalTeardown, 'CHILD_FAILED')
      check(receipt.accountHeaderVerified && receipt.accountHash === report.accountHash && receipt.deniedTools === 0, 'ACCOUNT_OR_TOOL_POLICY')
      const probe = join(options.dataRoot, 'artifact-probe.txt')
      const after = { sha256: hash(await readFile(probe)), mtimeMs: (await stat(probe)).mtimeMs }
      if (phase === 'create') { check(receipt.authorizedPatchExecutions === 1 && receipt.compactRequests > 0, 'CREATE_PROOF_MISSING'); before = after }
      else check(receipt.authorizedPatchExecutions === 0 && receipt.coldStrictV4 && receipt.restoredCheckpointInRequest && receipt.markerRecalled && after.sha256 === before.sha256 && after.mtimeMs === before.mtimeMs, 'RESTORE_PROOF_MISSING')
    }
    check(report.processes[0].pid !== report.processes[1].pid, 'PROCESSES_NOT_DISTINCT')
    report.toolNotReexecuted = true; report.realJsonlPersistence = true; report.passed = true
  } catch (error) {
    report.errorCode = /^QUALIFIER_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'QUALIFIER_SETUP_OR_IO_FAILED'
  }
  await writeFile(join(options.dataRoot, 'qualification.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await qualify(...process.argv.slice(2))
    console.log(JSON.stringify({ passed: report.passed, mode: report.mode, errorCode: report.errorCode, processes: report.processes.length }))
    process.exitCode = report.passed ? 0 : 1
  } catch (error) {
    console.log(JSON.stringify({ passed: false, errorCode: /^QUALIFIER_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'QUALIFIER_SETUP_OR_IO_FAILED' }))
    process.exitCode = 1
  }
}
