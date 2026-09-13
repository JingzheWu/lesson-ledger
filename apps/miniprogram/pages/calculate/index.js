const { sessionView, GRADES, CLASS_NAMES, parseQuantity, hours, lessons } = require('../../runtime')
const { session, run, confirm, leaveGuard } = require('../../ui')
Page({
  data: { rows: [], month: '', result: null, sheet: false, sheetHours: '', sheetLessons: '', sheetUnit: 'hours', sheetError: '', sheetDuplicate: false, sheetHeight: 480, keyboardInset: 0, gradeIndex: 0, classIndex: 0, grades: GRADES, classes: [CLASS_NAMES[1], CLASS_NAMES[2], CLASS_NAMES[3]], keyboardOpen: false },
  onLoad() {
    this.unsubscribe = session().subscribe(() => this.render())
    this.keyboard = ({ height }) => { this.keyboardHeight = height; this.updateSheetLayout() }
    wx.onKeyboardHeightChange(this.keyboard)
    this.render()
  },
  onShow() { this.updateSheetLayout(); this.render() },
  onResize() { this.updateSheetLayout() },
  onUnload() { this.unsubscribe?.(); wx.offKeyboardHeightChange(this.keyboard) },
  updateSheetLayout() {
    const { windowHeight = 650, screenHeight, screenTop } = wx.getWindowInfo?.() || {}
    const height = this.keyboardHeight || 0
    // Keyboard height is measured from the screen bottom; the page may end above
    // the native tab bar, or its viewport may already have shrunk for the keyboard.
    const bottomInset = Number.isFinite(screenHeight) && Number.isFinite(screenTop) ? Math.max(0, screenHeight - screenTop - windowHeight) : 0
    const keyboardInset = Math.max(0, height - bottomInset)
    this.setData({ keyboardOpen: height > 0, keyboardInset, sheetHeight: Math.max(0, Math.min(480, windowHeight - keyboardInset - 24)) })
  },
  render() {
    const s = session()
    this.setData({ ...sessionView(s), ...(s.identifying ? { sheet: false, sheetHours: '', sheetLessons: '', sheetError: '' } : {}) })
    leaveGuard(s.hasWork && s.resultState !== 'saved')
  },
  changeMonth(e) { run(() => session().setMonth(e.detail.value)) },
  openSheet() { if (!session().busy) { wx.hideKeyboard(); this.updateSheetLayout(); this.setData({ sheet: true, classIndex: 0, sheetHours: '', sheetLessons: '', sheetError: '', sheetUnit: 'hours' }); this.checkDuplicate() } },
  closeSheet() { run(async () => { if (!this.data.sheetDuplicate && (this.data.sheetHours || this.data.sheetLessons) && !await confirm('放弃面板内尚未添加的课时？')) return; this.setData({ sheet: false }); wx.hideKeyboard() }) },
  stop() {},
  chooseGrade(e) { this.setData({ gradeIndex: Number(e.detail.value) }); this.checkDuplicate() },
  chooseClass(e) { this.setData({ classIndex: Number(e.detail.value) }); this.checkDuplicate() },
  checkDuplicate() { this.setData({ sheetDuplicate: session().rows.some(r => r.gradeId === this.data.gradeIndex && r.classSize === this.data.classIndex + 1) }) },
  sheetInput(e) {
    const unit = e.currentTarget.dataset.unit, text = e.detail.value, parsed = parseQuantity(text, unit)
    const values = { sheetUnit: unit, sheetError: parsed.error || '', [unit === 'hours' ? 'sheetHours' : 'sheetLessons']: text }
    if (parsed.error === undefined && !/\.$/.test(text)) values[unit === 'hours' ? 'sheetLessons' : 'sheetHours'] = unit === 'hours' ? lessons(parsed.value) : hours(parsed.value)
    this.setData(values)
  },
  add() {
    run(() => {
      const existing = session().rows.some(r => r.gradeId === this.data.gradeIndex && r.classSize === this.data.classIndex + 1)
      const text = this.data.sheetUnit === 'hours' ? this.data.sheetHours : this.data.sheetLessons
      if (!existing) { const parsed = parseQuantity(text, this.data.sheetUnit); if (parsed.error) { this.setData({ sheetError: parsed.error }); throw new Error(parsed.error) } }
      const key = session().addRow(this.data.gradeIndex, this.data.classIndex + 1)
      if (!existing && text) session().updateRow(key, this.data.sheetUnit, text, true)
      this.setData({ sheet: false })
      wx.hideKeyboard()
      wx.nextTick(() => wx.pageScrollTo({ selector: `#entry-${key}`, duration: 250 }))
    })
  },
  input(e) { run(() => session().updateRow(e.currentTarget.dataset.key, e.currentTarget.dataset.unit, e.detail.value)) },
  blur(e) { run(() => session().updateRow(e.currentTarget.dataset.key, e.currentTarget.dataset.unit, e.detail.value, true)) },
  remove(e) {
    run(async () => {
      const key = e.currentTarget.dataset.key, row = session().rows.find(r => r.key === key)
      if (!row) return
      const epoch = session().epoch
      if ((row.hoursText || row.lessonsText) && !await confirm('删除这组已填写的课时？计算结果将需要重算。')) return
      if (epoch === session().epoch) session().removeRow(key)
    })
  },
  clear() { run(async () => { const epoch = session().epoch; if (session().hasWork && !await confirm('清空全部课时和当前试算？未保存内容将丢失。')) return; if (epoch === session().epoch) session().clear() }) },
  calculate() { run(() => {
    if (!sessionView(session()).canCalculate) return
    wx.hideKeyboard()
    try { session().calculate() }
    catch (e) { const row = session().rows.find(r => r.error); if (row) wx.pageScrollTo({ selector: `#entry-${row.key}`, duration: 250 }); throw e }
    wx.nextTick(() => wx.pageScrollTo({ selector: '#result', duration: 250 }))
  }) },
  save() { run(() => session().save()) },
  confirmSave() { run(() => session().confirmSave()) },
  detail() { wx.navigateTo({ url: '/pages/detail/index?mode=trial' }) },
  record() { if (session().saved) wx.navigateTo({ url: `/pages/detail/index?id=${session().saved.id}` }) },
  sync() { run(() => session().identityReady ? session().refreshConfig() : session().identify()) },
  applyNew() { run(() => session().applyPending()) },
  keepOld() { session().keepCurrent() },
})
