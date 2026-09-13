import { canonical, rulesSnapshot } from '../core/contracts'
import type { Rules } from '../core/contracts'

export const BILLING_EXPLANATION = {
  order: '从第一档开始，按年级从低到高（小学一年级至高中三年级），依次将授课时长计入计费阶梯。同一年级先计入一对一，再计入一对二，最后计入一对三。填写课时的先后顺序不影响分配结果。',
  accumulation: '每个月，所有年级和班型的授课时长一起累计，不分别从第一档重新计算。前五档每档容纳 30 小时，满一档后，剩余时长接着计入下一档；超过 150 小时的部分都按第六档计费。',
  example: '例如，一年级和二年级各有 20 小时：第一档计入一年级的 20 小时和二年级的 10 小时，二年级剩余的 10 小时计入第二档。',
} as const

// Improve display copy without changing the rule snapshots used to validate
// existing cloud configurations, saved records and shared calculations.
export function billingRuleNotes(rules?: Rules | null) {
  if (!rules) return []
  if (canonical(rules) !== canonical(rulesSnapshot())) {
    return [{ id: 'order', title: '课时计入顺序', text: rules.sorting }]
  }
  return [
    { id: 'order', title: '课时按什么顺序计入阶梯', text: BILLING_EXPLANATION.order },
    { id: 'accumulation', title: '全月课时一起累计', text: BILLING_EXPLANATION.accumulation },
    { id: 'example', title: '跨阶梯示例', text: BILLING_EXPLANATION.example },
  ]
}
