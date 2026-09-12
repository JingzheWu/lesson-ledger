const { Session, LedgerError } = require('./runtime')
const { cloudEnv } = require('./env')

// Failure codes only, in development/trial consoles. Never log SDK error text,
// request data, identity metadata, or responses.
function reportCloudError(action, stage, error) {
  if (wx.getAccountInfoSync?.().miniProgram?.envVersion === 'release') return
  console.warn('[ledger:cloud]', { action, stage, cloudEnv, functionName: 'ledger',
    code: error?.errCode ?? error?.code ?? 'UNAVAILABLE' })
}

App({
  onLaunch() {
    if (wx.cloud && cloudEnv) wx.cloud.init({ env: cloudEnv, traceUser: false })
    let counter = 0
    const random = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    const now = new Date()
    this.session = new Session({
      env: cloudEnv || 'unconfigured',
      call: (action, payload = {}) => {
        if (!wx.cloud || !cloudEnv) {
          reportCloudError(action, 'unconfigured', { code: !wx.cloud ? 'CLOUD_API_MISSING' : 'CLOUD_ENV_MISSING' })
          return Promise.reject(new LedgerError('UNAVAILABLE', '暂时无法连接云端，可使用默认价格试算'))
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reportCloudError(action, 'timeout', { code: 'TIMEOUT' })
            reject(new LedgerError('UNAVAILABLE', '请求超时，请确认保存状态或重试'))
          }, 20000)
          const sessionKey = action !== 'identity' ? this.session.userKey : null
          try {
            wx.cloud.callFunction({ name: 'ledger', config: { env: cloudEnv }, data: { action, payload, ...(sessionKey ? { sessionKey } : {}) },
              success: ({ result }) => {
                clearTimeout(timer)
                if (result && result.ok) resolve(result.data)
                else {
                  reportCloudError(action, 'rejected', { code: result?.error?.code || 'INVALID_RESPONSE' })
                  reject(new LedgerError(result?.error?.code || 'UNAVAILABLE', result?.error?.message || '暂时无法同步，请重试'))
                }
              },
              fail: error => {
                clearTimeout(timer); reportCloudError(action, 'failed', error)
                reject(new LedgerError('UNAVAILABLE', '暂时无法同步，请检查网络后重试'))
              },
            })
          } catch (error) {
            clearTimeout(timer); reportCloudError(action, 'threw', error)
            reject(new LedgerError('UNAVAILABLE', '暂时无法连接云端，请重试'))
          }
        })
      },
      readCache: key => wx.getStorageSync(key),
      writeCache: (key, value) => wx.setStorageSync(key, value),
      requestId: () => `r_${Date.now().toString(36)}_${random}_${++counter}`,
      now: () => new Date().toISOString(),
    }, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    wx.onNetworkStatusChange(({ isConnected }) => {
      if (isConnected) {
        if (this.session.identityReady) this.session.refreshConfig()
        else this.session.identify()
      }
    })
  },
  onShow() { this.ready = this.session.identify() },
})
