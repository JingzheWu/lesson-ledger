const { detailImageLayout, detailImageScale, DETAIL_IMAGE_STYLE_FIELDS } = require('./runtime')
const debug = require('./debug')

function invoke(name, options = {}) {
  return new Promise((resolve, reject) => wx[name]({ ...options, success: resolve, fail: reject }))
}

let imageRun = 0
function imageTrace() {
  const started = Date.now(), run = ++imageRun
  let enabled = false
  try { enabled = debug.detailImage === true && ['develop', 'trial'].includes(wx.getAccountInfoSync?.().miniProgram?.envVersion) } catch {}
  const errorInfo = error => {
    const message = String(error?.errMsg || error?.message || '')
    return { errorCode: typeof error?.errCode === 'number' ? error.errCode : null,
      reason: /timeout|超时/i.test(message) ? 'timeout' : /memory|内存|too large/i.test(message) ? 'size-or-memory'
        : /尺寸不完整/.test(message) ? 'dimension-mismatch' : /页面已关闭/.test(message) ? 'page-closed' : 'api-or-render-error' }
  }
  const event = (stage, status, details = {}) => {
    if (!enabled) return
    // Only fixed stage names, dimensions, timing and numeric SDK codes. Never
    // log raw errors, file paths, report text, account identifiers or pixels.
    try { console.info('[ledger:image] ' + JSON.stringify({ revision: 'image-native-v3', run, stage, status, elapsedMs: Date.now() - started, ...details })) } catch {}
  }
  const sync = (stage, work, details = {}) => {
    const begin = Date.now()
    event(stage, 'start', details)
    try { const value = work(); event(stage, 'done', { ...details, durationMs: Date.now() - begin }); return value }
    catch (error) { event(stage, 'failed', { ...details, durationMs: Date.now() - begin, ...errorInfo(error) }); throw error }
  }
  return { event, sync, errorInfo }
}

async function exportDetailImage(page) {
  const trace = imageTrace()
  trace.event('export', 'start', { nativeBudgetMs: 10000 })
  try {
    const path = await generateDetailImage(page, trace)
    trace.event('export', 'done')
    return path
  } catch (error) { trace.event('export', 'failed', trace.errorInfo(error)); throw error }
}

