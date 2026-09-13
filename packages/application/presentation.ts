import { CLASS_NAMES, GRADES, hours, lessons, money, parseQuantity } from '../core/domain'
import type { Result } from '../core/domain'
import type { Rules, SavedRecord, RecordSummary } from '../core/contracts'
import { rulesSnapshot } from '../core/contracts'
import type { Session } from './session'

export function displayTime(value: string | number): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间不可用'
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}
export function tableView(rates: number[][], rules: Rules = rulesSnapshot()) {
  return rules.tiers.map(t => ({ id: t.id, name: t.name,
    prices: rules.groups.map(g => ({ id: g.id, name: g.name, value: money(rates[t.id][g.id]) })) }))
}
export function resultView(result: Result, rules: Rules = rulesSnapshot(), record?: Pick<SavedRecord, 'savedAt'>) {
  const label = (gradeId: number, classSize: number) => `${rules.grades.find(g => g.id === gradeId)?.name ?? '未知年级'} · ${rules.classes.find(c => c.id === classSize)?.name ?? '未知班型'}`
  return {
    month: result.input.month, amount: money(result.totalFeeCents), hours: hours(result.totalHoursHundredths), lessons: result.totalLessons,
    calculatedAt: displayTime(result.calculatedAt), savedAt: record ? displayTime(record.savedAt) : '',
    configTime: displayTime(result.config.updatedAt), zero: result.totalHoursHundredths === 0,
    inputs: result.input.entries.map(e => ({ key: `${e.gradeId}-${e.classSize}`, label: label(e.gradeId, e.classSize), hours: hours(e.hoursHundredths), lessons: lessons(e.hoursHundredths) })),
    tiers: result.tiers.map(t => ({ id: t.tierId, name: rules.tiers[t.tierId].name, hours: hours(t.hoursHundredths), amount: money(t.feeCents),
      emptyText: result.totalHoursHundredths === 0 ? '本月暂无授课' : '累计课时尚未达到此阶梯',
      details: t.details.map((d, i) => ({ key: i, label: label(d.gradeId, d.classSize), interval: `${hours(d.startHundredths)}–${hours(d.endHundredths)}小时`,
        formula: `${hours(d.hoursHundredths)} × ${money(d.rateCents)} × ${(d.multiplier / 10).toFixed(1)} = ${money(d.feeCents)}元` })) })),
    table: tableView(result.config.rates, rules), rules,
  }
}
export function summaryView(r: RecordSummary) {
  return { ...r, compatible: r.schemaVersion === 1, amount: money(r.totalFeeCents), hours: hours(r.totalHoursHundredths), savedTime: displayTime(r.savedAt), configTime: displayTime(r.configUpdatedAt) }
}
export function sessionView(s: Session) {
  const hidden = s.identifying
  const rows = hidden ? [] : s.rows.map(r => ({ ...r, label: `${GRADES[r.gradeId]} · ${CLASS_NAMES[r.classSize]}` }))
  let total = 0
  let invalid = false
  for (const r of rows) {
    const p = parseQuantity(r.hoursText, 'hours')
    if (p.error !== undefined || r.error) invalid = true
    else total += p.value
  }
  if (!Number.isSafeInteger(total)) { total = 0; invalid = true }
  const labels = { none: '', unsaved: '未保存', stale: '待重算 · 上次结果', saving: '正在保存', saved: '已保存', unknown: '保存状态未确认', failed: '保存失败' }
  return { month: hidden ? '' : s.month, rows, totalHours: invalid ? '请核对输入' : hours(total), totalLessons: invalid ? '—' : lessons(total),
    canCalculate: !s.busy && !invalid && total > 0,
    notice: s.notice, identifying: hidden, identityReady: s.identityReady && !hidden, busy: s.busy, resultState: s.resultState,
    result: !hidden && s.instance ? resultView(s.instance.result) : null, resultLabel: labels[s.resultState],
    savedTime: !hidden && s.saved ? displayTime(s.saved.savedAt) : '', savedId: !hidden && s.saved ? s.saved.id : '',
    canSave: !hidden && s.identityReady && !!s.instance?.versionId && ['unsaved', 'failed', 'unknown'].includes(s.resultState),
    pendingConfig: !hidden && !!s.pendingConfig, defaultPrices: !s.identityReady || !s.active,
  }
}
