import * as cloud from 'wx-server-sdk'
import { LedgerError } from '../packages/core/contracts'
import { cloudRepository } from './cloud-repository'
import type { CloudDatabase } from './cloud-repository'
import { LedgerService, scopedId } from './service'
import { requestDiagnostic } from './request-diagnostic'

// SDK 4.0.2 accepts its own symbol at runtime; its init declaration still says string.
const sdkConfig = { env: cloud.DYNAMIC_CURRENT_ENV as unknown as string, throwOnNotFound: false }
cloud.init(sdkConfig)
const service = new LedgerService(cloudRepository(cloud.database() as unknown as CloudDatabase))

export async function main(event: unknown): Promise<unknown> {
  try {
    const context = cloud.getWXContext()
    if (!context.OPENID || !context.APPID) throw new LedgerError('IDENTITY', '暂时无法读取个人数据，请重试')
    const owner = scopedId(String(context.APPID), 'wechat-user', String(context.OPENID))
    // WeChat attaches userInfo and tcbContext to the invocation envelope. Neither
    // is business input or an identity source. Strictly validate all other fields.
    let request = event
    if (event && typeof event === 'object' && !Array.isArray(event)) {
      const { userInfo: _userInfo, tcbContext: _tcbContext, ...businessEvent } = event as Record<string, unknown>
      request = businessEvent
    }
    return { ok: true, data: await service.handle(owner, request) }
  } catch (e) {
    // Never log inputs, rates, snapshots, raw OPENID or SDK error payloads.
    const code = e instanceof LedgerError ? e.code : 'UNAVAILABLE'
    const diagnostic = requestDiagnostic(code === 'INVALID' ? event : undefined)
    console.warn(JSON.stringify({ errorType: code, diagnostic }))
    return { ok: false, error: { code, message: e instanceof LedgerError ? e.message : '暂时无法同步，请稍后重试', diagnostic } }
  }
}
