import { describe, expect, it } from 'vitest'
import { calculate, RULE_VERSION } from '../packages/core/domain'
import { clone, isReadableRecord } from '../packages/core/contracts'
import type { CloudConfig, RecordPage, SavedRecord, SaveRecordRequest } from '../packages/core/contracts'
import { LedgerService } from './service'
import { MemoryRepository } from './testing/memory-repository'

const time = '2026-09-10T10:00:00.000Z'
const input = { month: '2026-09', entries: [{ gradeId: 0, classSize: 1 as const, hoursHundredths: 2000 }, { gradeId: 5, classSize: 1 as const, hoursHundredths: 2000 }] }
function fixture() {
  const repo = new MemoryRepository(), service = new LedgerService(repo, () => Date.parse(time))
  const call = <T>(owner: string, action: string, payload: object = {}) => service.handle(owner, { action, payload }) as Promise<T>
  return { repo, service, call, config: (owner = 'A') => call<CloudConfig>(owner, 'getConfig') }
}
function request(config: CloudConfig, requestId = 'request_00000000001'): SaveRecordRequest {
  const result = calculate(input, config.config, time)
  return { requestId, versionId: config.versionId, ruleVersion: RULE_VERSION, input: result.input, calculatedAt: time, expectedResult: result }
}
describe('云端一致性与权限', () => {
  it('MP-01/02/03 试算不写记录；并发相同请求仅一条，快照完整', async () => {
    const f = fixture(), c = await f.config(), p = request(c)
    for (let i = 0; i < 3; i++) calculate(input, c.config, time)
    expect(f.repo.count('calculation_records')).toBe(0)
    const saved = await Promise.all(Array.from({ length: 8 }, () => f.call<SavedRecord>('A', 'saveRecord', p)))
    expect(new Set(saved.map(r => r.id)).size).toBe(1)
    expect(f.repo.count('calculation_records')).toBe(1)
    expect(saved[0].result.totalFeeCents).toBe(135000)
    expect(saved[0].rules.grades).toHaveLength(12)
    expect(saved[0].rules.classes[2]).toMatchObject({ numerator: 13, denominator: 10 })
    expect(saved[0].result.config.rates.flat()).toHaveLength(24)
    expect(isReadableRecord(saved[0])).toBe(true)
    expect(await f.call('A', 'saveStatus', { requestId: p.requestId })).toEqual({ status: 'saved', record: saved[0] })
  })
  it('MP-05/06/12 历史1350不变，调价1450，仍允许本人冻结旧版本保存', async () => {
    const f = fixture(), old = await f.config()
    const r1 = await f.call<SavedRecord>('A', 'saveRecord', request(old))
    const rates = clone(old.config.rates); rates[0][0] = 2000
    const current = await f.call<CloudConfig>('A', 'saveConfig', { requestId: 'config_00000000001', expectedRevision: 1, rates })
    expect((await f.call<SavedRecord>('A', 'getRecord', { id: r1.id })).result.totalFeeCents).toBe(135000)
    expect((await f.call<SavedRecord>('A', 'getRecord', { id: r1.id })).result.config.rates[0][0]).toBe(1500)
    const r2 = await f.call<SavedRecord>('A', 'saveRecord', { ...request(current, 'request_00000000002'), sourceRecordId: r1.id })
    expect(r2.result.totalFeeCents).toBe(145000)
    expect((await f.call<SavedRecord>('A', 'saveRecord', request(old, 'request_00000000003'))).result.totalFeeCents).toBe(135000)
    expect((await f.call<RecordPage>('A', 'listRecords')).records).toHaveLength(3)
    await f.call('A', 'deleteRecord', { id: r1.id })
    expect((await f.call<SavedRecord>('A', 'getRecord', { id: r2.id })).result.totalFeeCents).toBe(145000)
  })
  it('MP-07/08/14 所有操作拒绝伪造身份、其他人的版本、来源与记录ID', async () => {
    const f = fixture(), a = await f.config(), b = await f.config('B')
    const record = await f.call<SavedRecord>('B', 'saveRecord', request(b))
    for (const action of ['getRecord', 'deleteRecord']) await expect(f.call('A', action, { id: record.id })).rejects.toMatchObject({ code: 'NOT_FOUND', message: '记录不存在或不可访问' })
    await expect(f.call('A', 'saveRecord', request(b))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(f.call('A', 'saveRecord', { ...request(a), sourceRecordId: record.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    for (const field of ['openid', 'ownerId', 'userId']) {
      for (const action of ['identity', 'getConfig', 'saveConfig', 'saveRecord', 'listRecords', 'getRecord', 'deleteRecord', 'saveStatus', 'configStatus']) {
        await expect(f.call('A', action, { [field]: 'B' })).rejects.toMatchObject({ code: 'INVALID' })
      }
    }
    expect((await f.call<RecordPage>('A', 'listRecords')).records).toEqual([])
    expect(await f.call('A', 'saveStatus', { requestId: record.requestId })).toEqual({ status: 'absent' })
    expect((await f.config()).config.rates).toEqual(a.config.rates)
    expect((await f.call<SavedRecord>('B', 'getRecord', { id: record.id })).id).toBe(record.id)
  })
  it('MP-11 并发首次初始化只建一个版本；并发修订仅一个成功', async () => {
    const f = fixture()
    const configs = await Promise.all(Array.from({ length: 10 }, () => f.config()))
    expect(new Set(configs.map(c => c.versionId)).size).toBe(1)
    expect(f.repo.count('user_configs')).toBe(1); expect(f.repo.count('config_versions')).toBe(1)
    const results = await Promise.allSettled([2000, 2500].map((price, i) => {
      const rates = clone(configs[0].config.rates); rates[0][0] = price
      return f.call('A', 'saveConfig', { requestId: `config_concurrent_${i}`, expectedRevision: 1, rates })
    }))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } })
    expect((await f.config()).revision).toBe(2); expect(f.repo.count('config_versions')).toBe(2)
  })
  it('配置响应丢失重试返回原成功版本；无变化不新增版本', async () => {
    const f = fixture(), c = await f.config(), rates = clone(c.config.rates)
    await f.call('A', 'saveConfig', { requestId: 'config_nochange_001', expectedRevision: 1, rates })
    expect(f.repo.count('config_versions')).toBe(1)
    rates[0][0] = 2000
    const p = { requestId: 'config_response_001', expectedRevision: 1, rates }
    const saved = await f.call<CloudConfig>('A', 'saveConfig', p)
    expect(await f.call('A', 'saveConfig', p)).toEqual(saved)
    expect(await f.call('A', 'configStatus', { requestId: p.requestId })).toEqual({ status: 'saved', config: saved })
    await expect(f.call('A', 'saveConfig', { ...p, expectedRevision: 2 })).rejects.toMatchObject({ code: 'REQUEST_REUSED' })
  })
  it('MP-14 篡改明细或总额拒绝；相同请求标识不同内容拒绝', async () => {
    const f = fixture(), c = await f.config(), p = request(c)
    const forged = clone(p); forged.expectedResult.totalFeeCents = 1
    await expect(f.call('A', 'saveRecord', forged)).rejects.toMatchObject({ code: 'MISMATCH' })
    const line = clone(p); line.expectedResult.tiers[0].details[0].feeCents++
    await expect(f.call('A', 'saveRecord', line)).rejects.toMatchObject({ code: 'MISMATCH' })
    expect(f.repo.count('calculation_records')).toBe(0)
    await f.call('A', 'saveRecord', p)
    await expect(f.call('A', 'saveRecord', forged)).rejects.toMatchObject({ code: 'REQUEST_REUSED' })
    expect(f.repo.count('calculation_records')).toBe(1)
  })
  it('MP-15 删除整条数据，重试不复活；无权限和不存在统一错误', async () => {
    const f = fixture(), c = await f.config(), p = request(c)
    const saved = await f.call<SavedRecord>('A', 'saveRecord', p)
    await f.call('A', 'deleteRecord', { id: saved.id })
    expect(f.repo.count('calculation_records')).toBe(0)
    expect(await f.call('A', 'saveStatus', { requestId: p.requestId })).toEqual({ status: 'deleted' })
    await expect(f.call('A', 'saveRecord', p)).rejects.toMatchObject({ code: 'DELETED' })
    for (const owner of ['A', 'B']) await expect(f.call(owner, 'deleteRecord', { id: saved.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await f.config()).toEqual(c)
  })
  it('MP-16 同毫秒53条分页不重复不漏项，月份与用户筛选生效', async () => {
    const f = fixture(), c = await f.config()
    for (let i = 0; i < 53; i++) await f.call('A', 'saveRecord', request(c, `pagination_request_${i}`))
    await f.call('B', 'saveRecord', request(await f.config('B')))
    const seen: string[] = []; let cursor: RecordPage['nextCursor'] = null
    do {
      const page: RecordPage = await f.call('A', 'listRecords', { month: '2026-09', ...(cursor ? { cursor } : {}) })
      seen.push(...page.records.map(r => r.id)); cursor = page.nextCursor
    } while (cursor)
    expect(seen).toHaveLength(53); expect(new Set(seen).size).toBe(53)
    expect((await f.call<RecordPage>('A', 'listRecords', { month: '2026-08' })).records).toEqual([])
    await expect(f.call('A', 'listRecords', { limit: 10000 })).rejects.toMatchObject({ code: 'INVALID' })
    await expect(f.call('A', 'listRecords', { cursor: { savedAt: -1, id: seen[0] } })).rejects.toMatchObject({ code: 'INVALID' })
  })
  it('MP-17 0元允许保存且快照完整', async () => {
    const f = fixture(), c = await f.config(), p = request(c)
    p.input.entries = []; p.expectedResult = calculate(p.input, c.config, time)
    const saved = await f.call<SavedRecord>('A', 'saveRecord', p)
    expect(saved.result.totalFeeCents).toBe(0); expect(saved.result.config.rates.flat()).toHaveLength(24)
  })
  it('事务写入失败整体回滚，读取失败不会初始化默认配置', async () => {
    const f = fixture()
    f.repo.transaction = async work => { await work({ get: async () => { throw new Error('offline') }, put: async () => { throw new Error('unexpected') }, remove: async () => {} }); throw new Error('unreachable') }
    await expect(f.config()).rejects.toThrow('offline')
    expect(f.repo.count('user_configs')).toBe(0)
    const g = fixture()
    await expect(g.repo.transaction(async tx => { await tx.put('user_configs', 'A', { foo: 1 }); throw new Error('interrupted') })).rejects.toThrow()
    expect(g.repo.count('user_configs')).toBe(0)
  })
  it('校验请求大小、月份、精度、未知字段、旧规则与当前会话身份', async () => {
    const f = fixture(), c = await f.config()
    for (const change of [
      { input: { month: '2026-13', entries: [] } },
      { input: { month: '2026-09', entries: [{ gradeId: 12, classSize: 1, hoursHundredths: 100 }] } },
      { input: { month: '2026-09', entries: [{ gradeId: 0, classSize: 1, hoursHundredths: .1 }] } },
      { input: { month: '2026-09', entries: Array(37).fill(input.entries[0]) } },
      { calculatedAt: 'invalid' }, { rules: {} },
    ]) await expect(f.call('A', 'saveRecord', { ...request(c), ...change })).rejects.toMatchObject({ code: 'INVALID' })
    await expect(f.call('A', 'saveRecord', { ...request(c), ruleVersion: 'future-v2' })).rejects.toMatchObject({ code: 'VERSION' })
    await expect(f.service.handle('A', { action: 'identity', payload: { x: 'x'.repeat(131073) } })).rejects.toMatchObject({ code: 'INVALID' })
    await expect(f.service.handle('B', { action: 'listRecords', sessionKey: 'A' })).rejects.toMatchObject({ code: 'IDENTITY' })
    await expect(f.service.handle('', { action: 'identity' })).rejects.toMatchObject({ code: 'IDENTITY' })
  })
  it('旧结构保留数据，展示层不会替换为当前表或重新计算', async () => {
    const f = fixture(), c = await f.config(), saved = await f.call<SavedRecord>('A', 'saveRecord', request(c))
    expect(isReadableRecord({ ...saved, schemaVersion: 2 })).toBe(false)
    expect(isReadableRecord({ ...saved, rules: { version: 'new' } })).toBe(false)
  })
})
