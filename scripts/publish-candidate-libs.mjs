import fs from 'node:fs'
import path from 'node:path'
import {host,project} from './dev-host.mjs'
const output=path.join(project,'artifacts/host-dsh021');const a=JSON.parse(fs.readFileSync(path.join(output,'assembly.json')))
for(const p of a.built)fs.cpSync(path.join(a.runtime,'node_modules',p.name,'lib'),path.join(host,p.relative,'lib'),{recursive:true})
console.log('Copied 13 typed patched libraries into independent host source')
