import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

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
for (const [compiler, suffix] of [['wcc', '.wxml'], ['wcsc', '.wxss']]) {
  const executable = join(compilerRoot, compiler + (process.platform === 'win32' ? '.exe' : ''))
  if (!existsSync(executable)) throw new Error('未找到微信编译器；请设置 WECHAT_DEVTOOLS_PATH 为开发者工具安装目录')
  const output = join(temp, compiler + '.js')
  const result = spawnSync(executable, ['-o', output, ...files('', suffix)], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0 || !existsSync(output) || !readFileSync(output, 'utf8').trim() || /(?:Bad attr|unexpected|error:)/i.test((result.stderr || '') + (result.stdout || ''))) {
    throw new Error(`${compiler} 编译失败：${result.error?.message || result.stderr || result.stdout}`)
  }
  console.log(`${compiler}：${files('', suffix).length} 个原生模板/样式文件通过微信编译器检查`)
}
