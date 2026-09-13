const { isReadableRecord, isReadableShare, resultView, money, displayTime, canonical, clone } = require('../../runtime')
const { session, run, confirm } = require('../../ui')
const { exportDetailImage, saveToAlbum, shareImage, invoke } = require('../../detail-image')
Page({
  data: { view: null, loading: false, error: '', incompatible: false, historical: false, acting: false, source: '', shared: false,
    sharePanel: false, shareToken: '', preparing: false, exporting: false, albumPermission: false,
    navTop: 30, navHeight: 32, navTotal: 72, navRight: 104, homeNavigation: false },
  onLoad(options) {
    this.sharedMode = options.share !== undefined; this.token = options.share
    this.id = this.sharedMode ? null : options.id; this.sequence = 0; this.loadedEpoch = -1; this.visible = true
    const window = wx.getWindowInfo?.() || {}, menu = wx.getMenuButtonBoundingClientRect?.()
    const navTop = menu?.top || (window.statusBarHeight || 24) + 6, navHeight = menu?.height || 32
    this.setData({ historical: !!this.id, shared: this.sharedMode, homeNavigation: this.sharedMode || getCurrentPages().length < 2,
      navTop, navHeight, navTotal: navTop + navHeight + 10, navRight: menu?.left ? window.windowWidth - menu.left + 8 : 104 })
    wx.hideShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'] })
    this.unsubscribe = session().subscribe(() => {
      if (this.sharedMode) return
      const s = session()
      if (s.identifying || (this.id && !s.identityReady)) {
        ++this.sequence; this.loadedEpoch = -1; this.record = null; this.calculation = null
        this.setData({ view: null, error: '正在确认身份或暂时无法读取个人数据', source: '', loading: false, shareToken: '', sharePanel: false })
        wx.hideShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'] })
      } else if (this.visible && this.loadedEpoch !== s.epoch) this.load()
    })
  },
  async onShow() {
    this.visible = true; await getApp().ready
    if (this.destroyed) return
    const s = session()
    if (this.sharedMode && this.data.view) { await this.load({ background: true }); return }
    if (this.loadedEpoch === s.epoch) {
      if (this.data.loading) return
      if (this.data.view && (this.id || (this.snapshotKey === canonical([s.userKey, s.instance]) && this.loadedResultState === s.resultState))) return
    }
    await this.load()
  },
  onHide() { this.visible = false },
  onUnload() { this.destroyed = true; this.unsubscribe?.(); ++this.sequence },
  navigateBack() { if (this.data.homeNavigation) wx.switchTab({ url: '/pages/calculate/index' }); else wx.navigateBack() },
  present(view, state, key) {
    if (this.snapshotKey !== key) {
      this.snapshotKey = key; this.preparedLink = null; this.shareRequest = null
      this.setData({ sharePanel: false, albumPermission: false })
    }
    this.setData({ view, state, shareToken: this.sharedMode ? this.token : this.preparedLink?.token || '' })
    if (this.data.shareToken) wx.showShareMenu?.({ menus: ['shareAppMessage'] })
  },
  async load({ background = false } = {}) {
    const s = session(), sequence = ++this.sequence
    this.loadedEpoch = s.epoch
    if (!background) {
      this.record = null; this.calculation = null
      this.setData({ view: null, error: '', incompatible: false, source: '', shareToken: '' })
      wx.hideShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'] })
    }
    if (this.sharedMode) {
      if (!background) this.setData({ loading: true })
      try {
        const shared = await s.platform.call('getShare', { token: this.token })
        if (sequence !== this.sequence) return
        if (!isReadableShare(shared)) { this.setData({ view: null, shareToken: '', sharePanel: false, incompatible: true }); return }
        this.present(resultView(shared.result, shared.rules, shared.savedAt === undefined ? undefined : shared), '分享明细 · 只读', canonical(shared))
        this.setData({ historical: shared.savedAt !== undefined, error: '' })
      } catch (e) {
        if (sequence === this.sequence) {
          if (e.code === 'NOT_FOUND') {
            this.setData({ view: null, shareToken: '', sharePanel: false, error: '此分享不存在或已停止分享' })
            wx.hideShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'] })
          } else if (!background) this.setData({ error: e.message || '分享加载失败，请重试' })
        }
      }
      finally { if (sequence === this.sequence) this.setData({ loading: false }) }
      return
    }
    if (s.identifying) return
    if (!this.id) {
      if (s.instance) {
        this.loadedResultState = s.resultState
        this.calculation = clone(s.instance)
        this.present(resultView(this.calculation.result), s.resultState === 'stale' ? '上次结果 · 待重算' : s.resultState === 'saved' ? '已保存' : '本次试算', canonical([s.userKey, this.calculation]))
      }
      else this.setData({ error: '本次试算已结束，请返回计算页重新计算' })
      return
    }
    this.setData({ loading: true })
    try {
      const record = await s.call('getRecord', { id: this.id })
      if (sequence !== this.sequence) return
      if (!isReadableRecord(record)) { this.setData({ incompatible: true }); return }
      this.record = record
      this.present(resultView(record.result, record.rules, record), '已保存', canonical([s.userKey, record]))
      this.setData({ source: record.sourceRecordId || '' })
    } catch (e) { if (sequence === this.sequence) this.setData({ error: e.message || '加载失败，请重试' }) }
    finally { if (sequence === this.sequence) this.setData({ loading: false }) }
  },
  retry() { run(async () => { if (!this.sharedMode && !session().identityReady) await session().identify(); await this.load() }) },
  openShare() { if (this.data.view) this.setData({ sharePanel: true }) },
  closeShare() { if (!this.data.preparing && !this.data.exporting) this.setData({ sharePanel: false }) },
  stop() {},
  prepareShare() {
    return run(async () => {
      if (!this.data.view || this.data.preparing || this.data.shareToken || this.sharedMode) return
      const s = session(), key = this.snapshotKey, epoch = s.epoch
      if (!this.shareRequest) {
        const requestId = s.platform.requestId()
        if (this.record) this.shareRequest = { requestId, recordId: this.record.id }
        else if (this.calculation) {
          const c = this.calculation
          this.shareRequest = { requestId, calculation: { versionId: c.versionId, ruleVersion: c.ruleVersion,
            input: c.result.input, calculatedAt: c.result.calculatedAt, expectedResult: c.result } }
        } else return
      }
      this.setData({ preparing: true })
      try {
        const link = await s.call('createShare', clone(this.shareRequest))
        if (this.destroyed || key !== this.snapshotKey || epoch !== s.epoch) return
        if (!/^[a-f0-9]{64}$/.test(link?.token)) throw new Error('分享生成失败，请重试')
        this.preparedLink = link; this.setData({ shareToken: link.token })
        wx.showShareMenu?.({ menus: ['shareAppMessage'] })
      } catch (e) {
        if (e.code === 'DELETED') this.shareRequest = null
        throw e
      } finally { if (!this.destroyed) this.setData({ preparing: false }) }
    })
  },
  onShareAppMessage() {
    if (!this.data.view || !this.data.shareToken) return { title: '课时小账', path: '/pages/calculate/index' }
    return { title: `${this.data.view.month} 课时费明细 · ${this.data.view.amount} 元`, path: `/pages/detail/index?share=${this.data.shareToken}` }
  },
  revokeShare() {
    return run(async () => {
      if (this.sharedMode || !this.preparedLink || this.data.preparing) return
      if (!await confirm('停止后，已发出的这个小程序链接将无法读取明细。已保存或发送的图片不受影响。', '停止分享')) return
      this.setData({ preparing: true })
      try {
        await session().call('revokeShare', { token: this.preparedLink.token })
        this.preparedLink = null; this.shareRequest = null; this.setData({ shareToken: '' })
        wx.hideShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'] })
        wx.showToast({ title: '已停止分享', icon: 'success' })
      } finally { if (!this.destroyed) this.setData({ preparing: false }) }
    })
  },
  saveImage() { return this.imageAction('save') },
  shareLongImage() { return this.imageAction('share') },
  imageAction(action) {
    return run(async () => {
      if (!this.data.view || this.data.exporting) return
      const key = this.snapshotKey, epoch = session().epoch
      this.setData({ exporting: true, albumPermission: false, imageNotice: '' })
      wx.showLoading({ title: '正在生成长图', mask: true })
      try {
        const filePath = await exportDetailImage(this)
        if (this.destroyed || key !== this.snapshotKey || (!this.sharedMode && epoch !== session().epoch)) return
        wx.hideLoading()
        if (action === 'share') await shareImage(filePath)
        else {
          const result = await saveToAlbum(filePath)
          if (this.destroyed) return
          if (result.needsPermission) this.setData({ albumPermission: true, sharePanel: false })
          else if (result.saved) wx.showToast({ title: '已保存到相册', icon: 'success' })
        }
      } finally { wx.hideLoading(); if (!this.destroyed) this.setData({ exporting: false }) }
    })
  },
  albumSettings() { return run(async () => { await invoke('openSetting'); this.setData({ albumPermission: false }) }) },
  reuse() {
    run(async () => {
      if (this.sharedMode || !this.record || this.data.acting) return
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
      if (this.sharedMode || !this.record || this.data.acting) return
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
