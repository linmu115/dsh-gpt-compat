import { resolve, join } from 'node:path'
import { writeFileSync, readFileSync } from 'node:fs'
import { host, hostPackages, project, assertHostSource, actualHostPackages, dependencyDirectory } from './dev-host.mjs'
assertHostSource()
const actual = actualHostPackages(), paths = {}
for (const [name, { directory, pkg }] of actual) {
  if (pkg.types) paths[name] = [join(directory, pkg.types)]
  for (const [key, value] of Object.entries(pkg.exports ?? {})) if (key !== '.' && value?.types) paths[name + key.slice(1)] = [join(directory, value.types)]
}
for (const relative of hostPackages) {
  const root = join(host, relative), pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const key of Object.keys(paths)) if (key === pkg.name || key.startsWith(pkg.name + '/')) delete paths[key]
  paths[pkg.name] = [join(root, 'src/index.ts')]
  paths[pkg.name + '/*'] = [join(root, 'src/*.ts')]
}
paths.react = [resolve(dependencyDirectory('@types/react'), 'index.d.ts')]
paths['react/*'] = [resolve(dependencyDirectory('@types/react'), '*')]
writeFileSync(join(project, 'tsconfig.host.generated.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
    noUncheckedIndexedAccess: true, skipLibCheck: true, allowImportingTsExtensions: true,
    noEmit: true, types: ['node'], jsx: 'react-jsx', paths,
  }, include: ['src/**/*.ts', 'src/**/*.tsx'],
}, null, 2) + '\n')

writeFileSync(join(project, 'tsconfig.test.generated.json'), JSON.stringify({ extends: './tsconfig.host.generated.json', include: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'] }, null, 2) + '\n')
console.log(`Configured ${hostPackages.length} explicit host extension aliases over ${actual.size} actual distribution packages`)
