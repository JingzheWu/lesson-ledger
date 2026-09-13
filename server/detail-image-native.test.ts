import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import * as runtime from '../packages/application/index'

function fixture(debug = { detailImage: true }) {
  const logs: string[] = []
  const context = { font: '', fillStyle: '', textBaseline: '', scale: vi.fn(), translate: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, _width: number, _height: number) => ({ data: new Uint8ClampedArray([19, 87, 155, 255]) })),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 24 }) }
  const canvas = { width: 1, height: 1, getContext: () => context, requestAnimationFrame: (fn: () => void) => fn() }
  type Call = { success: (value: any) => void; fail: (error: any) => void; [key: string]: any }
  const fs = { writeFile: vi.fn() }
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
    env: { USER_DATA_PATH: 'wxfile://user' }, getFileSystemManager: () => fs,
    canvasToTempFilePath: vi.fn((o: Call) => o.success({ tempFilePath: 'wxfile://report.png' })),
    getImageInfo: vi.fn((o: Call) => {
      o.success({ width: canvas.width, height: canvas.height })
    }),
    getSetting: vi.fn((o: Call) => o.success({ authSetting: {} })),
    saveImageToPhotosAlbum: vi.fn((o: Call) => o.success({})),
    showShareImageMenu: vi.fn((o: Call) => o.success({})),
    previewImage: vi.fn((o: Call) => o.success({})),
  }
  const module = { exports: {} as Record<string, (...args: any[]) => Promise<any>> }
  runInNewContext(readFileSync(resolve('apps/miniprogram/detail-image.js'), 'utf8'), { module, require: (name: string) => name === './debug' ? debug : runtime, wx, setTimeout, clearTimeout, Date,
    console: { info: (line: string) => logs.push(line) } })
  const node = { left: 20, top: 60, width: 300, height: 30, fontSize: '14px', lineHeight: '22px', dataset: { exportText: '课时费仅供核对' } }
  function query(result: unknown[]) {
    const q = { select: (_selector: string) => q, selectAll: (_selector: string) => q, fields: (_fields: object) => q, exec: (fn: (value: unknown) => void) => fn(result) }
    return q
  }
  const page = { setData: vi.fn((_data: object, callback?: () => void) => callback?.()),
    createSelectorQuery: () => query([{ left: 16, top: 20, width: 361, height: 4229 }, [node], { node: canvas }]),
    selectComponent: () => ({ createSelectorQuery: () => query([[{ ...node, top: 200, dataset: { exportText: '完整计费表' } }]]) }) }
  const view = runtime.resultView(runtime.calculate({ month: '2026-09', entries: [] }, runtime.defaultConfig(), '2026-09-12T08:00:00Z'))
  return { helper: module.exports, wx, fs, page, context, canvas, view, logs }
}
it('真实导出适配器绘制完整长图并释放画布；平台大图失败时降低尺寸重试', async () => {
  const f = fixture()
  f.wx.canvasToTempFilePath.mockImplementationOnce(o => o.fail({ errMsg: 'canvas too large' }))
  expect(await f.helper.exportDetailImage(f.page)).toBe('wxfile://report.png')
  expect(f.wx.canvasToTempFilePath).toHaveBeenCalledTimes(2)
  expect(f.wx.canvasToTempFilePath.mock.calls[0][0].destHeight).toBe(8192)
  expect(f.wx.canvasToTempFilePath.mock.calls[1][0].destHeight).toBe(6144)
  expect(f.context.fillText.mock.calls.some(([text]) => String(text).includes('课时费仅供核对'))).toBe(true)
  expect(f.context.fillText.mock.calls.some(([text]) => String(text).includes('完整计费表'))).toBe(true)
  expect(f.canvas).toMatchObject({ width: 1, height: 1 })
})
it('导出返回成功但图片被平台截短时缩小重绘，仍不完整则拒绝返回残图', async () => {
  const f = fixture()
  f.wx.getImageInfo.mockImplementationOnce(o => o.success({ width: f.canvas.width, height: 3000 }))
  await expect(f.helper.exportDetailImage(f.page)).resolves.toBe('wxfile://report.png')
  expect(f.wx.canvasToTempFilePath).toHaveBeenCalledTimes(2)
  expect(f.page.setData.mock.calls.some(([data]) => (data as { exportCanvasHeight: number }).exportCanvasHeight === 6144)).toBe(true)
  f.wx.getImageInfo.mockImplementation(o => o.success({ width: 10, height: 10 }))
  await expect(f.helper.exportDetailImage(f.page)).rejects.toThrow('尺寸不完整')
  expect(f.canvas).toMatchObject({ width: 1, height: 1 })
})
it('日志中的393×4281明细直接原生导出高清，只读取一个边界像素，不在JS中压缩PNG', async () => {
  const f = fixture()
  expect(await f.helper.exportDetailImage(f.page)).toBe('wxfile://report.png')
  expect(f.wx.canvasToTempFilePath).toHaveBeenCalledOnce()
  const { destWidth, destHeight } = f.wx.canvasToTempFilePath.mock.calls[0][0]
  expect(destWidth).toBeGreaterThanOrEqual(750)
  expect(destHeight).toBe(8192)
  expect(f.context.getImageData.mock.calls).toEqual([[destWidth - 1, destHeight - 1, 1, 1]])
  expect(f.fs.writeFile).not.toHaveBeenCalled()
  expect(f.logs.join('\n')).not.toContain('png.compress')
  expect(f.canvas).toMatchObject({ width: 1, height: 1 })
})
it('离屏画布永不触发动画帧也能完成高清导出', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    f.canvas.requestAnimationFrame = vi.fn()
    const result = f.helper.exportDetailImage(f.page)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('wxfile://report.png')
    expect(f.canvas.requestAnimationFrame).not.toHaveBeenCalled()
    expect(f.page.setData.mock.calls.filter(([data]) => (data as { exportCanvasHeight: number }).exportCanvasHeight === 8192)).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
it('设备画布超过4096px时底部实际绘制失败，回退前不输出残图且告知实际尺寸', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    f.context.getImageData.mockImplementation(() => ({ data: new Uint8ClampedArray(f.canvas.height > 4096 ? [0, 0, 0, 0] : [19, 87, 155, 255]) }))
    const result = f.helper.exportDetailImage(f.page)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('wxfile://report.png')
    expect(f.context.getImageData).toHaveBeenCalledTimes(3)
    expect(f.wx.canvasToTempFilePath).toHaveBeenCalledOnce()
    expect(f.wx.canvasToTempFilePath.mock.calls[0][0].destHeight).toBe(4096)
    const events = f.logs.map(line => JSON.parse(line.slice('[ledger:image] '.length)))
    expect(events).toContainEqual(expect.objectContaining({ stage: 'attempt', mode: 'native4096', budgetMs: 10000 }))
    expect(f.page.setData.mock.calls).toContainEqual([expect.objectContaining({ imageNotice: expect.stringContaining('376×4096') })])
    expect(events.at(-1)).toMatchObject({ stage: 'export', status: 'done' })
    expect(f.canvas).toMatchObject({ width: 1, height: 1 })
  } finally { vi.useRealTimers() }
})
it('原生导出不回调时超时降级，迟到回调不覆盖结果，全部超时则结束', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    let late!: () => void
    f.wx.canvasToTempFilePath.mockImplementationOnce(o => { late = () => o.success({ tempFilePath: 'wxfile://late.png' }) })
    const result = f.helper.exportDetailImage(f.page)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('wxfile://report.png')
    late()
    expect(f.wx.canvasToTempFilePath).toHaveBeenCalledTimes(2)
    f.wx.canvasToTempFilePath.mockImplementation(() => {})
    const failed = expect(f.helper.exportDetailImage(f.page)).rejects.toThrow('超时')
    await vi.runAllTimersAsync(); await failed
    expect(f.canvas).toMatchObject({ width: 1, height: 1 })
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
it('布局或setData未回调有等待上限，结束后释放画布', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    f.page.setData.mockImplementation(() => {})
    const failed = expect(f.helper.exportDetailImage(f.page)).rejects.toThrow('超时')
    await vi.runAllTimersAsync(); await failed
    expect(f.canvas).toMatchObject({ width: 1, height: 1 })
    f.page.createSelectorQuery = () => {
      const query = { select: () => query, selectAll: () => query, fields: () => query, exec: () => {} }
      return query
    }
    const missing = expect(f.helper.exportDetailImage(f.page)).rejects.toThrow('读取超时')
    await vi.runAllTimersAsync(); await missing
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
it('导出日志定位具体超时接口及回退耗时，不输出明细、路径或原始异常', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    f.context.getImageData.mockImplementationOnce(() => { throw new Error('private-account wxfile://private-path 3300.00') })
    f.wx.canvasToTempFilePath.mockImplementationOnce(() => {})
    const result = f.helper.exportDetailImage(f.page)
    await vi.runAllTimersAsync(); await result
    const events = f.logs.map(line => JSON.parse(line.slice('[ledger:image] '.length)))
    expect(events).toContainEqual(expect.objectContaining({ stage: 'canvasToTempFilePath', status: 'failed', reason: 'timeout', durationMs: 6000 }))
    expect(events).toContainEqual(expect.objectContaining({ stage: 'fallback', from: 'native6144' }))
    expect(events.at(-1)).toMatchObject({ revision: 'image-native-v3', stage: 'export', status: 'done' })
    expect(f.logs.join('\n')).not.toMatch(/private-account|wxfile:|3300\.00|课时费仅供核对|完整计费表/)
  } finally { vi.useRealTimers() }
})
it('正式版不输出长图诊断日志，超时提示仍标明失败环节', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    Reflect.set(f.wx, 'getAccountInfoSync', () => ({ miniProgram: { envVersion: 'release' } }))
    f.page.setData.mockImplementation(() => {})
    const failed = expect(f.helper.exportDetailImage(f.page)).rejects.toThrow('canvas.setData')
    await vi.runAllTimersAsync(); await failed
    expect(f.logs).toEqual([])
  } finally { vi.useRealTimers() }
})
it('默认诊断开关关闭，开发版仍正常导出且不输出日志', async () => {
  const config = { exports: {} as { detailImage: boolean } }
  runInNewContext(readFileSync(resolve('apps/miniprogram/debug.js'), 'utf8'), { module: config })
  const f = fixture(config.exports)
  await expect(f.helper.exportDetailImage(f.page)).resolves.toBe('wxfile://report.png')
  expect(f.logs).toEqual([])
  expect(f.wx.getImageInfo).toHaveBeenCalledOnce()
  expect(f.canvas).toMatchObject({ width: 1, height: 1 })
})
it('相册权限已拒绝不重复弹权限；首次拒绝、取消和系统失败分别处理', async () => {
  const f = fixture()
  f.wx.getSetting.mockImplementationOnce(o => o.success({ authSetting: { 'scope.writePhotosAlbum': false } }))
  expect(await f.helper.saveToAlbum('wxfile://report.png')).toEqual({ needsPermission: true })
  expect(f.wx.saveImageToPhotosAlbum).not.toHaveBeenCalled()
  f.wx.saveImageToPhotosAlbum.mockImplementationOnce(o => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }))
  expect(await f.helper.saveToAlbum('wxfile://report.png')).toEqual({ needsPermission: true })
  f.wx.saveImageToPhotosAlbum.mockImplementationOnce(o => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail cancel' }))
  expect(await f.helper.saveToAlbum('wxfile://report.png')).toEqual({ cancelled: true })
  f.wx.saveImageToPhotosAlbum.mockImplementationOnce(o => o.fail({ errMsg: 'disk full' }))
  await expect(f.helper.saveToAlbum('wxfile://report.png')).rejects.toThrow('存储空间')
})
it('长图分享使用本地文件、不附带私人页面入口；取消不报错，旧版回退预览', async () => {
  const f = fixture()
  f.wx.showShareImageMenu.mockImplementationOnce(o => o.fail({ errMsg: 'showShareImageMenu:fail cancel' }))
  await f.helper.shareImage('wxfile://report.png')
  expect(f.wx.showShareImageMenu.mock.calls[0][0]).toMatchObject({ path: 'wxfile://report.png', needShowEntrance: false })
  Reflect.deleteProperty(f.wx, 'showShareImageMenu')
  await f.helper.shareImage('wxfile://report.png')
  expect(f.wx.previewImage.mock.calls[0][0]).toMatchObject({ urls: ['wxfile://report.png'] })
})
