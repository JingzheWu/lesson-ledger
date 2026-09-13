const { summaryView } = require('../../runtime')
const { session } = require('../../ui')
Page({
  data: { records: [], month: '', loading: false, error: '', hasMore: false, ready: false },
  onLoad() {
    this.sequence = 0; this.loadedEpoch = -1
    this.unsubscribe = session().subscribe(() => {
      const s = session()
      if (!s.identityReady || s.identifying) {
        this.clearRecords()
      } else if (this.visible && this.loadedEpoch !== s.epoch) this.load(true)
    })
  },
  async onShow() {
    this.visible = true; await getApp().ready
    if (!this.visible || this.destroyed) return
    if (this.requesting && this.loadedEpoch === session().epoch) return
    await this.load(true, { silent: true })
  },
  onHide() { this.visible = false },
  onUnload() { this.visible = false; this.destroyed = true; this.unsubscribe?.(); ++this.sequence },
  clearRecords() {
    ++this.sequence; this.loadedEpoch = -1; this.cursor = null; this.hasLoaded = false; this.requesting = false
    this.setData({ records: [], ready: false, loading: false, error: '', hasMore: false })
  },
  async load(reset, { silent = false } = {}) {
    if (this.destroyed) return
    const s = session()
    if (!s.identityReady || s.identifying) { this.clearRecords(); wx.stopPullDownRefresh(); return }
    if (!reset && (this.requesting || !this.data.hasMore)) return
    const month = this.data.month
    const keep = this.hasLoaded && this.loadedEpoch === s.epoch && this.loadedMonth === month
    const sequence = ++this.sequence
    this.loadedEpoch = s.epoch; this.loadedMonth = month; this.requesting = true
    this.retryReset = reset
    if (!keep) { this.cursor = null; this.hasLoaded = false }
    this.setData({ ready: true, loading: !(silent && keep), error: '', ...(!keep ? { records: [], hasMore: false } : {}) })
    try {
      // Refresh every previously loaded page before replacing the list, so
      // returning from a detail does not collapse it back to the first 20 rows.
      const pages = reset && keep ? Math.max(1, Math.ceil(this.data.records.length / 20)) : 1
      const incoming = []
      let cursor = reset ? null : this.cursor
      for (let page = 0; page < pages; page++) {
        const result = await s.call('listRecords', { limit: 20, ...(month ? { month } : {}), ...(cursor ? { cursor } : {}) })
        if (sequence !== this.sequence) return
        incoming.push(...result.records)
        cursor = result.nextCursor
        if (!cursor) break
      }
      const records = reset ? [] : this.data.records
      const known = new Set(records.map(r => r.id))
      this.cursor = cursor; this.hasLoaded = true
      this.setData({ records: records.concat(incoming.filter(r => {
        if (known.has(r.id)) return false
        known.add(r.id); return true
      }).map(summaryView)), hasMore: !!cursor })
    } catch (e) { if (sequence === this.sequence && !(silent && keep)) this.setData({ error: e.message || '加载失败，请重试' }) }
    finally {
      if (sequence === this.sequence) { this.requesting = false; this.setData({ loading: false }); wx.stopPullDownRefresh() }
    }
  },
  changeMonth(e) { this.setData({ month: e.detail.value }); this.load(true) },
  all() { this.setData({ month: '' }); this.load(true) },
  more() { this.load(false) },
  retry() { this.load(this.retryReset !== false) },
  async sync() { await session().identify(); this.load(true) },
  onPullDownRefresh() { this.load(true) },
  onReachBottom() { this.load(false) },
  open(e) { wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` }) },
  calculate() { wx.switchTab({ url: '/pages/calculate/index' }) },
})
