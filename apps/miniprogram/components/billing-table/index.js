const { billingRuleNotes } = require('../../runtime')
Component({
  options: { multipleSlots: true },
  properties: { table: Array, rules: Object, title: { type: String, value: '本次计费表' } },
  data: { ruleNotes: [] },
  observers: { rules(rules) { this.setData({ ruleNotes: billingRuleNotes(rules) }) } },
})
