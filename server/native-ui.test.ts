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
  const wx = { onKeyboardHeightChange: vi.fn(), offKeyboardHeightChange: vi.fn(), hideKeyboard: vi.fn(), nextTick: (fn: () => void) => fn(),
    pageScrollTo: vi.fn(), stopPullDownRefresh: vi.fn(), navigateTo: ({ url }: { url: string }) => navigations.push(url), switchTab: ({ url }: { url: string }) => navigations.push(url) }
  function load(name: string): PageHarness {
    let page!: PageHarness
    const ui = { session: () => s, confirm: async (message: string) => { confirmations.push(message); return consent }, leaveGuard: vi.fn(),
      run: (fn: () => unknown) => { const p = Promise.resolve().then(fn).catch(e => errors.push(e)); tasks.push(p); return p } }
    runInNewContext(readFileSync(resolve('apps/miniprogram/pages', name, 'index.js'), 'utf8'), {
      require: (name: string) => name.endsWith('runtime') ? runtime : ui, getApp: () => app, wx,
      Page: (definition: PageHarness) => { page = definition; page.setData = (value: object) => Object.assign(page.data, value) },
    })
    return page
  }
  return { s, repo, wx, errors, confirmations, navigations, load, setConsent: (value: boolean) => { consent = value }, flush: () => Promise.all(tasks) }
}
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
