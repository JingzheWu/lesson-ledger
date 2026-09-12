import { describe, expect, it } from 'vitest'
import { Session } from './session'
import { sessionView } from './presentation'
import { clone, LedgerError } from '../core/contracts'
import type { CloudConfig, SavedRecord } from '../core/contracts'
import { LedgerService } from '../../server/service'
import { MemoryRepository } from '../../server/testing/memory-repository'

function fixture() {
  const repo = new MemoryRepository(), service = new LedgerService(repo, () => 1789200000000)
  const cache = new Map<string, unknown>(), calls: { action: string; payload?: object }[] = []
  let owner = 'user_A', count = 0, failAction = '', loseAction = ''
  const s = new Session({ env: 'test-env', readCache: key => cache.get(key), writeCache: (key, value) => { cache.set(key, value) },
    now: () => '2026-09-12T08:00:00.000Z', requestId: () => `request_fixture_${++count}`,
    call: async <T>(action: string, payload?: object) => {
      calls.push({ action, payload })
      if (action === failAction) throw new LedgerError('UNAVAILABLE', '离线')
      const result = await service.handle(owner, { action, payload })
      if (action === loseAction) throw new LedgerError('UNAVAILABLE', '响应丢失')
      return result as T
    },
  }, '2026-09')
  return { s, repo, service, cache, calls,
    setOwner: (value: string) => { owner = value }, fail: (value: string) => { failAction = value }, lose: (value: string) => { loseAction = value } }
}
const enter = (s: Session) => { const key = s.addRow(0, 1); s.updateRow(key, 'hours', '20'); return key }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
describe('小程序会话状态与平台隔离', () => {
  it('MP-01 计算三次无上传，输入结果也不写本地持久化', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); const calls = f.calls.length
    for (let i = 0; i < 3; i++) f.s.calculate()
    expect(f.calls.length).toBe(calls); expect(f.repo.count('calculation_records')).toBe(0)
    expect(f.cache.size).toBe(1)
    expect([...f.cache.keys()][0]).toBe('lesson-ledger:config:v1:test-env:user_A')
    expect(Object.keys([...f.cache.values()][0] as object).sort()).toEqual(['config', 'revision', 'rules', 'versionId'])
  })
  it('MP-04 输入变化使旧结果待重算，保存不会绕过；零课时允许保存', async () => {
    const f = fixture(); await f.s.identify(); const key = enter(f.s); f.s.calculate()
    f.s.updateRow(key, 'lessons', '11'); expect(f.s.resultState).toBe('stale')
    expect(sessionView(f.s).canSave).toBe(false); await expect(f.s.save()).rejects.toThrow('重新计算')
    f.s.calculate(); await f.s.save(); expect(f.s.resultState).toBe('saved')
    f.s.clear(); f.s.calculate(); await f.s.save(); expect(f.s.saved?.result.totalFeeCents).toBe(0)
  })
  it('双向换算、重复组合定位、非法输入阻止计算、切月份保留课时', async () => {
    const f = fixture(); const key = enter(f.s)
    expect(f.s.addRow(0, 1)).toBe(key); expect(f.s.rows).toHaveLength(1)
    f.s.updateRow(key, 'hours', '0.01'); expect(f.s.rows[0].lessonsText).toBe('0.005')
    f.s.updateRow(key, 'lessons', '25'); expect(f.s.rows[0].hoursText).toBe('50')
    f.s.setMonth('2026-08'); expect(f.s.rows[0].hoursText).toBe('50'); expect(f.s.notice).toContain('核对课时')
    for (const value of ['0.001', '-1', 'abc', '.']) {
      f.s.updateRow(key, 'hours', value); expect(() => f.s.calculate()).toThrow()
    }
    f.s.updateRow(key, 'hours', '1.'); expect(() => f.s.calculate()).toThrow()
    f.s.updateRow(key, 'hours', '1.', true); f.s.calculate(); expect(f.s.instance?.result.totalHoursHundredths).toBe(100)
  })
  it('MP-03 超时后保留实例标识，查询或重试确认同一条；已保存直接返回记录', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); f.s.calculate(); const id = f.s.instance!.requestId
    f.lose('saveRecord'); await expect(f.s.save()).rejects.toThrow(); expect(f.s.resultState).toBe('unknown')
    expect(f.s.instance!.requestId).toBe(id)
    await f.s.confirmSave(); expect(f.s.resultState).toBe('saved'); expect(f.repo.count('calculation_records')).toBe(1)
    const count = f.calls.length; await f.s.save(); expect(f.calls.length).toBe(count)
    f.s.calculate(); f.lose('saveRecord'); await expect(f.s.save()).rejects.toThrow()
    f.lose(''); await f.s.save(); expect(f.repo.count('calculation_records')).toBe(2)
  })
  it('保存期间冻结输入、月份、清空和配置草稿提交', async () => {
    const f = fixture(); await f.s.identify(); const key = enter(f.s); f.s.calculate(); f.s.beginEdit()
    const original = f.s.platform.call, gate = deferred<SavedRecord>()
    f.s.platform.call = <T>(action: string, payload?: object) => action === 'saveRecord' ? gate.promise as Promise<T> : original<T>(action, payload)
    const save = f.s.save()
    expect(f.s.resultState).toBe('saving')
    for (const mutate of [() => f.s.updateRow(key, 'hours', '30'), () => f.s.setMonth('2026-08'), () => f.s.clear(), () => f.s.calculate()]) expect(mutate).toThrow('稍候')
    await f.s.saveConfig(); expect(f.repo.count('config_versions')).toBe(1)
    gate.reject(new LedgerError('UNAVAILABLE', 'timeout')); await expect(save).rejects.toThrow()
  })
  it('MP-10 身份确认前隐藏缓存和输入；切账号清空输入、结果与草稿', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); f.s.calculate(); f.s.beginEdit()
    const original = f.s.platform.call, gate = deferred<{ userKey: string }>()
    f.s.platform.call = <T>(action: string, payload?: object) => action === 'identity' ? gate.promise as Promise<T> : original<T>(action, payload)
    f.setOwner('user_B'); const identity = f.s.identify()
    expect(sessionView(f.s).rows).toEqual([]); expect(sessionView(f.s).result).toBeNull(); expect(sessionView(f.s).identityReady).toBe(false)
    gate.resolve({ userKey: 'user_B' }); await identity
    expect(f.s.rows).toEqual([]); expect(f.s.instance).toBeNull(); expect(f.s.draft).toBeNull()
    expect(f.s.userKey).toBe('user_B'); expect(f.cache.size).toBe(2)
  })
  it('身份失败不显示私人缓存；首次默认试算恢复后必须重算才能保存', async () => {
    const f = fixture(); f.fail('identity'); await f.s.identify(); enter(f.s); f.s.calculate()
    expect(f.s.instance!.versionId).toBeNull(); await expect(f.s.save()).rejects.toThrow()
    expect(f.cache.size).toBe(0); f.fail(''); await f.s.identify()
    expect(f.s.rows).toHaveLength(1); expect(f.s.resultState).toBe('stale'); await expect(f.s.save()).rejects.toThrow()
    f.s.calculate(); await f.s.save(); expect(f.s.saved).not.toBeNull()
    f.fail('identity'); await f.s.identify(); expect(f.s.rows).toEqual([]); expect(f.s.active).toBeNull(); expect(f.s.identityReady).toBe(false)
  })
  it('MP-09/13 已确认身份断网使用本人缓存，恢复联网只读取配置不补传', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); f.s.calculate(); const version = f.s.active!.versionId
    f.fail('getConfig'); await f.s.identify(); expect(f.s.active!.versionId).toBe(version); expect(f.s.rows).toHaveLength(1)
    f.s.calculate(); f.fail('saveRecord'); await expect(f.s.save()).rejects.toThrow(); expect(f.s.resultState).toBe('unknown')
    const saves = f.calls.filter(c => c.action === 'saveRecord').length
    f.fail(''); await f.s.refreshConfig()
    expect(f.calls.filter(c => c.action === 'saveRecord')).toHaveLength(saves); expect(f.repo.count('calculation_records')).toBe(0)
  })
  it('已有输入发现远端版本不偷换；应用新表标待重算，继续旧表可保存', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); f.s.calculate(); const old = f.s.active!
    const rates = clone(old.config.rates); rates[0][0] = 2000
    const updated = await f.service.handle('user_A', { action: 'saveConfig', payload: { requestId: 'remote_config_001', expectedRevision: 1, rates } }) as CloudConfig
    await f.s.refreshConfig(); expect(f.s.active!.versionId).toBe(old.versionId); expect(f.s.pendingConfig!.versionId).toBe(updated.versionId)
    await f.s.save(); expect(f.s.saved!.result.totalFeeCents).toBe(30000)
    f.s.applyPending(); expect(f.s.resultState).toBe('stale'); f.s.calculate(); expect(f.s.instance!.result.totalFeeCents).toBe(40000)
  })
  it('配置失败保留原生效表与草稿；未知状态冻结，重试成功生效', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); f.s.calculate(); f.s.beginEdit(); f.s.editPrice(0, 0, '20')
    const old = f.s.active; f.lose('saveConfig'); await expect(f.s.saveConfig()).rejects.toThrow()
    expect(f.s.active).toBe(old); expect(f.s.draft!.texts[0][0]).toBe('20'); expect(f.s.draft!.unknown).toBe(true)
    f.s.editPrice(0, 0, '30'); expect(f.s.draft!.texts[0][0]).toBe('20')
    expect(() => f.s.cancelEdit()).toThrow('确认')
    await f.s.confirmConfig(); expect(f.s.active!.config.rates[0][0]).toBe(2000); expect(f.s.draft).toBeNull(); expect(f.s.resultState).toBe('stale')
  })
  it('MP-11 配置冲突保留草稿，加载最新后重新编辑', async () => {
    const f = fixture(); await f.s.identify(); f.s.beginEdit(); f.s.editPrice(0, 0, '21')
    const rates = clone(f.s.active!.config.rates); rates[0][0] = 2000
    await f.service.handle('user_A', { action: 'saveConfig', payload: { requestId: 'remote_config_002', expectedRevision: 1, rates } })
    await expect(f.s.saveConfig()).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(f.s.draft!.texts[0][0]).toBe('21'); expect(f.s.draft!.conflict).toBe(true)
    await f.s.loadLatestDraft(); expect(f.s.draft!.base.revision).toBe(2); expect(f.s.draft!.texts[0][0]).toBe('20.00')
    expect(f.s.draft!.comparison![0][0]).toBe('21')
    f.s.editPrice(0, 0, '22'); await f.s.saveConfig(); expect(f.s.active!.config.rates[0][0]).toBe(2200)
  })
  it('恢复默认仅修改草稿；取消不影响生效配置；价格校验不发请求', async () => {
    const f = fixture(); await f.s.identify(); f.s.beginEdit(); f.s.editPrice(0, 0, '20'); await f.s.saveConfig()
    f.s.beginEdit(); f.s.resetDraft(); expect(f.s.draft!.texts[0][0]).toBe('15.00'); expect(f.s.active!.config.rates[0][0]).toBe(2000)
    f.s.cancelEdit(); expect(f.s.active!.config.rates[0][0]).toBe(2000)
    f.s.beginEdit(); f.s.editPrice(0, 0, '0.001'); const count = f.calls.length
    await expect(f.s.saveConfig()).rejects.toThrow(); expect(f.calls.length).toBe(count)
  })
  it('MP-15 复用读取当前表、保留月份、复制独立草稿且默认不计算不保存', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); f.s.setMonth('2026-08'); f.s.calculate(); const old = await f.s.save()
    f.s.beginEdit(); f.s.editPrice(0, 0, '20'); await f.s.saveConfig()
    await f.s.reuse(old!); expect(f.s.month).toBe('2026-08'); expect(f.s.instance).toBeNull(); expect(f.s.sourceRecordId).toBe(old!.id)
    expect(f.s.notice).toContain('请重新计算'); f.s.calculate(); expect(f.s.instance!.result.totalFeeCents).toBe(40000)
    expect(old!.result.totalFeeCents).toBe(30000); expect(f.repo.count('calculation_records')).toBe(1)
  })
  it('旧账号的迟到保存响应不覆盖新账号状态', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); f.s.calculate()
    const original = f.s.platform.call, gate = deferred<SavedRecord>()
    f.s.platform.call = <T>(action: string, payload?: object) => action === 'saveRecord' ? gate.promise as Promise<T> : original<T>(action, payload)
    const pending = f.s.save(); f.setOwner('user_B'); await f.s.identify()
    gate.resolve({ id: 'old_record' } as SavedRecord)
    await expect(pending).rejects.toMatchObject({ code: 'SUPERSEDED' })
    expect(f.s.saved).toBeNull(); expect(f.s.instance).toBeNull(); expect(f.s.resultState).toBe('none')
  })
  it('切后台时的保存转为未知；返回同账号后可查询，不停留在正在保存', async () => {
    const f = fixture(); await f.s.identify(); enter(f.s); f.s.calculate()
    const original = f.s.platform.call, gate = deferred<SavedRecord>()
    f.s.platform.call = <T>(action: string, payload?: object) => action === 'saveRecord' ? gate.promise as Promise<T> : original<T>(action, payload)
    const pending = f.s.save(); await f.s.identify(); expect(f.s.resultState).toBe('unknown')
    gate.reject(new LedgerError('UNAVAILABLE', 'timeout')); await expect(pending).rejects.toThrow()
    expect(f.s.resultState).toBe('unknown')
  })
  it('配置保存后的迟到旧配置读取不能覆盖新表；复用期间修改课时不能被迟到响应替换', async () => {
    const f = fixture(); await f.s.identify(); const old = clone(f.s.active!)
    const original = f.s.platform.call, gate = deferred<CloudConfig>()
    f.s.platform.call = <T>(action: string, payload?: object) => action === 'getConfig' ? gate.promise as Promise<T> : original<T>(action, payload)
    const refresh = f.s.refreshConfig()
    f.s.beginEdit(); f.s.editPrice(0, 0, '20'); await f.s.saveConfig()
    gate.resolve(old); await refresh; expect(f.s.active!.config.rates[0][0]).toBe(2000)
    f.s.calculate(); const saved = await f.s.save()
    const gate2 = deferred<CloudConfig>()
    f.s.platform.call = <T>(action: string, payload?: object) => action === 'getConfig' ? gate2.promise as Promise<T> : original<T>(action, payload)
    const reuse = f.s.reuse(saved!); enter(f.s); gate2.resolve(f.s.active!)
    await expect(reuse).rejects.toMatchObject({ code: 'SUPERSEDED' })
    expect(f.s.rows[0].hoursText).toBe('20')
  })
})
