import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import * as runtime from '../packages/application/index'
import { Session } from '../packages/application/session'
import { LedgerService } from './service'
import { MemoryRepository } from './testing/memory-repository'

// Execute the actual native Page event handlers with a wx API test double.
// This checks wiring and identity/lifecycle guards, not real-device rendering.
type PageHarness = { data: Record<string, any>; setData(value: object): void; [key: string]: any }
async function fixture() {
  const repo = new MemoryRepository(), service = new LedgerService(repo)
  let id = 0
  const s = new Session({ env: 'test', now: () => '2026-09-12T08:00:00.000Z', requestId: () => `native_request_${++id}`,
    readCache: () => null, writeCache: () => {}, call: <T>(action: string, payload?: object) => service.handle('A', { action, payload }) as Promise<T>,
  }, '2026-09')
  await s.identify()
  const app = { session: s, ready: Promise.resolve() }
  const errors: Error[] = [], confirmations: string[] = [], navigations: string[] = []
  const tasks: Promise<unknown>[] = []
  let consent = true
  const imageTools = { exportDetailImage: vi.fn(async () => 'wxfile://detail.png'), saveToAlbum: vi.fn(async (_path: string) => ({ saved: true, needsPermission: false })),
    shareImage: vi.fn(async (_path: string) => {}), invoke: vi.fn(async (_name: string) => ({})) }
  const wx = { onKeyboardHeightChange: vi.fn(), offKeyboardHeightChange: vi.fn(), hideKeyboard: vi.fn(), nextTick: (fn: () => void) => fn(),
    getWindowInfo: vi.fn(() => ({ windowHeight: 650, screenHeight: 800, screenTop: 100 })),
    hideShareMenu: vi.fn(), showShareMenu: vi.fn(), showToast: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn(), navigateBack: vi.fn(),
    pageScrollTo: vi.fn(), stopPullDownRefresh: vi.fn(), navigateTo: ({ url }: { url: string }) => navigations.push(url), switchTab: ({ url }: { url: string }) => navigations.push(url) }
  function load(name: string): PageHarness {
    let page!: PageHarness
    const ui = { session: () => s, confirm: async (message: string) => { confirmations.push(message); return consent }, leaveGuard: vi.fn(),
      run: (fn: () => unknown) => { const p = Promise.resolve().then(fn).catch(e => errors.push(e)); tasks.push(p); return p } }
    runInNewContext(readFileSync(resolve('apps/miniprogram/pages', name, 'index.js'), 'utf8'), {
      require: (name: string) => name.endsWith('runtime') ? runtime : name.endsWith('detail-image') ? imageTools : ui, getApp: () => app, getCurrentPages: () => [{}, {}], wx,
      Page: (definition: PageHarness) => { page = definition; page.setData = (value: object) => Object.assign(page.data, value) },
    })
    return page
  }
  return { s, app, repo, wx, imageTools, errors, confirmations, navigations, load, setConsent: (value: boolean) => { consent = value }, flush: () => Promise.all(tasks) }
}
it('回到前台复用已确认会话，后台同步失败不清空明细；身份失效才重新确认', async () => {
  const f = await fixture()
  let definition!: { onShow(this: typeof f.app): void }
  runInNewContext(readFileSync(resolve('apps/miniprogram/app.js'), 'utf8'), {
    App: (value: typeof definition) => { definition = value }, require: (name: string) => name === './runtime' ? runtime : { cloudEnv: 'test' },
  })
  const identify = vi.spyOn(f.s, 'identify'), refresh = vi.spyOn(f.s, 'refreshConfig')
  f.s.calculate()
  const page = f.load('detail'); page.onLoad({}); await page.onShow()
  const view = page.data.view, epoch = f.s.epoch
  const updates = vi.spyOn(page, 'setData')
  const call = f.s.platform.call
  f.s.platform.call = async () => { throw new Error('offline') }
  definition.onShow.call(f.app); await f.app.ready; await page.onShow()
  await refresh.mock.results[0].value
  expect(identify).not.toHaveBeenCalled()
  expect(f.s.epoch).toBe(epoch)
  expect(page.data.view).toBe(view)
  expect(updates.mock.calls.some(([value]) => 'view' in value && value.view === null)).toBe(false)
  f.s.platform.call = call; f.s.identityReady = false
  definition.onShow.call(f.app); await f.app.ready
  expect(identify).toHaveBeenCalledOnce()
  page.onUnload()
})
it('历史明细从相册或其他应用返回保留视图，不重复读取记录；显式重试会刷新', async () => {
  const f = await fixture(); f.s.calculate(); await f.s.save()
  const call = vi.spyOn(f.s.platform, 'call')
  const page = f.load('detail'); page.onLoad({ id: f.s.saved!.id }); await page.onShow()
  const view = page.data.view
  page.onHide(); await page.onShow(); page.onHide(); await page.onShow()
  expect(page.data.view).toBe(view)
  expect(call.mock.calls.filter(([action]) => action === 'getRecord')).toHaveLength(1)
  page.retry(); await f.flush()
  expect(call.mock.calls.filter(([action]) => action === 'getRecord')).toHaveLength(2)
  page.onUnload()
})
it('原生计算页事件：添加、实时换算、确认删除、只计算不上传、手动保存', async () => {
  const f = await fixture(), page = f.load('calculate'); page.onLoad(); page.onShow()
  page.openSheet(); expect(page.data.sheet).toBe(true)
  page.sheetInput({ currentTarget: { dataset: { unit: 'lessons' } }, detail: { value: '5' } })
  expect(page.data.sheetHours).toBe('10'); page.add(); await f.flush()
  expect(page.data.rows).toHaveLength(1)
  expect(page.data.rows[0].hoursText).toBe('10')
  page.input({ currentTarget: { dataset: { key: '0-1', unit: 'lessons' } }, detail: { value: '10' } }); await f.flush()
  expect(page.data.rows[0].hoursText).toBe('20')
  page.add(); await f.flush(); expect(page.data.rows).toHaveLength(1)
  page.calculate(); await f.flush(); expect(page.data.result.amount).toBe('300.00'); expect(f.repo.count('calculation_records')).toBe(0)
  page.save(); await f.flush(); expect(page.data.resultLabel).toBe('已保存'); expect(f.repo.count('calculation_records')).toBe(1)
  f.setConsent(false); page.remove({ currentTarget: { dataset: { key: '0-1' } } }); await f.flush(); expect(page.data.rows).toHaveLength(1)
  f.setConsent(true); page.remove({ currentTarget: { dataset: { key: '0-1' } } }); await f.flush(); expect(page.data.rows).toHaveLength(0)
  expect(f.confirmations).toHaveLength(2); expect(f.errors).toEqual([]); page.onUnload()
})
it('新增课时每次默认一对一，并按重置后的班型重新判断已有组合', async () => {
  const f = await fixture(), page = f.load('calculate'); page.onLoad()
  page.openSheet()
  page.chooseGrade({ detail: { value: '1' } })
  page.chooseClass({ detail: { value: '2' } })
  page.sheetInput({ currentTarget: { dataset: { unit: 'hours' } }, detail: { value: '6' } })
  page.add(); await f.flush()
  page.openSheet()
  expect(page.data).toMatchObject({ gradeIndex: 1, classIndex: 0, sheetDuplicate: false, sheetHours: '', sheetLessons: '', sheetError: '' })
  page.sheetInput({ currentTarget: { dataset: { unit: 'hours' } }, detail: { value: '4' } })
  page.add(); await f.flush()
  expect(page.data.rows.map((row: any) => row.key)).toEqual(['1-3', '1-1'])
  page.openSheet()
  expect(page.data.sheetDuplicate).toBe(true)
  page.chooseClass({ detail: { value: '1' } })
  expect(page.data.sheetDuplicate).toBe(false)
  page.closeSheet(); await f.flush(); page.openSheet()
  expect(page.data).toMatchObject({ classIndex: 0, sheetDuplicate: true })
  expect(f.errors).toEqual([]); page.onUnload()
})
it('添加、定位已有课时和连续计算只收起键盘并滚动，不自动聚焦输入框', async () => {
  const f = await fixture(), page = f.load('calculate'); page.onLoad()
  // The native renderer owns focus. Check the template too: handler tests alone
  // cannot detect a persistent focus binding reopening the keyboard on setData.
  const template = readFileSync(resolve('apps/miniprogram/pages/calculate/index.wxml'), 'utf8')
  expect(template).not.toMatch(/\s(?:focus|auto-focus)=/)
  page.openSheet()
  page.sheetInput({ currentTarget: { dataset: { unit: 'lessons' } }, detail: { value: '5' } })
  f.wx.hideKeyboard.mockClear()
  page.add(); await f.flush()
  expect(page.data.sheet).toBe(false)
  expect(f.wx.hideKeyboard).toHaveBeenCalledOnce()
  expect(f.wx.pageScrollTo).toHaveBeenLastCalledWith({ selector: '#entry-0-1', duration: 250 })
  page.openSheet(); page.add(); await f.flush()
  expect(page.data.rows).toHaveLength(1)
  expect(page.data.rows[0].hoursText).toBe('10')
  f.wx.hideKeyboard.mockClear()
  page.calculate(); await f.flush(); page.calculate(); await f.flush()
  expect(page.data.result.amount).toBe('150.00')
  expect(f.wx.hideKeyboard).toHaveBeenCalledTimes(2)
  expect(f.wx.pageScrollTo).toHaveBeenLastCalledWith({ selector: '#result', duration: 250 })
  expect(f.errors).toEqual([]); page.onUnload()
})
it('键盘布局扣除原生底栏，兼容窗口随键盘缩小和恢复', async () => {
  const f = await fixture(), page = f.load('calculate'); page.onLoad(); page.onShow(); page.openSheet()
  const keyboard = page.keyboard as (event: { height: number }) => void
  expect(f.wx.onKeyboardHeightChange).toHaveBeenCalledWith(keyboard)
  keyboard({ height: 300 })
  expect(page.data).toMatchObject({ keyboardOpen: true, keyboardInset: 250, sheetHeight: 376 })
  f.wx.getWindowInfo.mockReturnValue({ windowHeight: 400, screenHeight: 800, screenTop: 100 })
  page.onResize()
  expect(page.data).toMatchObject({ keyboardOpen: true, keyboardInset: 0, sheetHeight: 376 })
  f.wx.getWindowInfo.mockReturnValue({ windowHeight: 650, screenHeight: 800, screenTop: 100 })
  keyboard({ height: 0 })
  expect(page.data).toMatchObject({ keyboardOpen: false, keyboardInset: 0, sheetHeight: 480 })
  page.closeSheet(); await f.flush()
  // A late native keyboard callback must never reopen a dismissed sheet.
  keyboard({ height: 300 })
  expect(page.data.sheet).toBe(false)
  page.onUnload()
  expect(f.wx.offKeyboardHeightChange).toHaveBeenCalledWith(keyboard)
})
it('没有有效正课时时禁用计算；有课时但单价为零仍能计算', async () => {
  const f = await fixture(), page = f.load('calculate'); page.onLoad()
  const calculate = vi.spyOn(f.s, 'calculate')
  expect(page.data.canCalculate).toBe(false)
  page.calculate(); await f.flush(); expect(calculate).not.toHaveBeenCalled()
  f.s.addRow(0, 1)
  for (const value of ['', '0', 'bad']) {
    f.s.updateRow('0-1', 'hours', value); page.calculate(); await f.flush()
    expect(page.data.canCalculate).toBe(false); expect(calculate).not.toHaveBeenCalled()
  }
  f.s.active!.config.rates[0][0] = 0
  f.s.updateRow('0-1', 'hours', '1')
  expect(page.data.canCalculate).toBe(true)
  page.calculate(); await f.flush(); expect(calculate).toHaveBeenCalledOnce()
  expect(page.data.result.amount).toBe('0.00')
  f.s.removeRow('0-1'); expect(page.data.canCalculate).toBe(false)
  page.calculate(); await f.flush(); expect(calculate).toHaveBeenCalledOnce()
  expect(f.errors).toEqual([]); page.onUnload()
})
it('原生设置页展示24个草稿输入，保存成功标记已有试算待重算', async () => {
  const f = await fixture(); f.s.calculate(); const page = f.load('settings'); page.onLoad(); await page.onShow()
  page.edit(); await f.flush(); expect(page.data.draftTiers.flatMap((t: any) => t.prices)).toHaveLength(24)
  page.input({ currentTarget: { dataset: { tier: 0, group: 0 } }, detail: { value: '20' } })
  expect(f.s.active!.config.rates[0][0]).toBe(1500)
  page.save(); await f.flush(); expect(page.data.editing).toBe(false); expect(f.s.active!.config.rates[0][0]).toBe(2000)
  expect(f.s.resultState).toBe('stale'); expect(f.errors).toEqual([]); page.onUnload()
})
it('原生历史与详情：读取快照、显式复用、不自动保存、确认删除', async () => {
  const f = await fixture(); f.s.addRow(0, 1); f.s.updateRow('0-1', 'hours', '20'); f.s.calculate(); const saved = await f.s.save()
  const history = f.load('history'); history.onLoad(); await history.load(true); expect(history.data.records[0].amount).toBe('300.00')
  const detail = f.load('detail'); detail.onLoad({ id: saved!.id }); await detail.load()
  expect(detail.data.view.table[0].prices[0].value).toBe('15.00')
  detail.reuse(); await f.flush(); expect(f.s.instance).toBeNull(); expect(f.repo.count('calculation_records')).toBe(1)
  expect(f.navigations).toContain('/pages/calculate/index')
  detail.remove(); await f.flush(); expect(f.repo.count('calculation_records')).toBe(0)
  expect(f.confirmations.at(-1)).toContain('300.00'); expect(f.navigations.at(-1)).toBe('/pages/history/index')
  expect(f.errors).toEqual([]); history.onUnload(); detail.onUnload()
})
it('列表返回前台静默刷新全部已加载页，保留旧内容直到更新完成且不重复请求', async () => {
  const f = await fixture()
  for (let i = 0; i < 25; i++) { f.s.calculate(); await f.s.save() }
  const page = f.load('history'); page.onLoad(); await page.onShow(); await page.load(false)
  expect(page.data.records).toHaveLength(25)
  const records = page.data.records, removed = records[0].id
  await f.s.call('deleteRecord', { id: removed })
  const call = f.s.platform.call
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), requested = new Promise<void>(resolve => { started = resolve })
  const requests: object[] = []
  f.s.platform.call = async <T>(action: string, payload?: object) => {
    if (action === 'listRecords') { requests.push(payload!); started(); await gate }
    return call<T>(action, payload)
  }
  const updates = vi.spyOn(page, 'setData')
  page.onHide(); const showing = page.onShow(); await requested
  expect(page.data.records).toBe(records); expect(page.data.loading).toBe(false)
  await page.onShow(); await page.load(false)
  expect(requests).toHaveLength(1)
  release(); await showing
  expect(requests).toHaveLength(2)
  expect(page.data.records).toHaveLength(24)
  expect(page.data.records.some((r: any) => r.id === removed)).toBe(false)
  expect(updates.mock.calls.some(([value]) => 'records' in value && (value.records as unknown[]).length === 0)).toBe(false)
  expect(page.data.error).toBe(''); page.onUnload()
})
it('列表静默刷新断网保留记录和分页游标，手动刷新失败可重试第一页', async () => {
  const f = await fixture(); f.s.calculate(); await f.s.save()
  const page = f.load('history'); page.onLoad(); await page.onShow()
  const records = page.data.records, cursor = { id: 'previous-page', savedAt: 1 }
  page.cursor = cursor; page.setData({ hasMore: true })
  const call = f.s.platform.call
  f.s.platform.call = async () => { throw new Error('offline') }
  await page.onShow()
  expect(page.data.records).toBe(records); expect(page.cursor).toBe(cursor)
  expect(page.data).toMatchObject({ loading: false, error: '', hasMore: true })
  await page.load(true)
  expect(page.data.records).toBe(records); expect(page.data.error).toBe('offline')
  f.s.platform.call = call
  const load = vi.spyOn(page, 'load')
  page.retry(); await load.mock.results[0].value
  expect(load).toHaveBeenCalledWith(true)
  expect(page.data.records).toHaveLength(1); expect(page.data.error).toBe('')
  page.onUnload()
})
it('月份切换清除旧筛选记录，迟到的静默刷新不能覆盖新月份；卸载后不更新页面', async () => {
  const f = await fixture(); f.s.calculate(); await f.s.save()
  const page = f.load('history'); page.onLoad(); await page.onShow()
  let release!: (result: unknown) => void, started!: () => void
  const requested = new Promise<void>(resolve => { started = resolve }), call = f.s.platform.call
  f.s.platform.call = <T>(action: string, payload?: object) => {
    if (action === 'listRecords' && !(payload as { month?: string }).month) return new Promise<T>(resolve => { release = resolve as (result: unknown) => void; started() })
    return call<T>(action, payload)
  }
  const showing = page.onShow(); await requested
  const old = await call('listRecords', { limit: 20 })
  const load = vi.spyOn(page, 'load')
  page.changeMonth({ detail: { value: '2026-08' } })
  expect(page.data.records).toEqual([]); expect(page.data.loading).toBe(true)
  await load.mock.results[0].value
  release(old); await showing
  expect(page.data.month).toBe('2026-08'); expect(page.data.records).toEqual([])
  page.onUnload()
  const updates = vi.spyOn(page, 'setData')
  await page.onShow()
  expect(updates).not.toHaveBeenCalled()
})
it('原生页面身份等待时清除个人列表、草稿和明细，错误不会伪装成空列表', async () => {
  const f = await fixture(); f.s.calculate(); const r = await f.s.save()
  const history = f.load('history'); history.onLoad(); await history.load(true)
  const detail = f.load('detail'); detail.onLoad({ id: r!.id }); await detail.load()
  const settings = f.load('settings'); settings.onLoad(); settings.edit(); await f.flush()
  f.s.identifying = true; f.s.identityReady = false; f.s.emit()
  expect(history.data.records).toEqual([]); expect(detail.data.view).toBeNull(); expect(settings.data.draftTiers).toEqual([])
  f.s.identifying = false; f.s.identityReady = true
  f.s.platform.call = async () => { throw new Error('offline') }
  await history.load(true); expect(history.data.error).toBe('offline'); expect(history.data.loading).toBe(false)
  history.onUnload(); detail.onUnload(); settings.onUnload()
})
it('试算和历史明细均可本地保存/分享长图，操作不创建云端记录或分享快照', async () => {
  const f = await fixture(); f.s.calculate()
  const page = f.load('detail'); page.onLoad({ mode: 'trial' }); await page.onShow()
  page.saveImage(); await f.flush()
  expect(f.imageTools.saveToAlbum).toHaveBeenCalledWith('wxfile://detail.png')
  page.openShare(); page.shareLongImage(); await f.flush()
  expect(f.imageTools.shareImage).toHaveBeenCalledWith('wxfile://detail.png')
  expect(f.imageTools.exportDetailImage).toHaveBeenCalledTimes(2)
  expect(f.repo.count('calculation_records')).toBe(0); expect(f.repo.count('shared_calculations')).toBe(0)
  const record = await f.s.save()
  const history = f.load('detail'); history.onLoad({ id: record!.id }); await history.onShow()
  history.saveImage(); await f.flush()
  expect(f.imageTools.saveToAlbum).toHaveBeenCalledTimes(2)
  expect(f.repo.count('shared_calculations')).toBe(0)
  expect(f.errors).toEqual([]); page.onUnload(); history.onUnload()
})
it('长图生成超时关闭转圈并恢复按钮，用户可以再次生成', async () => {
  const f = await fixture(); f.s.calculate()
  const page = f.load('detail'); page.onLoad({}); await page.onShow()
  f.imageTools.exportDetailImage.mockRejectedValueOnce(new Error('长图生成超时，请重试'))
  await page.saveImage(); await f.flush()
  expect(page.data.exporting).toBe(false)
  expect(f.wx.hideLoading).toHaveBeenCalled()
  expect(f.imageTools.saveToAlbum).not.toHaveBeenCalled()
  expect(f.errors.map(e => e.message)).toEqual(['长图生成超时，请重试'])
  await page.saveImage(); await f.flush()
  expect(f.imageTools.saveToAlbum).toHaveBeenCalledOnce()
  expect(page.data.exporting).toBe(false)
  page.onUnload()
})
it('小程序分享准备成功后才使用只读链接；分享页不能复用/删除，可回到首页', async () => {
  const f = await fixture(); f.s.addRow(1, 2); f.s.updateRow('1-2', 'hours', '10'); f.s.calculate()
  const page = f.load('detail'); page.onLoad({ mode: 'trial' }); await page.onShow()
  expect(page.onShareAppMessage().path).toBe('/pages/calculate/index')
  page.openShare(); expect(f.repo.count('shared_calculations')).toBe(0)
  page.prepareShare(); await f.flush()
  const token = page.data.shareToken
  expect(token).toMatch(/^[a-f0-9]{64}$/)
  expect(page.onShareAppMessage().path).toBe(`/pages/detail/index?share=${token}`)
  expect(f.repo.count('calculation_records')).toBe(0)
  const shared = f.load('detail'); shared.onLoad({ share: token, id: 'ignored_private_id' }); await shared.onShow()
  expect(shared.data).toMatchObject({ shared: true, homeNavigation: true, state: '分享明细 · 只读' })
  expect(shared.data.view.amount).toBe(page.data.view.amount)
  const before = runtime.clone(f.s.instance)
  shared.reuse(); shared.remove(); shared.prepareShare(); await f.flush()
  expect(f.s.instance).toEqual(before); expect(f.confirmations).toHaveLength(0)
  shared.navigateBack(); expect(f.navigations.at(-1)).toBe('/pages/calculate/index')
  shared.saveImage(); await f.flush(); expect(f.imageTools.saveToAlbum).toHaveBeenCalled()
  page.revokeShare(); await f.flush()
  await shared.load(); expect(shared.data.view).toBeNull(); expect(shared.data.error).toContain('停止分享')
  expect(page.data.shareToken).toBe('')
  expect(f.errors).toEqual([]); page.onUnload(); shared.onUnload()
})
it('分享创建失败保留原明细且可重试；相册拒绝权限提供设置入口', async () => {
  const f = await fixture(); f.s.calculate()
  const page = f.load('detail'); page.onLoad({}); await page.onShow()
  const call = f.s.platform.call
  f.s.platform.call = async () => { throw new Error('offline') }
  page.prepareShare(); await f.flush()
  expect(page.data.shareToken).toBe(''); expect(page.data.preparing).toBe(false); expect(page.data.view).not.toBeNull()
  expect(page.onShareAppMessage().path).toBe('/pages/calculate/index')
  const requestId = page.shareRequest.requestId
  f.s.platform.call = call; page.prepareShare(); await f.flush()
  expect(page.shareRequest.requestId).toBe(requestId); expect(page.data.shareToken).not.toBe('')
  f.imageTools.saveToAlbum.mockResolvedValue({ saved: false, needsPermission: true })
  page.saveImage(); await f.flush()
  expect(page.data).toMatchObject({ albumPermission: true, exporting: false })
  page.albumSettings(); await f.flush(); expect(f.imageTools.invoke).toHaveBeenCalledWith('openSetting')
  expect(f.errors.map(e => e.message)).toEqual(['offline']); page.onUnload()
})
it('分享页返回前台在保留内容时后台验证，断网不闪空白，已撤销则清除明细', async () => {
  const f = await fixture(); f.s.calculate()
  const owner = f.load('detail'); owner.onLoad({}); await owner.onShow(); owner.prepareShare(); await f.flush()
  const shared = f.load('detail'); shared.onLoad({ share: owner.data.shareToken }); await shared.onShow()
  const view = shared.data.view, call = f.s.platform.call
  let fail!: (error: unknown) => void
  let requested!: () => void
  const started = new Promise<void>(resolve => { requested = resolve })
  f.s.platform.call = () => new Promise((_resolve, reject) => { fail = reject; requested() })
  shared.onHide(); const showing = shared.onShow(); await started
  expect(shared.data.view).toBe(view); expect(shared.data.loading).toBe(false)
  fail(new Error('offline')); await showing
  expect(shared.data.view).toBe(view); expect(shared.data.error).toBe('')
  f.s.platform.call = call; owner.revokeShare(); await f.flush()
  await shared.onShow()
  expect(shared.data.view).toBeNull(); expect(shared.data.shareToken).toBe('')
  expect(shared.data.error).toContain('停止分享')
  owner.onUnload(); shared.onUnload()
})
it('分享创建和图片生成的迟到响应不覆盖新身份，也不在离开页面后打开分享或相册', async () => {
  const f = await fixture(); f.s.calculate()
  const page = f.load('detail'); page.onLoad({}); await page.onShow()
  let resolveShare!: (value: unknown) => void
  const call = f.s.platform.call
  f.s.platform.call = <T>() => new Promise<T>(resolve => { resolveShare = resolve as (value: unknown) => void })
  page.prepareShare(); await Promise.resolve()
  ++f.s.epoch; f.s.identifying = true; f.s.identityReady = false; f.s.emit()
  resolveShare({ token: 'a'.repeat(64) }); await f.flush()
  expect(page.data.shareToken).toBe(''); expect(page.data.view).toBeNull()
  expect(page.onShareAppMessage().path).toBe('/pages/calculate/index')
  f.s.platform.call = call; f.s.identifying = false; f.s.identityReady = true
  await page.load()
  let resolveImage!: (path: string) => void
  f.imageTools.exportDetailImage.mockImplementationOnce(() => new Promise(resolve => { resolveImage = resolve }))
  page.saveImage(); await Promise.resolve(); page.onUnload()
  resolveImage('wxfile://old.png'); await f.flush()
  expect(f.imageTools.saveToAlbum).not.toHaveBeenCalled()
  expect(f.imageTools.shareImage).not.toHaveBeenCalled()
})