async function generateDetailImage(page, trace) {
  let deadline = Date.now() + 12000
  function attempt(mode, budgetMs, work) {
    if (page.destroyed) throw new Error('明细页面已关闭')
    // Each supported-size attempt has its own bounded callback budget.
    deadline = Date.now() + budgetMs
    trace.event('attempt', 'start', { mode, budgetMs })
    return work()
  }
  function checkActive() {
    if (page.destroyed) throw new Error('明细页面已关闭')
    if (Date.now() >= deadline) throw new Error('长图生成超时，请重试')
  }
  function waitFor(stage, start, message, timeout = 4000) {
    checkActive()
    const begin = Date.now(), timeoutMs = Math.min(timeout, deadline - Date.now())
    trace.event(stage, 'start', { timeoutMs })
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) { trace.event(stage, 'late-callback', { durationMs: Date.now() - begin }); return }
        settled = true; clearTimeout(timer)
        trace.event(stage, callback === resolve ? 'done' : 'failed', { durationMs: Date.now() - begin, ...(callback === reject ? trace.errorInfo(value) : {}) })
        callback(value)
      }
      const timer = setTimeout(() => finish(reject, new Error(`${message}（${stage}）`)), timeoutMs)
      try { start(value => finish(resolve, value), error => finish(reject, error)) }
      catch (error) { finish(reject, error) }
    })
  }
  const exportApi = (name, options) => waitFor(name, (success, fail) => wx[name]({ ...options, success, fail }), '长图导出超时，请重试', 6000)
  const fields = { rect: true, size: true, dataset: true, computedStyle: DETAIL_IMAGE_STYLE_FIELDS }
  const table = page.selectComponent('#detail-billing-table')
  if (!table) throw new Error('计费表尚未加载完成，请稍后重试')
  const [report, component] = await Promise.all([
    waitFor('query.report', resolve => {
      const query = page.createSelectorQuery()
      query.select('#detail-report').fields({ rect: true, size: true })
      query.selectAll('#detail-report .export-node').fields(fields)
      query.select('#detail-canvas').fields({ node: true })
      query.exec(resolve)
    }, '明细布局读取超时，请重试'),
    waitFor('query.table', resolve => table.createSelectorQuery().selectAll('.export-node').fields(fields).exec(resolve), '计费表读取超时，请重试'),
  ])
  const [bounds, pageNodes, canvasResult] = report || [], tableNodes = component?.[0]
  trace.event('query.results', 'done', { report: !!bounds, pageNodes: pageNodes?.length || 0, tableNodes: tableNodes?.length || 0, canvas: !!canvasResult?.node })
  if (!bounds || !pageNodes?.length || !tableNodes?.length || !canvasResult?.node) throw new Error('明细页面尚未准备好，请稍后重试')
  const canvas = canvasResult.node
  const context = canvas.getContext('2d')
  const setFont = font => { context.font = `${font.weight} ${font.size}px ${font.family}` }
  const layout = trace.sync('layout', () => detailImageLayout(bounds, [...pageNodes, ...tableNodes], (text, font) => {
    setFont(font)
    return context.measureText(text).width
  }))
  trace.event('layout.size', 'done', { width: layout.width, height: layout.height, commands: layout.commands.length })
  function rectangle(command) {
    const { x, y, width, height, radius: r } = command
    if (!r) { context.fillRect(x, y, width, height); return }
    context.beginPath(); context.moveTo(x + r, y); context.lineTo(x + width - r, y)
    context.quadraticCurveTo(x + width, y, x + width, y + r); context.lineTo(x + width, y + height - r)
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height); context.lineTo(x + r, y + height)
    context.quadraticCurveTo(x, y + height, x, y + height - r); context.lineTo(x, y + r)
    context.quadraticCurveTo(x, y, x + r, y); context.closePath(); context.fill()
  }
  let boxWidth = 0, boxHeight = 0
  async function paint(scale, width, height, offset = 0) {
    checkActive()
    const begin = Date.now()
    trace.event('paint', 'start', { width, height, offset, scale })
    // Keep the native canvas box and its bitmap in the same coordinate space.
    if (width !== boxWidth || height !== boxHeight) {
      await waitFor('canvas.setData', resolve => page.setData({ exportCanvasWidth: width, exportCanvasHeight: height }, resolve), '画布准备超时，请重试')
      boxWidth = width; boxHeight = height
    }
    checkActive()
    canvas.width = width; canvas.height = height
    trace.sync('canvas.edgeProbe', () => {
      // Detect a clamped/unsupported tall bitmap before exporting it. Test the
      // actual bottom-right pixel, then clear the marker with the background.
      context.fillStyle = '#13579b'
      context.fillRect(width - 1, height - 1, 1, 1)
      const pixel = context.getImageData(width - 1, height - 1, 1, 1).data
      if (pixel[0] !== 19 || pixel[1] !== 87 || pixel[2] !== 155 || pixel[3] !== 255) throw new Error('画布尺寸超出设备能力')
    }, { width, height })
    context.scale(scale, scale)
    context.translate(0, -offset / scale)
    context.fillStyle = layout.background; context.fillRect(0, 0, layout.width, layout.height)
    context.textBaseline = 'top'
    for (const command of layout.commands) {
      context.fillStyle = command.color
      if (command.kind === 'rect') rectangle(command)
      else {
        setFont(command.font)
        if (!command.font.spacing) context.fillText(command.text, command.x, command.y)
        else {
          let x = command.x
          for (const character of command.text) {
            context.fillText(character, x, command.y)
            x += context.measureText(character).width + command.font.spacing
          }
        }
      }
    }
    // An off-screen native canvas may not dispatch animation-frame callbacks.
    // Yield to native drawing without depending on its visibility or frame loop.
    trace.event('paint.draw', 'done', { offset, durationMs: Date.now() - begin })
    const yielding = Date.now()
    await new Promise(resolve => setTimeout(resolve, 32))
    trace.event('paint.yield', 'done', { offset, durationMs: Date.now() - yielding })
    checkActive()
  }
  async function draw(maxSide) {
    const scale = Math.min(2, detailImageScale(layout.width, layout.height, maxSide))
    const width = Math.max(1, Math.floor(layout.width * scale)), height = Math.max(1, Math.floor(layout.height * scale))
    trace.event('native', 'start', { maxSide, width, height, scale })
    await paint(scale, width, height)
    const result = await exportApi('canvasToTempFilePath', { canvas, x: 0, y: 0, width, height,
      destWidth: width, destHeight: height, fileType: 'png' })
    if (!result.tempFilePath) throw new Error('长图生成失败，请重试')
    const info = await exportApi('getImageInfo', { src: result.tempFilePath })
    trace.event('image.size', 'done', { expectedWidth: width, expectedHeight: height, width: info.width, height: info.height })
    if (info.width !== width || info.height !== height) throw new Error('长图尺寸不完整，请重试')
    page.setData({ imageNotice: maxSide < 8192 ? `此设备未能导出更大尺寸，本次图片为 ${width}×${height} 像素。` : '' })
    return result.tempFilePath
  }
  try {
    for (const maxSide of [8192, 6144, 4096]) {
      try { return await attempt(`native${maxSide}`, 10000, () => draw(maxSide)) }
      catch (error) {
        if (page.destroyed || maxSide === 4096) throw error
        trace.event('fallback', 'start', { from: `native${maxSide}`, ...trace.errorInfo(error) })
      }
    }
  } finally {
    trace.event('cleanup', 'start')
    canvas.width = 1; canvas.height = 1
    if (!page.destroyed) page.setData({ exportCanvasWidth: 1, exportCanvasHeight: 1 })
    trace.event('cleanup', 'done')
  }
}

async function saveToAlbum(filePath) {
  const setting = await invoke('getSetting')
  if (setting.authSetting?.['scope.writePhotosAlbum'] === false) return { needsPermission: true }
  try { await invoke('saveImageToPhotosAlbum', { filePath }); return { saved: true } }
  catch (e) {
    if (/auth deny|auth denied|authorize|permission/i.test(e.errMsg || '')) return { needsPermission: true }
    if (/cancel/i.test(e.errMsg || '')) return { cancelled: true }
    throw new Error('保存失败，请检查系统相册权限或存储空间后重试')
  }
}

async function shareImage(filePath) {
  if (!wx.showShareImageMenu) {
    await invoke('previewImage', { urls: [filePath], current: filePath })
    return
  }
  try { await invoke('showShareImageMenu', { path: filePath, needShowEntrance: false }) }
  catch (e) { if (!/cancel/i.test(e.errMsg || '')) throw new Error('图片分享未能打开，请重试或先保存到相册') }
}

module.exports = { exportDetailImage, saveToAlbum, shareImage, invoke }
