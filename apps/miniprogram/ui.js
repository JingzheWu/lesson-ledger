function session() { return getApp().session }
function error(e) { wx.showModal({ title: '操作提示', content: e?.message || '暂时无法完成，请重试', showCancel: false }) }
function confirm(content, title = '请确认') {
  return new Promise(resolve => wx.showModal({ title, content, confirmColor: '#24754c', success: r => resolve(r.confirm), fail: () => resolve(false) }))
}
function run(work) { return Promise.resolve().then(work).catch(error) }
function leaveGuard(enabled) {
  if (enabled && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '未保存试算关闭后可能丢失，请确认已保存需要的记录。' })
  else if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
}
module.exports = { session, error, confirm, run, leaveGuard }
