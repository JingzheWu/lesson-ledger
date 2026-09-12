const { isReadableRecord, resultView, money, displayTime } = require('../../runtime')
const { session, run, confirm } = require('../../ui')
Page({
  data: { view: null, loading: false, error: '', incompatible: false, historical: false, acting: false, source: '' },
  onLoad(options) {
    this.id = options.id; this.sequence = 0; this.loadedEpoch = -1; this.visible = true
    this.setData({ historical: !!this.id })
    this.unsubscribe = session().subscribe(() => {
      const s = session()
      if (s.identifying || (this.id && !s.identityReady)) {
        ++this.sequence; this.loadedEpoch = -1; this.record = null
        this.setData({ view: null, error: '正在确认身份或暂时无法读取个人数据', source: '', loading: false })
      } else if (this.visible && this.loadedEpoch !== s.epoch) this.load()
    })
  },
  async onShow() { this.visible = true; await getApp().ready; this.load() },
  onHide() { this.visible = false },
  onUnload() { this.unsubscribe?.(); ++this.sequence },
  async load() {
    const s = session(), sequence = ++this.sequence
    this.loadedEpoch = s.epoch
    this.setData({ view: null, error: '', incompatible: false, source: '' })
    if (s.identifying) return
    if (!this.id) {
      if (s.instance) this.setData({ view: resultView(s.instance.result), state: s.resultState === 'stale' ? '上次结果 · 待重算' : s.resultState === 'saved' ? '已保存' : '本次试算' })
      else this.setData({ error: '本次试算已结束，请返回计算页重新计算' })
      return
    }
    this.setData({ loading: true })
    try {
      const record = await s.call('getRecord', { id: this.id })
      if (sequence !== this.sequence) return
      if (!isReadableRecord(record)) { this.setData({ incompatible: true }); return }
      this.record = record
      this.setData({ view: resultView(record.result, record.rules, record), source: record.sourceRecordId || '', state: '已保存' })
    } catch (e) { if (sequence === this.sequence) this.setData({ error: e.message || '加载失败，请重试' }) }
    finally { if (sequence === this.sequence) this.setData({ loading: false }) }
  },
  retry() { run(async () => { if (!session().identityReady) await session().identify(); await this.load() }) },
  reuse() {
    run(async () => {
      if (!this.record || this.data.acting) return
      const record = this.record, epoch = session().epoch
      if (session().hasWork && !await confirm('将替换计算页的课时和试算。未保存内容会丢失，是否继续？')) return
      if (epoch !== session().epoch || record !== this.record) return
      this.setData({ acting: true })
      try { await session().reuse(record); wx.switchTab({ url: '/pages/calculate/index' }) }
      finally { this.setData({ acting: false }) }
    })
  },
  remove() {
    run(async () => {
      if (!this.record || this.data.acting) return
      const r = this.record, epoch = session().epoch
      if (!await confirm(`删除 ${r.result.input.month} 的 ${money(r.result.totalFeeCents)} 元记录？\n保存时间：${displayTime(r.savedAt)}\n删除后无法恢复。`, '删除记录')) return
      if (epoch !== session().epoch || r !== this.record) return
      this.setData({ acting: true })
      try {
        await session().call('deleteRecord', { id: r.id })
        if (session().saved?.id === r.id) { session().saved = null; session().resultState = 'stale'; session().emit() }
        wx.switchTab({ url: '/pages/history/index' })
      } finally { this.setData({ acting: false }) }
    })
  },
})
