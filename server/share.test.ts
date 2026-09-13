import { expect, it } from 'vitest'
import { calculate, defaultConfig, RULE_VERSION } from '../packages/core/domain'
import { clone, isReadableShare } from '../packages/core/contracts'
import type { CloudConfig, SavedRecord, SharedCalculation, ShareLink } from '../packages/core/contracts'
import { LedgerService } from './service'
import { MemoryRepository } from './testing/memory-repository'

const time = '2026-09-12T08:00:00.000Z'
const input = { month: '2026-09', entries: [{ gradeId: 0, classSize: 1 as const, hoursHundredths: 2000 }] }
async function fixture() {
  const repo = new MemoryRepository(), service = new LedgerService(repo, () => Date.parse(time))
  const call = <T>(owner: string, action: string, payload: object = {}) => service.handle(owner, { action, payload }) as Promise<T>
  const config = await call<CloudConfig>('A', 'getConfig')
  const calculation = { versionId: config.versionId, ruleVersion: RULE_VERSION, input, calculatedAt: time, expectedResult: calculate(input, config.config, time) }
  const request = { requestId: 'share_request_000001', calculation }
  return { repo, call, config, calculation, request }
}
it('试算分享单独保存快照，跨用户只读，不泄露归属、记录或配置版本标识', async () => {
  const f = await fixture()
  const link = await f.call<ShareLink>('A', 'createShare', f.request)
  expect(link.token).toMatch(/^[a-f0-9]{64}$/)
  const shared = await f.call<SharedCalculation>('B', 'getShare', link)
  expect(isReadableShare(shared)).toBe(true)
  expect(shared.result.totalFeeCents).toBe(f.calculation.expectedResult.totalFeeCents)
  expect(shared.result.config.configRevision).toBe('shared-snapshot')
  expect(Object.keys(shared).sort()).toEqual(['result', 'ruleVersion', 'rules', 'schemaVersion', 'sharedAt'])
  expect(JSON.stringify(shared)).not.toContain(f.config.versionId)
  expect(f.repo.count('calculation_records')).toBe(0)
  expect(f.repo.count('user_configs')).toBe(1)
  expect(await f.call('B', 'listRecords')).toMatchObject({ records: [] })
  for (const action of ['getRecord', 'deleteRecord']) await expect(f.call('B', action, { id: link.token })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(f.call('B', 'revokeShare', link)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  const rates = clone(f.config.config.rates); rates[0][0] = 9999
  await f.call('A', 'saveConfig', { requestId: 'share_config_update01', expectedRevision: 1, rates })
  expect(await f.call('B', 'getShare', link)).toEqual(shared)
})
it('并发创建和超时重试返回同一链接；停止分享后旧链接和迟到重试不复活', async () => {
  const f = await fixture()
  const links = await Promise.all(Array.from({ length: 8 }, () => f.call<ShareLink>('A', 'createShare', f.request)))
  expect(new Set(links.map(link => link.token)).size).toBe(1)
  expect(f.repo.count('shared_calculations')).toBe(1)
  await f.call('A', 'revokeShare', links[0])
  for (const owner of ['A', 'B']) await expect(f.call(owner, 'getShare', links[0])).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(f.call('A', 'createShare', f.request)).rejects.toMatchObject({ code: 'DELETED' })
  const next = await f.call<ShareLink>('A', 'createShare', { ...f.request, requestId: 'share_request_000002' })
  expect(next.token).not.toBe(links[0].token)
  expect(isReadableShare(await f.call('B', 'getShare', next))).toBe(true)
})
it('历史分享仅允许记录本人创建；保留旧明细，原记录删除后链接失效', async () => {
  const f = await fixture()
  const saved = await f.call<SavedRecord>('A', 'saveRecord', { ...f.calculation, requestId: 'saved_request_000001' })
  const request = { requestId: 'saved_share_00000001', recordId: saved.id }
  await expect(f.call('B', 'createShare', request)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  const link = await f.call<ShareLink>('A', 'createShare', request)
  expect(await f.call('B', 'getShare', link)).toMatchObject({ savedAt: saved.savedAt, result: { totalFeeCents: saved.result.totalFeeCents } })
  await f.call('A', 'deleteRecord', { id: saved.id })
  await expect(f.call('B', 'getShare', link)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(f.call('A', 'createShare', request)).rejects.toMatchObject({ code: 'NOT_FOUND' })
})
it('分享服务拒绝伪造快照、他人版本、额外字段和无效链接；默认价零课时可分享', async () => {
  const f = await fixture(), forged = clone(f.request)
  forged.calculation.expectedResult.totalFeeCents++
  await expect(f.call('A', 'createShare', forged)).rejects.toMatchObject({ code: 'MISMATCH' })
  await expect(f.call('B', 'createShare', f.request)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  for (const payload of [
    { ...f.request, ownerId: 'B' }, { ...f.request, recordId: 'invalid_record_0001' },
    { requestId: f.request.requestId },
    { ...f.request, calculation: { ...f.calculation, input: { ...input, entries: Array(37).fill(input.entries[0]) } } },
    { ...f.request, calculation: { ...f.calculation, calculatedAt: 'bad' } },
    { ...f.request, calculation: { ...f.calculation, extra: true } },
  ]) await expect(f.call('A', 'createShare', payload)).rejects.toMatchObject({ code: 'INVALID' })
  for (const token of ['../secret', 'a'.repeat(64), '', null]) await expect(f.call('B', 'getShare', { token })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  const empty = calculate({ month: '2026-09', entries: [] }, defaultConfig(), time)
  const link = await f.call<ShareLink>('A', 'createShare', { requestId: 'share_default_000001', calculation: { versionId: null, ruleVersion: RULE_VERSION, input: empty.input, calculatedAt: time, expectedResult: empty } })
  expect(await f.call('B', 'getShare', link)).toMatchObject({ result: { totalFeeCents: 0 } })
  expect(f.repo.count('calculation_records')).toBe(0)
})
