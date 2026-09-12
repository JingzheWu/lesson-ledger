import { calculate, defaultConfig, hours, lessons, parsePrice, parseQuantity, RULE_VERSION, validMonth } from '../core/domain'
import type { ClassSize, Quantity } from '../core/domain'
import { clone, isCloudConfig, LedgerError } from '../core/contracts'
import type { CalculationInstance, CloudConfig, SavedRecord, SaveConfigRequest, SaveRecordRequest, SaveStatus } from '../core/contracts'

export interface Platform {
  env: string
  call<T>(action: string, payload?: object): Promise<T>
  readCache(key: string): unknown
  writeCache(key: string, value: CloudConfig): void
  requestId(): string
  now(): string
}
export interface Row {
  key: string; gradeId: number; classSize: ClassSize; hoursText: string; lessonsText: string; error: string
}
export type ResultState = 'none' | 'unsaved' | 'stale' | 'saving' | 'saved' | 'unknown' | 'failed'
export interface ConfigDraft {
  base: CloudConfig; texts: string[][]; conflict: boolean; pending: SaveConfigRequest | null
  busy: boolean; unknown: boolean; message: string
  comparison?: string[][]
}
export class Session {
  userKey: string | null = null
  identityReady = false
  identifying = false
  epoch = 0
  month: string
  rows: Row[] = []
  active: CloudConfig | null = null
  latest: CloudConfig | null = null
  pendingConfig: CloudConfig | null = null
  instance: CalculationInstance | null = null
  saved: SavedRecord | null = null
  resultState: ResultState = 'none'
  draft: ConfigDraft | null = null
  notice = '正在读取个人计费表'
  sourceRecordId: string | undefined
  private listeners = new Set<() => void>()
  private syncSequence = 0
  private inputRevision = 0
  private identifyPromise: Promise<void> | null = null
  private initialMonth: string
  constructor(public platform: Platform, month: string) { this.month = this.initialMonth = month }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  emit(): void { this.listeners.forEach(fn => fn()) }
  get busy(): boolean { return this.identifying || this.resultState === 'saving' || !!this.draft?.busy }
  get hasWork(): boolean { return this.rows.length > 0 || !!this.instance }
  get config() { return this.identityReady && this.active ? this.active.config : defaultConfig() }
  private cacheKey(): string { return `lesson-ledger:config:v1:${this.platform.env}:${this.userKey}` }
  private remember(config: CloudConfig): void {
    try { this.platform.writeCache(this.cacheKey(), clone(config)) } catch { this.notice = '已同步；本机缓存不可用，离线时可能需使用默认价格' }
  }
  private clearPrivate(): void {
    ++this.inputRevision
    this.month = this.initialMonth
    this.rows = []; this.instance = null; this.saved = null; this.resultState = 'none'
    this.active = null; this.latest = null; this.pendingConfig = null; this.draft = null; this.sourceRecordId = undefined
  }
  identify(): Promise<void> {
    if (this.identifyPromise) return this.identifyPromise
    this.identifyPromise = this.identifyNow().finally(() => { this.identifyPromise = null })
    return this.identifyPromise
  }
  private async identifyNow(): Promise<void> {
    const previous = this.userKey
    const epoch = ++this.epoch
    if (this.resultState === 'saving') this.resultState = 'unknown'
    if (this.draft?.busy) { this.draft.busy = false; this.draft.unknown = true; this.draft.message = '保存状态未确认，请查询状态或重试原请求' }
    this.identityReady = false; this.identifying = true; this.notice = '正在确认身份'; this.emit()
    try {
      const identity = await this.platform.call<{ userKey: string }>('identity')
      if (epoch !== this.epoch) return
      if (!identity.userKey || typeof identity.userKey !== 'string') throw new LedgerError('IDENTITY', '身份确认失败')
      if (previous && previous !== identity.userKey) this.clearPrivate()
      this.userKey = identity.userKey; this.identityReady = true
      // Only a trusted, newly confirmed identity unlocks its cache namespace.
      if (!this.active) {
        try {
          const cache = this.platform.readCache(this.cacheKey())
          if (isCloudConfig(cache)) {
            this.active = this.latest = clone(cache)
            if (this.instance && !this.instance.versionId) this.resultState = 'stale'
          }
        } catch { /* A cache failure is not evidence of missing cloud configuration. */ }
      }
      this.emit()
      await this.refreshConfig()
    } catch {
      if (epoch !== this.epoch) return
      if (previous) this.clearPrivate()
      this.userKey = null; this.identityReady = false
      this.notice = '暂时无法读取个人数据，当前使用默认价格试算；云功能不可用'
    } finally {
      if (epoch === this.epoch) { this.identifying = false; this.emit() }
    }
  }
  async refreshConfig(): Promise<void> {
    if (!this.identityReady) return
    const epoch = this.epoch, sequence = ++this.syncSequence
    try {
      const config = await this.call<CloudConfig>('getConfig')
      if (epoch !== this.epoch || sequence !== this.syncSequence) return
      if (!isCloudConfig(config)) throw new Error('配置版本不兼容，请更新小程序')
      this.latest = clone(config)
      this.notice = '已同步'
      this.remember(config)
      if (!this.active || this.active.versionId !== config.versionId) {
        if (this.hasWork && this.active) {
          this.pendingConfig = clone(config)
          this.notice = '发现新的计费表，可应用新价格或继续使用本次旧表'
        } else {
          this.active = clone(config)
          if (this.instance) this.resultState = 'stale'
          if (this.hasWork) this.notice = '已加载个人计费表，请重新计算后保存'
        }
      } else this.pendingConfig = null
    } catch (e) {
      if (epoch !== this.epoch || sequence !== this.syncSequence) return
      this.notice = this.active ? '暂时无法同步，使用本人最近已同步的计费表；可重试' : '暂时无法同步，当前使用默认价格试算；请联网重试'
      if (e instanceof LedgerError && e.code === 'IDENTITY') this.expireIdentity()
    }
    this.emit()
  }
  private expireIdentity(): void {
    ++this.epoch; this.clearPrivate(); this.identityReady = false; this.userKey = null
    this.notice = '暂时无法确认身份，当前使用默认价格试算'; this.emit()
  }
  async call<T>(action: string, payload?: object): Promise<T> {
    if (!this.identityReady) throw new LedgerError('IDENTITY', '暂时无法读取个人数据，请重试同步')
    const epoch = this.epoch
    try {
      const result = await this.platform.call<T>(action, payload)
      if (epoch !== this.epoch || !this.identityReady) throw new LedgerError('SUPERSEDED', '页面已更新，请重试')
      return result
    } catch (e) {
      if (epoch === this.epoch && e instanceof LedgerError && e.code === 'IDENTITY') this.expireIdentity()
      throw e
    }
  }
  applyPending(): void {
    this.mutable()
    if (!this.pendingConfig) return
    this.active = this.pendingConfig; this.pendingConfig = null; this.changed()
    this.notice = '已应用新计费表，请重新计算'; this.emit()
  }
  keepCurrent(): void { this.pendingConfig = null; this.notice = '继续使用本次已同步的旧计费表'; this.emit() }
  private mutable(): void { if (this.busy) throw new LedgerError('BUSY', '正在处理，请稍候') }
  private changed(): void { ++this.inputRevision; if (this.instance) this.resultState = 'stale'; this.emit() }
  setMonth(month: string): void {
    this.mutable(); if (!validMonth(month)) throw new Error('请选择有效月份')
    if (this.month === month) return
    this.month = month; if (this.rows.length) this.notice = '月份已切换，请核对课时'
    this.changed()
  }
  addRow(gradeId: number, classSize: ClassSize): string {
    this.mutable()
    if (!Number.isInteger(gradeId) || gradeId < 0 || gradeId > 11 || ![1, 2, 3].includes(classSize)) throw new Error('请选择年级和班型')
    const key = `${gradeId}-${classSize}`
    if (!this.rows.some(r => r.key === key)) { this.rows.push({ key, gradeId, classSize, hoursText: '', lessonsText: '', error: '' }); this.changed() }
    return key
  }
  updateRow(key: string, unit: Quantity, text: string, finalize = false): void {
    this.mutable(); const row = this.rows.find(r => r.key === key)
    if (!row) return
    if (row[unit === 'hours' ? 'hoursText' : 'lessonsText'] === text && !row.error) return
    row[unit === 'hours' ? 'hoursText' : 'lessonsText'] = text
    const pending = text === '.' || /\.$/.test(text)
    const parsed = parseQuantity(text, unit)
    row.error = parsed.error ?? ''
    if (pending && !finalize) row.error = '请完成小数输入'
    else if (parsed.error === undefined) {
      row.hoursText = unit === 'hours' ? text : hours(parsed.value)
      row.lessonsText = unit === 'lessons' ? text : lessons(parsed.value)
    }
    this.changed()
  }
  removeRow(key: string): void { this.mutable(); this.rows = this.rows.filter(r => r.key !== key); this.changed() }
  clear(): void {
    this.mutable(); ++this.inputRevision; this.rows = []; this.instance = null; this.saved = null; this.resultState = 'none'; this.sourceRecordId = undefined; this.emit()
  }
  calculate(): void {
    this.mutable()
    const entries = this.rows.map(row => {
      if (row.error) throw new Error(`${row.error}，请核对课时卡片`)
      const parsed = parseQuantity(row.hoursText, 'hours')
      if (parsed.error !== undefined) throw new Error(parsed.error)
      return { gradeId: row.gradeId, classSize: row.classSize, hoursHundredths: parsed.value }
    })
    const result = calculate({ month: this.month, entries }, this.config, this.platform.now())
    ++this.inputRevision
    this.instance = { requestId: this.platform.requestId(), versionId: this.identityReady ? this.active?.versionId ?? null : null,
      ruleVersion: RULE_VERSION, result, ...(this.sourceRecordId ? { sourceRecordId: this.sourceRecordId } : {}) }
    this.saved = null; this.resultState = 'unsaved'; this.emit()
  }
  async save(): Promise<SavedRecord | null> {
    if (this.resultState === 'saved') return this.saved
    const instance = this.instance
    if (!instance || !instance.versionId || !this.identityReady || !['unsaved', 'unknown', 'failed'].includes(this.resultState)) throw new Error('请使用个人已同步计费表重新计算后保存')
    const epoch = this.epoch
    const payload: SaveRecordRequest = { requestId: instance.requestId, versionId: instance.versionId, ruleVersion: instance.ruleVersion,
      input: instance.result.input, calculatedAt: instance.result.calculatedAt, expectedResult: instance.result,
      ...(instance.sourceRecordId ? { sourceRecordId: instance.sourceRecordId } : {}) }
    this.resultState = 'saving'; this.emit()
    try {
      const record = await this.call<SavedRecord>('saveRecord', clone(payload))
      if (epoch === this.epoch && this.instance === instance) { this.saved = record; this.resultState = 'saved'; this.emit() }
      return record
    } catch (e) {
      if (epoch === this.epoch && this.instance === instance) {
        this.resultState = e instanceof LedgerError && e.code !== 'UNAVAILABLE' ? 'failed' : 'unknown'
        if (e instanceof LedgerError && ['MISMATCH', 'VERSION', 'DELETED'].includes(e.code)) this.resultState = 'stale'
        this.notice = this.resultState === 'unknown' ? '保存状态未确认，请查询状态或用同一请求重试' : (e as Error).message
        this.emit()
      }
      throw e
    }
  }
  async confirmSave(): Promise<void> {
    if (!this.instance || this.busy) return
    const instance = this.instance
    const status = await this.call<SaveStatus>('saveStatus', { requestId: instance.requestId })
    if (this.instance !== instance) return
    if (status.status === 'saved') {
      this.saved = status.record
      if (this.resultState !== 'stale') this.resultState = 'saved'
      this.notice = '已确认保存成功'
    } else if (status.status === 'deleted') { this.resultState = 'stale'; this.notice = '记录已删除，请重新计算' }
    else this.notice = '暂未查到成功记录，可使用原请求重试；此前请求仍可能完成'
    this.emit()
  }
  async reuse(record: SavedRecord): Promise<void> {
    this.mutable()
    const revision = this.inputRevision
    // Explicit reuse requires an online read of the CURRENT personal configuration.
    const config = await this.call<CloudConfig>('getConfig')
    if (!isCloudConfig(config)) throw new Error('计费表不兼容，请更新小程序')
    if (revision !== this.inputRevision) throw new LedgerError('SUPERSEDED', '课时或计费表已变化，请重新确认是否替换')
    ++this.syncSequence
    this.mutable(); this.clear(); this.active = this.latest = clone(config); this.pendingConfig = null; this.remember(config)
    this.month = record.result.input.month; this.sourceRecordId = record.id
    this.rows = record.result.input.entries.map(e => ({ key: `${e.gradeId}-${e.classSize}`, gradeId: e.gradeId, classSize: e.classSize,
      hoursText: hours(e.hoursHundredths), lessonsText: lessons(e.hoursHundredths), error: '' }))
    this.notice = '已复制课时，使用当前计费表，请重新计算'; this.emit()
  }
  beginEdit(): void {
    if (!this.identityReady || !this.latest) throw new Error('请先同步个人计费表')
    if (!this.draft) this.draft = { base: clone(this.latest), texts: this.latest.config.rates.map(row => row.map(n => (n / 100).toFixed(2))), conflict: false, pending: null, busy: false, unknown: false, message: '' }
    this.emit()
  }
  editPrice(tier: number, group: number, value: string): void {
    if (!this.identityReady || this.identifying || !this.draft || this.draft.busy || this.draft.unknown || this.draft.conflict) return
    this.draft.texts[tier][group] = value; this.draft.pending = null; this.emit()
  }
  resetDraft(): void {
    if (!this.draft || this.draft.busy || this.draft.unknown || this.draft.conflict) return
    this.draft.texts = defaultConfig().rates.map(row => row.map(n => (n / 100).toFixed(2))); this.draft.pending = null; this.emit()
  }
  cancelEdit(): void {
    if (this.draft?.busy || this.draft?.unknown) throw new Error('请先确认本次配置保存状态')
    this.draft = null; this.emit()
  }
  async loadLatestDraft(): Promise<void> {
    const draft = this.draft
    const config = await this.call<CloudConfig>('getConfig')
    if (this.draft !== draft) return
    if (!isCloudConfig(config)) throw new Error('计费表不兼容，请更新小程序')
    ++this.syncSequence
    const comparison = draft ? clone(draft.texts) : undefined
    this.latest = config; this.draft = null; this.beginEdit()
    const refreshed = this.draft as ConfigDraft | null
    if (refreshed && comparison) {
      refreshed.comparison = comparison
      refreshed.message = '已加载最新配置，保留原草稿供对照；请重新编辑并保存'
    }
    this.emit()
  }
  async saveConfig(): Promise<void> {
    const draft = this.draft
    if (!draft || this.busy || draft.conflict) return
    if (!draft.pending) {
      const rates = draft.texts.map(row => row.map(text => { const n = parsePrice(text); if (n.error !== undefined) throw new Error(n.error); return n.value }))
      draft.pending = { requestId: this.platform.requestId(), expectedRevision: draft.base.revision, rates }
    }
    const epoch = this.epoch
    draft.busy = true; draft.message = '正在保存计费配置'; this.emit()
    try {
      const config = await this.call<CloudConfig>('saveConfig', clone(draft.pending))
      if (this.draft !== draft || epoch !== this.epoch) return
      this.finishConfig(config)
    } catch (e) {
      if (this.draft !== draft || epoch !== this.epoch) return
      draft.unknown = !(e instanceof LedgerError) || e.code === 'UNAVAILABLE'
      draft.conflict = e instanceof LedgerError && e.code === 'CONFLICT'
      draft.message = draft.unknown ? '保存状态未确认，草稿已冻结；请查询状态或重试' : (e as Error).message
      throw e
    } finally { if (this.draft === draft && epoch === this.epoch) draft.busy = false; this.emit() }
  }
  private finishConfig(config: CloudConfig): void {
    if (!isCloudConfig(config)) throw new Error('配置版本不兼容，请更新小程序')
    ++this.syncSequence; ++this.inputRevision
    const changed = this.active?.versionId !== config.versionId
    this.active = this.latest = clone(config); this.pendingConfig = null; this.draft = null
    this.notice = '计费配置已同步'; this.remember(config)
    if (changed && this.instance) this.resultState = 'stale'
    this.emit()
  }
  async confirmConfig(): Promise<void> {
    const draft = this.draft
    if (!draft?.pending || draft.busy) return
    const response = await this.call<{ status: string; config?: CloudConfig }>('configStatus', { requestId: draft.pending.requestId })
    if (this.draft !== draft) return
    if (response.status === 'saved' && response.config) this.finishConfig(response.config)
    else { draft.message = '暂未查到成功提交，请重试原请求以确认结果'; this.emit() }
  }
}
