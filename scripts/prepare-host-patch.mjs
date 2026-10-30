/** Produce a reviewable patch against the pristine official 0.2 source. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { host, project, hostPackages, assertHostSource } from './dev-host.mjs'
if (!process.env.DSH_HOST_BASELINE?.trim()) throw new Error('Set DSH_HOST_BASELINE to the pristine official DSH 0.2.1-rc.3 source directory (commit 1f81c047fc48fa190a683e469daa699857e9afe8), separate from host-gpt-candidate')
const baseline = path.resolve(process.env.DSH_HOST_BASELINE)
assertHostSource()
if(baseline===host)throw new Error('Baseline must be a separate pristine source directory')
const names=new Set()
for(const root of [baseline,host])for(const pkg of hostPackages)for(const face of ['src','tests']){
 const directory=path.join(root,pkg,face);if(!fs.existsSync(directory))continue
 for(const file of fs.readdirSync(directory,{recursive:true}))if(/\.(?:ts|tsx)$/.test(file))names.add(path.posix.join(pkg,face,file.replaceAll('\\','/')))
}
for(const file of ['docs/persistence-catalog.md','docs/persistence-schema.json','docs/architecture.md','docs/architecture.zh.md','docs/architecture.i18n.yaml'])names.add(file)
for(const pkg of hostPackages) for(const file of ['README.md','README.zh.md','README.i18n.yaml']) names.add(pkg + '/' + file)
const extra=execFileSync('git',['-C',host,'status','--porcelain','--untracked-files=all'],{encoding:'utf8'});for(const line of extra.split('\n')){const file=line.slice(3).trim();if(file.startsWith('docs/') || file === 'scripts/type-equiv.manifest.json' || file === 'packages/extensions/tool-cordis/src/api-catalog.ts')names.add(file)}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-dsh02-patch-')),empty=path.join(temp,'empty');fs.writeFileSync(empty,'')
const changes=[],patches=[]
try{
 for(const relative of [...names].sort()){
  const before=path.join(baseline,relative),after=path.join(host,relative),hasBefore=fs.existsSync(before),hasAfter=fs.existsSync(after)
  const old=hasBefore?fs.readFileSync(before):Buffer.alloc(0),next=hasAfter?fs.readFileSync(after):Buffer.alloc(0)
  if(old.equals(next))continue
  const diff=spawnSync('git',['diff','--no-index','--no-color','--',hasBefore?before:empty,hasAfter?after:empty],{encoding:'utf8',maxBuffer:16*1024*1024})
  if(diff.status!==1)throw new Error('git diff failed: '+diff.stderr)
  const lines=diff.stdout.split('\n'),start=lines.findIndex(line=>line.startsWith('@@'))
  if(start<0)throw new Error('Expected text diff: '+relative)
  patches.push(`diff --git a/${relative} b/${relative}\n${hasBefore?'':'new file mode 100644\n'}--- ${hasBefore?'a/'+relative:'/dev/null'}\n+++ ${hasAfter?'b/'+relative:'/dev/null'}\n${lines.slice(start).join('\n')}`)
  const sha=body=>crypto.createHash('sha256').update(body).digest('hex')
  changes.push({path:relative,beforeSha256:hasBefore?sha(old):null,afterSha256:hasAfter?sha(next):null})
 }
 const file=path.join(project,'host-patches/dsh-0.2.1-rc.3-gpt-dsh021rc3.1.patch');fs.writeFileSync(file,patches.join(''))
 execFileSync('git',['-C',baseline,'apply','--check',file],{stdio:'pipe'})
 fs.writeFileSync(path.join(project,'host-patches/dsh-0.2.1-rc.3-gpt-dsh021rc3.1.manifest.json'),JSON.stringify({baselineVersion:'0.2.1-rc.3',baselineCommit:'1f81c047fc48fa190a683e469daa699857e9afe8',patchId:'gpt-dsh021rc3.1',stockHostCompatible:false,patchSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),applyCheck:true,changes},null,2)+'\n')
 console.log(`Patch apply check passed against the pristine baseline: ${changes.length} files`)
}finally{
 const expected=path.resolve(os.tmpdir())+path.sep+'gpt-dsh02-patch-'
 if(!path.resolve(temp).startsWith(expected))throw new Error('Refuse cleaning unexpected patch staging directory')
 fs.rmSync(temp,{recursive:true,force:true})
}
