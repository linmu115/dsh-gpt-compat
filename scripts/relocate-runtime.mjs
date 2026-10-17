/** Copy a prepared runtime and rebuild its Windows junctions within the destination. */
import fs from 'node:fs'
import path from 'node:path'
const [sourceArg,destinationArg]=process.argv.slice(2)
if(!sourceArg||!destinationArg)throw new Error('Usage: node relocate-runtime.mjs <prepared-runtime> <new-empty-destination>')
const source=fs.realpathSync(sourceArg),destination=path.resolve(destinationArg)
if(fs.existsSync(destination))throw new Error('Destination must not exist')
const links=JSON.parse(fs.readFileSync(path.join(source,'runtime-links.json'),'utf8'))
const contained=(root,relative)=>{const value=path.resolve(root,relative);if(!value.startsWith(root+path.sep))throw new Error('Path escapes runtime');return value}
for(const link of links){contained(destination,link.path);contained(destination,link.target)}
fs.cpSync(source,destination,{recursive:true,dereference:false,filter:item=>!fs.lstatSync(item).isSymbolicLink()})
for(const link of links){const target=contained(destination,link.target),at=contained(destination,link.path);fs.mkdirSync(path.dirname(at),{recursive:true});fs.symlinkSync(target,at,'junction')}
for(const link of links){const target=fs.realpathSync(contained(destination,link.path));if(!target.startsWith(destination+path.sep))throw new Error('External junction after relocation')}
console.log(JSON.stringify({destination,internalLinks:links.length,externalLinks:0,launcherCli:path.join(destination,'node_modules/@deepseek-ai/dsh/lib/bin.js')}))
