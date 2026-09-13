import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, posix } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const installation = process.env.WECHAT_DEVTOOLS_PATH || 'C:/Program Files (x86)/Tencent/微信web开发者工具'
const compilerRoot = join(installation, 'resources/app.asar.unpacked/node_modules/wcc-exec')
const temp = mkdtempSync(join(tmpdir(), 'lesson-ledger-wechat-'))
const cwd = resolve(root, 'apps/miniprogram')
function files(dir, suffix) {
  return readdirSync(resolve(cwd, dir), { withFileTypes: true }).flatMap(entry => {
    const path = (dir ? dir + '/' : '') + entry.name
    return entry.isDirectory() ? files(path, suffix) : path.endsWith(suffix) ? [path] : []
  })
}
const componentPaths = new Set()
for (const path of files('', '.json')) {
  const config = JSON.parse(readFileSync(resolve(cwd, path), 'utf8'))
  if (config.component) componentPaths.add('./' + path.replace(/\.json$/, ''))
  for (const reference of Object.values(config.usingComponents || {})) {
    if (typeof reference !== 'string' || reference.includes('://')) continue
    const component = reference.startsWith('/') ? reference.slice(1) : posix.normalize(posix.join(posix.dirname(path), reference))
    for (const suffix of ['.json', '.js', '.wxml']) {
      if (!existsSync(resolve(cwd, component + suffix))) throw new Error(`${path} 引用的组件文件缺失：${component}${suffix}`)
    }
  }
}
for (const [label, compiler, suffix, options] of [
  ['wcc', 'wcc', '.wxml', []],
  ['wcc-lazy', 'wcc', '.wxml', ['-llw', [...componentPaths].join(',')]],
  ['wcsc', 'wcsc', '.wxss', []],
]) {
  const executable = join(compilerRoot, compiler + (process.platform === 'win32' ? '.exe' : ''))
  if (!existsSync(executable)) throw new Error('未找到微信编译器；请设置 WECHAT_DEVTOOLS_PATH 为开发者工具安装目录')
  const output = join(temp, label + '.js')
  const result = spawnSync(executable, ['-o', output, ...options, ...files('', suffix).map(path => './' + path)], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0 || !existsSync(output) || !readFileSync(output, 'utf8').trim() || /(?:Bad attr|unexpected|error:)/i.test((result.stderr || '') + (result.stdout || ''))) {
    throw new Error(`${label} 编译失败：${result.error?.message || result.stderr || result.stdout}`)
  }
  console.log(`${label}：${files('', suffix).length} 个原生模板/样式文件通过微信编译器检查`)
}
