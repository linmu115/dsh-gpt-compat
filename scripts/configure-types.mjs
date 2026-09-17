import ts from 'typescript'
import { resolve, relative } from 'node:path'
import { writeFileSync } from 'node:fs'
import { host, dependencyDirectory } from './dev-host.mjs'
const { config } = ts.readConfigFile(resolve(host, 'tsconfig.base.json'), ts.sys.readFile)
const paths = Object.fromEntries(Object.entries(config.compilerOptions.paths).map(([name, values]) => [name, values.map(path => {
  const file = path.replace(/\/src$/, '/src/index.ts').replace('/src/', '/lib/types/').replace(/\.tsx?$/, '.d.ts')
  return './' + relative(process.cwd(), resolve(host, file)).replaceAll('\\', '/')
})]))
paths.react = [resolve(dependencyDirectory('@types/react'), 'index.d.ts')]
paths['react/*'] = [resolve(dependencyDirectory('@types/react'), '*')]
writeFileSync('tsconfig.host.generated.json', JSON.stringify({
  compilerOptions: {
    target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
    noUncheckedIndexedAccess: true, skipLibCheck: true, allowImportingTsExtensions: true,
    noEmit: true, types: ['node'], jsx: 'react-jsx', paths,
  }, include: ['src/**/*.ts', 'src/**/*.tsx'],
}, null, 2) + '\n')

writeFileSync('tsconfig.test.generated.json', JSON.stringify({ extends: resolve(host, 'tsconfig.base.json'), compilerOptions: { composite: false, noEmit: true }, include: ['src/**/*.ts', 'tests/**/*.ts'] }, null, 2) + '\n')
