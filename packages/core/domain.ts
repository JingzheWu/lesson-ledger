import { multiply, roundedFee } from './integer'

export const GROUPS = [
  { name: '一至五年级', short: '小学低年级', grades: [0, 1, 2, 3, 4] },
  { name: '六年级、初一、初二', short: '小学高年级 · 初中', grades: [5, 6, 7] },
  { name: '初三、高一', short: '初高中衔接', grades: [8, 9] },
  { name: '高二、高三', short: '高中高年级', grades: [10, 11] },
] as const
export const GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'] as const
export const CLASSES = [1, 2, 3] as const
export type ClassSize = typeof CLASSES[number]
export const CLASS_NAMES = { 1: '一对一', 2: '一对二', 3: '一对三' } as const
export const MULTIPLIERS = { 1: 10, 2: 12, 3: 13 } as const
export const TIERS = ['0～30 小时', '30～60 小时', '60～90 小时', '90～120 小时', '120～150 小时', '150 小时以上']
export const RULE_VERSION = 'lower-grade-first-v1'
export const DEFAULT_RATES = [
  [1500, 2500, 4000, 4500],
  [6000, 8000, 9000, 10500],
  [6500, 8500, 11000, 12500],
  [7500, 9000, 12000, 13500],
  [8500, 10000, 13500, 15000],
  [9500, 11500, 14500, 17000],
]
export interface Config {
  schemaVersion: 1
  ruleVersion: typeof RULE_VERSION
  configRevision: string
  updatedAt: string
  rates: number[][]
}
export interface Entry { gradeId: number; classSize: ClassSize; hoursHundredths: number }
export interface Input { month: string; entries: Entry[] }
export interface Detail extends Entry {
  gradeGroupId: number
  tierId: number
  startHundredths: number
  endHundredths: number
  rateCents: number
  multiplier: number
  feeCents: number
}
export interface TierResult { tierId: number; hoursHundredths: number; feeCents: number; details: Detail[] }
export interface Result {
  calculatedAt: string
  input: Input
  config: Config
  totalHoursHundredths: number
  totalLessons: string
  totalFeeCents: number
  tiers: TierResult[]
}
export type Quantity = 'hours' | 'lessons'
export type Parsed = { value: number; error?: never } | { error: string; value?: never }

export function defaultConfig(): Config {
  return { schemaVersion: 1, ruleVersion: RULE_VERSION, configRevision: '默认价格 v1', updatedAt: '2026-09-10T00:00:00.000Z', rates: DEFAULT_RATES.map(row => [...row]) }
}

