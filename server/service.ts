import { createHash } from 'node:crypto'
import { calculate, defaultConfig, isConfig, RULE_VERSION, validMonth } from '../packages/core/domain'
import { canonical, LedgerError, rulesSnapshot } from '../packages/core/contracts'
import type { CloudConfig, Cursor, SavedRecord, SaveConfigRequest, SaveRecordRequest } from '../packages/core/contracts'
import type { Documents, Repository } from './repository'

interface Owned { ownerId: string }
interface Pointer extends Owned { revision: number; versionId: string; createdAt: number; updatedAt: number }
interface Version extends Owned, CloudConfig {}
interface Receipt extends Owned { fingerprint: string; kind: 'config' | 'record'; targetId: string; deleted?: boolean; config?: CloudConfig }
type RecordDoc = SavedRecord & Owned & { month: string; totalFeeCents: number; totalHoursHundredths: number; totalLessons: string; configUpdatedAt: string }
const fail = (code: string, message: string): never => { throw new LedgerError(code, message) }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const scopedId = (owner: string, kind: string, key: string) => hash(canonical([owner, kind, key]))
const inaccessible = () => fail('NOT_FOUND', '记录不存在或不可访问')
function object(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) fail('INVALID', '请求参数无效，请更新小程序后重试')
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(value)) fail('INVALID', '请求标识无效')
}
function own<T extends Owned>(value: T | null, owner: string): T {
  if (!value || value.ownerId !== owner) return inaccessible()
  return value
}
function publicRecord(r: RecordDoc): SavedRecord {
  return { id: r.id, schemaVersion: r.schemaVersion, requestId: r.requestId, versionId: r.versionId,
    ruleVersion: r.ruleVersion, result: r.result, rules: r.rules, savedAt: r.savedAt,
    ...(r.sourceRecordId ? { sourceRecordId: r.sourceRecordId } : {}) }
}
function publicConfig(v: Version): CloudConfig {
  return { revision: v.revision, versionId: v.versionId, config: v.config, rules: v.rules }
}

export class LedgerService {
  constructor(private repo: Repository, private now: () => number = Date.now) {}

