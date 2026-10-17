import fs from 'node:fs'
import path from 'node:path'
import { actualHostPackages, host, project } from './dev-host.mjs'
for (const [name, { directory }] of actualHostPackages()) {
  for (const owner of [host, project]) {
    const to = path.join(owner, 'node_modules', name)
    fs.mkdirSync(path.dirname(to), {recursive:true})
    if (fs.existsSync(to)) {
      if (fs.realpathSync(to) === directory) continue
      if (!fs.lstatSync(to).isSymbolicLink()) throw new Error('Unexpected real directory '+to)
      fs.unlinkSync(to)
    }
    fs.symlinkSync(directory,to,'junction')
  }
}
console.log('Linked exact candidate workspace packages to plugin and candidate root')