// Parse decimal text directly into integers; never round a user's invalid input.
function parseDecimal(text: string, decimals: number, blankIsZero: boolean): Parsed {
  const raw = text.trim()
  if (!raw) return blankIsZero ? { value: 0 } : { error: '请填写单价，0 元也有效' }
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return { error: '请输入非负数字' }
  const [whole = '', fraction = ''] = raw.split('.')
  if (fraction.length > decimals) return { error: `最多支持 ${decimals} 位小数` }
  const integer = Number((whole || '0') + fraction.padEnd(decimals, '0'))
  if (!Number.isSafeInteger(integer)) return { error: '数值过大，请检查输入' }
  return { value: integer }
}
export function parseQuantity(text: string, unit: Quantity): Parsed {
  const parsed = parseDecimal(text, unit === 'hours' ? 2 : 3, true)
  if (parsed.error !== undefined) return parsed
  if (unit === 'lessons') {
    if (parsed.value % 5 !== 0) return { error: '节数须为 0.005 的整数倍' }
    return { value: parsed.value / 5 }
  }
  return parsed
}
export function parsePrice(text: string): Parsed { return parseDecimal(text, 2, false) }
export function decimal(value: number, places: number): string {
  const raw = String(value).padStart(places + 1, '0')
  const tail = raw.slice(-places).replace(/0+$/, '')
  return raw.slice(0, -places) + (tail ? `.${tail}` : '')
}
export function hours(value: number): string { return decimal(value, 2) }
export function lessons(value: number): string {
  const raw = multiply(String(value), '5').padStart(4, '0')
  const tail = raw.slice(-3).replace(/0+$/, '')
  return raw.slice(0, -3) + (tail ? `.${tail}` : '')
}
export function money(cents: number): string {
  const raw = String(cents).padStart(3, '0')
  return `${raw.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${raw.slice(-2)}`
}
export function isConfig(value: unknown): value is Config {
  if (!value || typeof value !== 'object') return false
  const c = value as Config
  return c.schemaVersion === 1 && c.ruleVersion === RULE_VERSION &&
    typeof c.configRevision === 'string' && c.configRevision.trim().length > 0 &&
    typeof c.updatedAt === 'string' && Number.isFinite(Date.parse(c.updatedAt)) &&
    Array.isArray(c.rates) && c.rates.length === 6 &&
    c.rates.every(row => Array.isArray(row) && row.length === 4 && row.every(n => Number.isSafeInteger(n) && n >= 0))
}
export function validMonth(month: string): boolean { return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month) }
function safe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error('合计数值过大，无法精确计算，请检查输入或单价')
  return n
}
export function calculate(input: Input, config: Config, calculatedAt: string): Result {
  if (!validMonth(input.month)) throw new Error('请选择有效的结算月份')
  if (!isConfig(config)) throw new Error('计费配置无效，请检查价格设置')
  const merged = new Map<string, Entry>()
  for (const e of input.entries) {
    if (!Number.isInteger(e.gradeId) || e.gradeId < 0 || e.gradeId >= GRADES.length ||
      !CLASSES.includes(e.classSize) || !Number.isSafeInteger(e.hoursHundredths) || e.hoursHundredths < 0) {
      throw new Error('课时输入无效，请检查年级、班型及工时精度')
    }
    const key = `${e.gradeId}-${e.classSize}`
    const previous = merged.get(key)?.hoursHundredths ?? 0
    merged.set(key, { ...e, hoursHundredths: safe(previous + e.hoursHundredths) })
  }
  const entries = [...merged.values()].filter(e => e.hoursHundredths > 0).sort((a, b) => a.gradeId - b.gradeId || a.classSize - b.classSize)
  const totalHoursHundredths = entries.reduce((sum, e) => safe(sum + e.hoursHundredths), 0)
  const tiers: TierResult[] = TIERS.map((_, tierId) => ({ tierId, hoursHundredths: 0, feeCents: 0, details: [] }))
  let used = 0
  for (const entry of entries) {
    let remaining = entry.hoursHundredths
    const gradeGroupId = GROUPS.findIndex(g => (g.grades as readonly number[]).includes(entry.gradeId))
    while (remaining > 0) {
      const tierId = Math.min(Math.floor(used / 3000), 5)
      const allocated = Math.min(remaining, tierId === 5 ? remaining : (tierId + 1) * 3000 - used)
      const rateCents = config.rates[tierId][gradeGroupId]
      const multiplier = MULTIPLIERS[entry.classSize]
      // hundredths of hours × cents × multiplier/10. Round HALF_UP once per merged detail.
      const feeCents = roundedFee(allocated, rateCents, multiplier)
      const detail: Detail = { ...entry, hoursHundredths: allocated, gradeGroupId, tierId,
        startHundredths: used, endHundredths: used + allocated, rateCents, multiplier, feeCents }
      tiers[tierId].details.push(detail)
      tiers[tierId].hoursHundredths = safe(tiers[tierId].hoursHundredths + allocated)
      tiers[tierId].feeCents = safe(tiers[tierId].feeCents + feeCents)
      used += allocated
      remaining -= allocated
    }
  }
  return {
    calculatedAt, input: { month: input.month, entries: entries.map(e => ({ ...e })) },
    config: { ...config, rates: config.rates.map(row => [...row]) },
    totalHoursHundredths, totalLessons: lessons(totalHoursHundredths),
    totalFeeCents: tiers.reduce((sum, tier) => safe(sum + tier.feeCents), 0), tiers,
  }
}
