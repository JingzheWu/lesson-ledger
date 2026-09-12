import { build, transform } from 'esbuild'
import { readFile, writeFile, readdir, access } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const localPath = resolve(root, 'project.local.json')
try {
  await access(localPath)
  const local = JSON.parse(await readFile(localPath, 'utf8'))
  if (!/^wx[a-f0-9]{16}$/.test(local.appid) || typeof local.cloudEnv !== 'string' || !/^[\w-]+$/.test(local.cloudEnv)) throw new Error('project.local.json 中的 AppID 或云环境 ID 无效')
  const project = JSON.parse(await readFile(resolve(root, 'project.config.json'), 'utf8'))
  project.appid = local.appid
  await writeFile(resolve(root, 'project.config.json'), JSON.stringify(project, null, 2) + '\n')
  await writeFile(resolve(root, 'apps/miniprogram/env.js'), `module.exports = ${JSON.stringify({ cloudEnv: local.cloudEnv })}\n`)
} catch (e) { if (e.code !== 'ENOENT') throw e }

await build({ entryPoints: [resolve(root, 'packages/application/index.ts')], outfile: resolve(root, 'apps/miniprogram/runtime.js'), bundle: true, format: 'cjs', platform: 'neutral', target: 'es2017', charset: 'utf8' })
await build({ entryPoints: [resolve(root, 'server/index.ts')], outfile: resolve(root, 'cloudfunctions/ledger/index.js'), bundle: true, format: 'cjs', platform: 'node', target: 'node18', external: ['wx-server-sdk'], charset: 'utf8' })

async function validate(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await validate(path)
    else if (entry.name.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'))
    else if (entry.name.endsWith('.js')) await transform(await readFile(path, 'utf8'), { target: 'es2017', sourcefile: relative(root, path) })
  }
}
await validate(resolve(root, 'apps/miniprogram'))
console.log('原生小程序共享运行包、云函数已构建；JS 与 JSON 静态校验通过。')
