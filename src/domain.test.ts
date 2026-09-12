import { describe, expect, it } from 'vitest'
import { calculate, defaultConfig, hours, lessons, money, parsePrice, parseQuantity } from './domain'
import type { ClassSize, Entry } from './domain'

const time = '2026-09-10T10:00:00.000Z'
const entry = (gradeId: number, amount: number, classSize: ClassSize = 1): Entry => ({ gradeId, classSize, hoursHundredths: Math.round(amount * 100) })
const run = (entries: Entry[]) => calculate({ month: '2026-09', entries }, defaultConfig(), time)

describe('需求 A01–A15：阶梯分配与金额', () => {
  it('A01 空白月份有零总额、六个空阶梯与完整配置', () => {
    const result = run([])
    expect(result.totalFeeCents).toBe(0)
    expect(result.totalHoursHundredths).toBe(0)
    expect(result.totalLessons).toBe('0')
    expect(result.tiers).toHaveLength(6)
    expect(result.tiers.flatMap(t => t.details)).toHaveLength(0)
    expect(result.config.rates.flat()).toHaveLength(24)
  })
  it('A02 低年级优先，六年级跨阶梯', () => {
    const result = run([entry(0, 20), entry(5, 20)])
    expect(result.tiers.map(t => t.feeCents)).toEqual([55000, 80000, 0, 0, 0, 0])
    expect(result.totalFeeCents).toBe(135000)
    expect(result.tiers[0].details.map(d => [d.startHundredths, d.endHundredths])).toEqual([[0, 2000], [2000, 3000]])
  })
  it.each([
    ['A03', [entry(0, 30), entry(5, 30)], 285000],
    ['A04', [entry(0, 50)], 165000],
    ['A05', [entry(0, 10, 2)], 18000],
    ['A06', [entry(0, 10, 3)], 19500],
    ['A07', [entry(0, 20), entry(5, 20, 2), entry(8, 30, 3)], 533000],
    ['A08', [entry(0, 31)], 51000],
    ['A10', [entry(0, 160)], 995000],
    ['A12', [entry(0, 0.01, 3)], 20],
    ['A13', [entry(0, 20), entry(0, 20, 3)], 127500],
    ['A15', [entry(4, 20, 3), entry(0, 20)], 127500],
  ] as const)('%s', (_, entries, expected) => expect(run([...entries]).totalFeeCents).toBe(expected))
  it.each([[30, 45000, 1], [60, 225000, 2], [90, 420000, 3], [120, 645000, 4], [150, 900000, 5]])('A09 恰好 %i 小时不误入下一阶梯', (amount, expected, count) => {
    const result = run([entry(0, amount)])
    expect(result.totalFeeCents).toBe(expected)
    expect(result.tiers.filter(t => t.hoursHundredths > 0)).toHaveLength(count)
  })
  it('A11 双向换算支持 0.01 小时 / 0.005 节', () => {
    expect(parseQuantity('25', 'lessons').value).toBe(5000)
    expect(lessons(parseQuantity('3', 'hours').value!)).toBe('1.5')
    expect(lessons(parseQuantity('0.01', 'hours').value!)).toBe('0.005')
    expect(parseQuantity('0.005', 'lessons').value).toBe(1)
  })
  it('A14 输入顺序不影响结果', () => {
    expect(run([entry(5, 20), entry(0, 20)])).toEqual(run([entry(0, 20), entry(5, 20)]))
  })
})

describe('精度、约束与快照', () => {
  it('重复组合先合并再舍入，保证唯一明细粒度', () => {
    const result = run([entry(0, 0.01, 3), entry(0, 0.01, 3)])
    expect(result.totalFeeCents).toBe(39)
    expect(result.tiers[0].details).toHaveLength(1)
  })
  it('不提前舍入系数乘单价的中间结果', () => {
    const config = defaultConfig(); config.rates[0][0] = 101
    const result = calculate({ month: '2026-09', entries: [entry(0, 10, 3)] }, config, time)
    expect(result.totalFeeCents).toBe(1313)
  })
  it('允许零价、非单调价格，结果复制配置与输入', () => {
    const config = defaultConfig(); config.rates[1][0] = 0
    const entries = [entry(0, 40)]
    const result = calculate({ month: '2026-09', entries }, config, time)
    config.rates[0][0] = 9000; entries[0].hoursHundredths = 1
    expect(result.totalFeeCents).toBe(45000)
    expect(result.config.rates[0][0]).toBe(1500)
    expect(result.input.entries[0].hoursHundredths).toBe(4000)
  })
  it('36 个组合、多次随机边界：工时与金额守恒、阶梯连续、顺序稳定', () => {
    let seed = 13708
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % 10000 }
    for (let round = 0; round < 100; round++) {
      const entries: Entry[] = Array.from({ length: 36 }, (_, i) => ({ gradeId: Math.floor(i / 3), classSize: (i % 3 + 1) as ClassSize, hoursHundredths: random() }))
      const result = run(entries)
      const details = result.tiers.flatMap(t => t.details)
      expect(details.reduce((sum, d) => sum + d.hoursHundredths, 0)).toBe(entries.reduce((sum, e) => sum + e.hoursHundredths, 0))
      expect(details.reduce((sum, d) => sum + d.feeCents, 0)).toBe(result.totalFeeCents)
      expect(result.tiers.reduce((sum, t) => sum + t.feeCents, 0)).toBe(result.totalFeeCents)
      for (let i = 1; i < result.tiers.length; i++) if (result.tiers[i].hoursHundredths > 0) expect(result.tiers[i - 1].hoursHundredths).toBe(3000)
      for (let i = 1; i < details.length; i++) expect(details[i].startHundredths).toBe(details[i - 1].endHundredths)
      expect(run([...entries].reverse())).toEqual(result)
    }
  })
  it.each(['-1', 'abc', 'Infinity', 'NaN', '1e3', '0.001', '1,000'])('拒绝不合法小时 %s', value => expect(parseQuantity(value, 'hours').error).toBeTruthy())
  it.each(['0.001', '0.006', '0.0005'])('拒绝不合法节数 %s', value => expect(parseQuantity(value, 'lessons').error).toBeTruthy())
  it.each(['', '-1', 'abc', 'Infinity', '0.001'])('拒绝不合法价格 %s', value => expect(parsePrice(value).error).toBeTruthy())
  it('空课时为零、零价有效、显示去除尾零', () => {
    expect(parseQuantity('', 'hours').value).toBe(0)
    expect(parsePrice('0').value).toBe(0)
    expect(parsePrice('1.20').value).toBe(120)
    expect(hours(120)).toBe('1.2')
    expect(lessons(20)).toBe('0.1')
    expect(money(135000)).toBe('1,350.00')
  })
  it('超过安全整数范围时拒绝输入与计算，不生成不精确金额', () => {
    expect(parseQuantity('999999999999999', 'hours').error).toBeTruthy()
    const config = defaultConfig(); config.rates[0][0] = Number.MAX_SAFE_INTEGER
    expect(() => calculate({ month: '2026-09', entries: [entry(0, 30)] }, config, time)).toThrow('数值过大')
    expect(() => run([{ gradeId: 0, classSize: 1, hoursHundredths: Number.MAX_SAFE_INTEGER }, entry(1, 1)])).toThrow('数值过大')
  })
  it.each(['', '2026-13', '2026-00', '0000-01'])('拒绝非法月份 %s', month => expect(() => calculate({ month, entries: [] }, defaultConfig(), time)).toThrow('月份'))
})
