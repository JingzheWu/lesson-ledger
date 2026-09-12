import { CLASS_NAMES, GRADES, GROUPS, MULTIPLIERS, RULE_VERSION, TIERS, isConfig } from './domain'
import type { Config, Input, Result } from './domain'

export interface Rules {
  version: string
  hoursPerLesson: number
  hourUnit: string
  moneyUnit: string
  grades: { id: number; name: string; groupId: number }[]
  groups: { id: number; name: string }[]
  classes: { id: number; name: string; numerator: number; denominator: number }[]
  tiers: { id: number; name: string; fromHundredths: number; toHundredths: number | null }[]
  sorting: string
  rounding: string
}
export function rulesSnapshot(): Rules {
  return {
    version: RULE_VERSION, hoursPerLesson: 2, hourUnit: '0.01小时', moneyUnit: '分（人民币）',
    grades: GRADES.map((name, id) => ({ id, name, groupId: GROUPS.findIndex(g => (g.grades as readonly number[]).includes(id)) })),
    groups: GROUPS.map((g, id) => ({ id, name: g.name })),
    classes: ([1, 2, 3] as const).map(id => ({ id, name: CLASS_NAMES[id], numerator: MULTIPLIERS[id], denominator: 10 })),
    tiers: TIERS.map((name, id) => ({ id, name, fromHundredths: id * 3000, toHundredths: id === 5 ? null : (id + 1) * 3000 })),
    sorting: '实际年级从低到高；同年级一对一 → 一对二 → 一对三；全月共享阶梯',
    rounding: '相同年级、班型先合并；逐条最终阶梯明细四舍五入到分，再相加；中间单价不舍入',
  }
}
export interface CloudConfig { revision: number; versionId: string; config: Config; rules: Rules }
export interface CalculationInstance {
  requestId: string
  versionId: string | null
  ruleVersion: string
  result: Result
  sourceRecordId?: string
}
export interface SaveRecordRequest {
  requestId: string; versionId: string; ruleVersion: string; input: Input
  calculatedAt: string; expectedResult: Result; sourceRecordId?: string
}
export interface SaveConfigRequest { requestId: string; expectedRevision: number; rates: number[][] }
export interface SavedRecord {
  id: string; schemaVersion: 1; requestId: string; versionId: string; ruleVersion: string
  result: Result; rules: Rules; savedAt: number; sourceRecordId?: string
}
export interface RecordSummary {
  id: string; schemaVersion: number; month: string; totalFeeCents: number
  totalHoursHundredths: number; totalLessons: string; savedAt: number; configUpdatedAt: string
}
export interface Cursor { savedAt: number; id: string }
export interface RecordPage { records: RecordSummary[]; nextCursor: Cursor | null }
export type SaveStatus = { status: 'absent' | 'deleted' } | { status: 'saved'; record: SavedRecord }
export class LedgerError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'LedgerError' }
}
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
// Stable serialization is shared by request fingerprints and result verification.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(value)
}
export function isCloudConfig(value: unknown): value is CloudConfig {
  const c = value as CloudConfig | null
  return !!c && Number.isSafeInteger(c.revision) && c.revision > 0 && typeof c.versionId === 'string' &&
    isConfig(c.config) && canonical(c.rules) === canonical(rulesSnapshot())
}
// Read historical amounts as stored. Unknown schemas never fall back to today's rules.
export function isReadableRecord(value: unknown): value is SavedRecord {
  const r = value as SavedRecord | null
  if (!r || r.schemaVersion !== 1 || !r.result || !isConfig(r.result.config) ||
    r.ruleVersion !== RULE_VERSION || !r.rules || canonical(r.rules) !== canonical(rulesSnapshot())) return false
  const result = r.result
  const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0
  return typeof r.id === 'string' && nonnegative(r.savedAt) && nonnegative(result.totalFeeCents) &&
    nonnegative(result.totalHoursHundredths) && Array.isArray(result.input?.entries) &&
    Array.isArray(result.tiers) && result.tiers.length === 6 && result.tiers.every(t =>
      nonnegative(t.feeCents) && nonnegative(t.hoursHundredths) && Array.isArray(t.details) &&
      t.details.every(d => nonnegative(d.feeCents) && nonnegative(d.hoursHundredths) && nonnegative(d.rateCents)))
}