  // owner comes exclusively from the trusted cloud invocation context.
  async handle(owner: string, event: unknown): Promise<unknown> {
    if (!owner) fail('IDENTITY', '暂时无法读取个人数据，可使用默认价格试算')
    if (Buffer.byteLength(JSON.stringify(event) || '', 'utf8') > 131072) fail('INVALID', '提交内容过大')
    object(event, ['action', 'payload', 'sessionKey'])
    if (event.sessionKey !== undefined && event.sessionKey !== owner) fail('IDENTITY', '账号已变化，请重新同步个人数据')
    const p = event.payload ?? {}
    switch (event.action) {
      case 'identity': object(p, []); return { userKey: owner }
      case 'getConfig': object(p, []); return this.getConfig(owner)
      case 'saveConfig': return this.saveConfig(owner, p)
      case 'saveRecord': return this.saveRecord(owner, p)
      case 'saveStatus': {
        object(p, ['requestId']); id(p.requestId)
        return this.repo.transaction(async tx => {
          const receipt = await tx.get<Receipt>('operation_receipts', scopedId(owner, 'record', p.requestId as string))
          if (!receipt) return { status: 'absent' }
          own(receipt, owner)
          if (receipt.deleted) return { status: 'deleted' }
          const record = own(await tx.get<RecordDoc>('calculation_records', receipt.targetId), owner)
          return { status: 'saved', record: publicRecord(record) }
        })
      }
      case 'configStatus': {
        object(p, ['requestId']); id(p.requestId)
        const receipt = await this.repo.get<Receipt>('operation_receipts', scopedId(owner, 'config', p.requestId))
        if (!receipt) return { status: 'absent' }
        return { status: 'saved', config: own(receipt, owner).config }
      }
      case 'getRecord': {
        object(p, ['id']); id(p.id)
        return publicRecord(own(await this.repo.get<RecordDoc>('calculation_records', p.id), owner))
      }
      case 'listRecords': {
        object(p, ['month', 'cursor', 'limit'])
        if (p.month !== undefined && (typeof p.month !== 'string' || !validMonth(p.month))) fail('INVALID', '请选择有效月份')
        const limit = p.limit ?? 20
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20) fail('INVALID', '每页最多20条')
        if (p.cursor !== undefined) {
          object(p.cursor, ['savedAt', 'id']); id(p.cursor.id)
          if (!Number.isSafeInteger(p.cursor.savedAt) || (p.cursor.savedAt as number) < 0) fail('INVALID', '分页参数无效')
          // Cursor may remain usable after a deletion, but never supplies ownership.
        }
        const rows = await this.repo.list(owner, p.month as string | undefined, p.cursor as Cursor | undefined, (limit as number) + 1)
        const records = rows.slice(0, limit as number)
        const last = records[records.length - 1]
        return { records, nextCursor: rows.length > (limit as number) ? { savedAt: last.savedAt, id: last.id } : null }
      }
      case 'deleteRecord': {
        object(p, ['id']); id(p.id)
        return this.repo.transaction(async tx => {
          const r = own(await tx.get<RecordDoc>('calculation_records', p.id as string), owner)
          const receiptId = scopedId(owner, 'record', r.requestId)
          const receipt = own(await tx.get<Receipt>('operation_receipts', receiptId), owner)
          await tx.remove('calculation_records', r.id)
          // Keep only an opaque receipt: retries cannot resurrect deleted input/snapshots.
          await tx.put('operation_receipts', receiptId, { ...receipt, deleted: true })
          return { deleted: true }
        })
      }
      default: return fail('INVALID', '不支持的操作，请更新小程序')
    }
  }

  private async readConfig(tx: Documents, owner: string, pointer: Pointer): Promise<CloudConfig> {
    own(pointer, owner)
    return publicConfig(own(await tx.get<Version>('config_versions', pointer.versionId), owner))
  }
  private getConfig(owner: string): Promise<CloudConfig> {
    return this.repo.transaction(async tx => {
      const pointer = await tx.get<Pointer>('user_configs', owner)
      if (pointer) return this.readConfig(tx, owner, pointer)
      const now = this.now()
      const versionId = scopedId(owner, 'version', 'initial')
      const config = { ...defaultConfig(), configRevision: versionId, updatedAt: new Date(now).toISOString() }
      const version: Version = { ownerId: owner, revision: 1, versionId, config, rules: rulesSnapshot() }
      await tx.put('config_versions', versionId, version)
      await tx.put('user_configs', owner, { ownerId: owner, revision: 1, versionId, createdAt: now, updatedAt: now })
      return publicConfig(version)
    })
  }
  private saveConfig(owner: string, payload: unknown): Promise<CloudConfig> {
    object(payload, ['requestId', 'expectedRevision', 'rates'])
    id(payload.requestId)
    const p = payload as unknown as SaveConfigRequest
    if (!Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 1 || !isConfig({ ...defaultConfig(), rates: p.rates })) fail('INVALID', '请完整填写24个有效单价')
    const key = scopedId(owner, 'config', p.requestId)
    const fingerprint = hash(canonical(p))
    return this.repo.transaction(async tx => {
      const receipt = await tx.get<Receipt>('operation_receipts', key)
      if (receipt) {
        own(receipt, owner)
        if (receipt.fingerprint !== fingerprint) fail('REQUEST_REUSED', '同一请求不能提交不同内容')
        return receipt.config!
      }
      const pointer = own(await tx.get<Pointer>('user_configs', owner), owner)
      if (pointer.revision !== p.expectedRevision) fail('CONFLICT', '计费表已在其他设备更新')
      let config = await this.readConfig(tx, owner, pointer)
      if (canonical(config.config.rates) !== canonical(p.rates)) {
        const now = this.now()
        const versionId = scopedId(owner, 'version', p.requestId)
        config = { revision: pointer.revision + 1, versionId, config: { ...config.config, rates: p.rates, configRevision: versionId, updatedAt: new Date(now).toISOString() }, rules: rulesSnapshot() }
        await tx.put('config_versions', versionId, { ...config, ownerId: owner })
        await tx.put('user_configs', owner, { ...pointer, revision: config.revision, versionId, updatedAt: now })
      }
      await tx.put('operation_receipts', key, { ownerId: owner, fingerprint, kind: 'config', targetId: config.versionId, config })
      return config
    })
  }
  private saveRecord(owner: string, payload: unknown): Promise<SavedRecord> {
    object(payload, ['requestId', 'versionId', 'ruleVersion', 'input', 'calculatedAt', 'expectedResult', 'sourceRecordId'])
    id(payload.requestId); id(payload.versionId)
    if (payload.sourceRecordId !== undefined) id(payload.sourceRecordId)
    const p = payload as unknown as SaveRecordRequest
    object(p.input, ['month', 'entries'])
    if (!Array.isArray(p.input.entries) || p.input.entries.length > 36) fail('INVALID', '课时组合最多36项')
    p.input.entries.forEach(e => object(e, ['gradeId', 'classSize', 'hoursHundredths']))
    if (typeof p.calculatedAt !== 'string' || p.calculatedAt.length > 32 || !Number.isFinite(Date.parse(p.calculatedAt))) fail('INVALID', '计算时间无效')
    if (p.ruleVersion !== RULE_VERSION) fail('VERSION', '计算规则已更新，请更新小程序并重新计算')
    const key = scopedId(owner, 'record', p.requestId)
    const fingerprint = hash(canonical(p))
    return this.repo.transaction(async tx => {
      const receipt = await tx.get<Receipt>('operation_receipts', key)
      if (receipt) {
        own(receipt, owner)
        if (receipt.fingerprint !== fingerprint) fail('REQUEST_REUSED', '同一请求不能提交不同内容')
        if (receipt.deleted) fail('DELETED', '这次保存的记录已删除，请重新计算后保存')
        return publicRecord(own(await tx.get<RecordDoc>('calculation_records', receipt.targetId), owner))
      }
      const version = own(await tx.get<Version>('config_versions', p.versionId), owner)
      if (p.sourceRecordId) own(await tx.get<RecordDoc>('calculation_records', p.sourceRecordId), owner)
      let result
      try { result = calculate(p.input, version.config, p.calculatedAt) }
      catch (error) { return fail('INVALID', error instanceof Error ? error.message : '课时输入无效') }
      if (canonical(result) !== canonical(p.expectedResult)) fail('MISMATCH', '计算结果不一致，请更新小程序或重新计算后核对')
      const r: RecordDoc = { id: key, ownerId: owner, schemaVersion: 1, requestId: p.requestId, versionId: p.versionId,
        ruleVersion: RULE_VERSION, result, rules: version.rules, savedAt: this.now(), month: result.input.month,
        totalFeeCents: result.totalFeeCents, totalHoursHundredths: result.totalHoursHundredths, totalLessons: result.totalLessons,
        configUpdatedAt: result.config.updatedAt, ...(p.sourceRecordId ? { sourceRecordId: p.sourceRecordId } : {}) }
      await tx.put('calculation_records', key, r)
      await tx.put('operation_receipts', key, { ownerId: owner, fingerprint, kind: 'record', targetId: key })
      return publicRecord(r)
    })
  }
}
