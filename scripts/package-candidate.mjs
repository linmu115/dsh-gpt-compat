import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { project } from './dev-host.mjs'
const output=path.resolve(process.env.DSH_HOST_OUTPUT || path.join(project,'artifacts/host-dsh021'))
const assembly=JSON.parse(fs.readFileSync(path.join(output,'assembly.json')))
const release=path.resolve(process.env.DSH_RELEASE_OUTPUT || path.join(project,'artifacts/release-dsh021'))
fs.mkdirSync(release,{recursive:true})
const npm=process.env.NPM_CLI_JS || path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')
if(!fs.existsSync(npm))throw new Error('Set NPM_CLI_JS to npm/bin/npm-cli.js for reproducible shell-free packing')
const packages=[]
function pack(root,destination=release){
 const result=JSON.parse(execFileSync(process.execPath,[npm,'pack','--ignore-scripts','--json','--pack-destination',destination],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0]
 const file=path.join(destination,result.filename),manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json')))
 packages.push({name:manifest.name,version:manifest.version,file,bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),files:result.files.map(item=>item.path)})
 return {file,manifest}
}
for(const root of [project,path.join(project,'packages/accounts')]){
 const {file,manifest}=pack(root),destination=path.join(assembly.runtime,'node_modules',manifest.name)
 fs.mkdirSync(destination,{recursive:true});execFileSync('tar',['-xf',file,'-C',destination,'--strip-components=1'])
 const value=await import(pathToFileURL(path.join(destination,manifest.main)).href)
 if(typeof value.apply!=='function')throw new Error('Missing packaged plugin apply: '+manifest.name)
 if(manifest.name==='dsh-gpt-compat')await import(pathToFileURL(path.join(destination,'lib/responses.mjs')).href)
}
const overlay=path.join(release,'host-overlay');fs.mkdirSync(overlay,{recursive:true})
for(const item of assembly.built)pack(path.join(assembly.runtime,'node_modules',item.name),overlay)
fs.copyFileSync(path.join(output,'audit.json'),path.join(overlay,'audit.json'))
fs.copyFileSync(path.join(project,'host-patches/dsh-0.2.1-rc.3-gpt-dsh021rc3.1.manifest.json'),path.join(overlay,'source-manifest.json'))
fs.writeFileSync(path.join(overlay,'package.json'),JSON.stringify({name:'dsh-gpt-host-overlay',version:'0.2.1-rc.3-gpt-dsh021rc3.1',private:true,description:'Independent host extension; not installable as a plugin on stock DSH',files:['*.tgz','audit.json','source-manifest.json','README.md']},null,2))
fs.writeFileSync(path.join(overlay,'README.md'),'# Independent GPT host overlay\n\nThese 13 patched package archives belong in an independent DSH 0.2.1-rc.3 runtime. They are not a plugin bundle. Do not overwrite an active Launcher installation. The local build script copies the entire official @deepseek-ai package cohort before applying this overlay, so dependent packages resolve one consistent patched Session/LLM graph. See source-manifest.json and audit.json.\n')
pack(overlay)
fs.writeFileSync(path.join(release,'packages.json'),JSON.stringify({baseline:'0.2.1-rc.3',requiresIndependentHost:true,runtime:assembly.runtime,packages},null,2)+'\n')
console.log(JSON.stringify({release,archives:packages.length,pluginImports:'passed',requiresIndependentHost:true}))
