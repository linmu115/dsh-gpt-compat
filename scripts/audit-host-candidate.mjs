import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { project, actualHostPackages } from './dev-host.mjs'
const output=path.resolve(process.env.DSH_HOST_OUTPUT || path.join(project,'artifacts/host-dsh02'))
const assembly=JSON.parse(fs.readFileSync(path.join(output,'assembly.json'))), modules=path.join(assembly.runtime,'node_modules')
const load=async name=>{const root=path.join(modules,name),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));return import(pathToFileURL(path.join(root,pkg.main)).href)}
const loaded=[]
for(const item of assembly.built){await load(item.name);loaded.push(item.name)}
const {Session,SessionId}=await load('@deepseek-ai/dsh-session')
const {createUserMessage}=await load('@deepseek-ai/dsh-llm')
const {sessionFormatCatalog}=await load('@deepseek-ai/dsh-session-format-catalog')
assert.equal(sessionFormatCatalog.currentVersion,4)
const session=Session.create(SessionId('gpt-candidate-codec-check'))
const user=createUserMessage({content:[{type:'text',text:'synthetic fixture'}],source:{kind:'user'}})
session.append('user/message',user,{surfaceOp:'append'})
const operation=session.append('context/operation',{kind:'native-compact',request:{synthetic:true}})
session.append('context/operation-result',{operation:operation.seq,output:[]})
const checkpoint=session.append('context/checkpoint',{key:'gpt-compat:native:audit',state:{version:1,synthetic:true}})
session.append('context/checkpoint-commit',{checkpoint:checkpoint.seq})
session.append('request/projection',{messages:[user],adapterContext:{format:'audit',scope:'audit',input:[]}})
const header=sessionFormatCatalog.encodeCurrentHeader({...session.header,delegationDepth:0},0)
const rows=session.snapshotEvents().map(event=>sessionFormatCatalog.encodeCurrentEvent(event))
const restore=sessionFormatCatalog.createRestore(header,{recovery:'strict',validation:'current'})
for(const row of rows)restore.decodeRow(row)
const restored=restore.finish();assert.equal(restored.events.length,6)
assert.deepEqual(restored.events.map(event=>event.type),session.snapshotEvents().map(event=>event.type))
const actual=actualHostPackages().get('@deepseek-ai/dsh-session-format-catalog')
const stock=(await import(pathToFileURL(path.join(actual.directory,actual.pkg.main)).href)).sessionFormatCatalog
assert.throws(()=>{const reader=stock.createRestore(header,{recovery:'strict',validation:'current'});for(const row of rows)reader.decodeRow(row);reader.finish()},/unknown event type/)
const agentBundle=fs.readFileSync(path.join(modules,'@deepseek-ai/dsh-agent/lib/index.js'),'utf8')
assert.ok(!/\bimport[^;]*\bFiberState\b/.test(agentBundle),'Cordis const enum must be inlined by typed emit')
const result={baseline:'0.2.0-rc.2',patchedPackageVersion:'0.2.0-rc.2+gpt-dsh02.1',runtime:assembly.runtime,
 hostImports:loaded,v4:{currentVersion:4,extensionEventTypes:rows.slice(1).map(row=>row.type),encode:true,strictRestore:true,stockRejects:true},constEnumImportAbsent:true}
fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
