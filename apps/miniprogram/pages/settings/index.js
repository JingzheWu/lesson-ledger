const { tableView, rulesSnapshot, displayTime, TIERS, GROUPS, parsePrice } = require('../../runtime')
const { session, run, confirm, leaveGuard } = require('../../ui')
Page({
  data: { focusPrice: '', editing: false, expanded: [true, false, false, false, false, false], table: [], draftTiers: [], rules: rulesSnapshot() },
  onLoad() { this.unsubscribe = session().subscribe(() => this.render()); this.render() },
  async onShow() { await getApp().ready; if (session().identityReady) await session().refreshConfig(); this.render() },
  onUnload() { this.unsubscribe?.() },
  render() {
    const s = session(), d = !s.identifying && s.identityReady ? s.draft : null
    const current = !s.identifying && s.identityReady ? s.latest?.config : null
    const next = { notice: s.notice, identifying: s.identifying, available: !!current,
      editing: !!d, busy: !!d?.busy, conflict: !!d?.conflict, unknown: !!d?.unknown, message: d?.message || '',
      configTime: current ? displayTime(current.updatedAt) : '', table: tableView(current?.rates || s.config.rates),
      draftTiers: d ? d.texts.map((row, id) => ({ id, name: TIERS[id], prices: row.map((text, group) => ({ group, name: GROUPS[group].name, text, error: parsePrice(text).error || '', comparison: d.comparison ? d.comparison[id][group] : null })) })) : [],
    }
    const patch = {}
    for (const [key, value] of Object.entries(next)) {
      if (key === 'draftTiers' && d && this.data.editing) {
        // Keep the native input nodes and only update changed cell properties.
        // Replacing the whole list on each keypress can reset focus/cursor state.
        value.forEach((tier, id) => tier.prices.forEach((price, group) => {
          const previous = this.data.draftTiers[id].prices[group]
          for (const field of ['text', 'error', 'comparison']) {
            if (previous[field] !== price[field]) patch[`draftTiers[${id}].prices[${group}].${field}`] = price[field]
          }
        }))
      } else if (JSON.stringify(this.data[key]) !== JSON.stringify(value)) patch[key] = value
    }
    if (!d && this.data.focusPrice) patch.focusPrice = ''
    if (Object.keys(patch).length) this.setData(patch)
    leaveGuard(!!d || (s.hasWork && s.resultState !== 'saved'))
  },
  edit() { run(() => session().beginEdit()) },
  toggle(e) { const expanded = [...this.data.expanded]; expanded[e.currentTarget.dataset.id] = !expanded[e.currentTarget.dataset.id]; this.setData({ expanded }) },
  focus(e) { this.setData({ focusPrice: `${e.currentTarget.dataset.tier}-${e.currentTarget.dataset.group}` }) },
  blur(e) {
    // A late blur from the previous input must not clear the newly focused one.
    if (this.data.focusPrice === `${e.currentTarget.dataset.tier}-${e.currentTarget.dataset.group}`) this.setData({ focusPrice: '' })
  },
  input(e) { session().editPrice(Number(e.currentTarget.dataset.tier), Number(e.currentTarget.dataset.group), e.detail.value) },
  reset() { run(async () => { const draft = session().draft; if (await confirm('用默认24个单价替换编辑草稿？点击“保存计费配置”后才会生效。') && session().draft === draft) session().resetDraft() }) },
  cancel() { run(async () => { const draft = session().draft; if (await confirm('放弃这份计费表草稿？当前生效价格保持不变。') && session().draft === draft) session().cancelEdit() }) },
  save() { run(async () => {
    try { await session().saveConfig() }
    catch (e) {
      const draft = session().draft
      if (draft) for (let tier = 0; tier < 6; tier++) {
        const group = draft.texts[tier].findIndex(text => parsePrice(text).error)
        if (group >= 0) { const expanded = [...this.data.expanded]; expanded[tier] = true; this.setData({ expanded, focusPrice: `${tier}-${group}` }); break }
      }
      throw e
    }
  }) },
  confirmSave() { run(() => session().confirmConfig()) },
  latest() { run(async () => { const draft = session().draft; if (await confirm('加载云端最新计费表作为编辑起点，原草稿将保留供对照。请重新确认单价后保存。') && session().draft === draft) await session().loadLatestDraft() }) },
  sync() { run(() => session().identityReady ? session().refreshConfig() : session().identify()) },
})
