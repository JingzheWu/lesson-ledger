const { summaryView } = require('../../runtime')
const { session } = require('../../ui')
Page({
  data: { records: [], month: '', loading: false, error: '', hasMore: false, ready: false },
  onLoad() {
    this.sequence = 0; this.loadedEpoch = -1
    this.unsubscribe = session().subscribe(() => {
      const s = session()
      if (!s.identityReady || s.identifying) {
        ++this.sequence; this.loadedEpoch = -1; this.cursor = null
        this.setData({ records: [], ready: false, loading: false, error: '', hasMore: false })
      } else if (this.visible && this.loadedEpoch !== s.epoch) this.load(true)
    })
  },
  async onShow() { this.visible = true; await getApp().ready; if (this.visible) this.load(true) },
  onHide() { this.visible = false },
  onUnload() { this.unsubscribe?.(); ++this.sequence },
  async load(reset) {
    const s = session()
    if (!s.identityReady || s.identifying) { this.setData({ ready: false }); wx.stopPullDownRefresh(); return }
    if (!reset && (this.data.loading || !this.data.hasMore)) return
    const sequence = ++this.sequence
    this.loadedEpoch = s.epoch
    if (reset) this.cursor = null
    this.setData({ ready: true, loading: true, error: '', ...(reset ? { records: [], hasMore: false } : {}) })
    try {
      const result = await s.call('listRecords', { limit: 20, ...(this.data.month ? { month: this.data.month } : {}), ...(this.cursor ? { cursor: this.cursor } : {}) })
      if (sequence !== this.sequence) return
      const records = reset ? [] : this.data.records
      const known = new Set(records.map(r => r.id))
      this.cursor = result.nextCursor
      this.setData({ records: records.concat(result.records.filter(r => !known.has(r.id)).map(summaryView)), hasMore: !!result.nextCursor })
    } catch (e) { if (sequence === this.sequence) this.setData({ error: e.message || '加载失败，请重试' }) }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); wx.stopPullDownRefresh() }
  },
  changeMonth(e) { this.setData({ month: e.detail.value }); this.load(true) },
  all() { this.setData({ month: '' }); this.load(true) },
  more() { this.load(false) },
  retry() { this.load(!this.data.records.length) },
  async sync() { await session().identify(); this.load(true) },
  onPullDownRefresh() { this.load(true) },
  onReachBottom() { this.load(false) },
  open(e) { wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` }) },
  calculate() { wx.switchTab({ url: '/pages/calculate/index' }) },
})
