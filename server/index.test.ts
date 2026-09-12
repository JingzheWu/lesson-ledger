import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRepository } from './testing/memory-repository'
import { scopedId } from './service'

const sdk = vi.hoisted(() => ({ getWXContext: vi.fn() }))
vi.mock('wx-server-sdk', () => ({
  init: vi.fn(), database: vi.fn(), DYNAMIC_CURRENT_ENV: Symbol('current'),
  getWXContext: sdk.getWXContext,
}))
vi.mock('./cloud-repository', () => ({ cloudRepository: () => new MemoryRepository() }))

import { main } from './index'

beforeEach(() => {
  sdk.getWXContext.mockReturnValue({ APPID: 'trusted-app', OPENID: 'trusted-user' })
})

it('微信入口兼容真机的 userInfo 和 tcbContext：身份确认、首次初始化和携带会话读取配置', async () => {
  const userKey = scopedId('trusted-app', 'wechat-user', 'trusted-user')
  const userInfo = { appId: 'trusted-app', openId: 'trusted-user' }
  const tcbContext = {}
  await expect(main({ action: 'identity', payload: {}, tcbContext, userInfo })).resolves.toEqual({ ok: true, data: { userKey } })
  const first = await main({ action: 'getConfig', payload: {}, sessionKey: userKey, tcbContext, userInfo })
  expect(first).toMatchObject({ ok: true, data: { revision: 1 } })
  await expect(main({ action: 'getConfig', payload: {}, sessionKey: userKey, tcbContext, userInfo })).resolves.toEqual(first)
  await expect(main({ action: 'identity', payload: {}, userInfo })).resolves.toEqual({ ok: true, data: { userKey } })
  await expect(main({ action: 'identity', payload: {} })).resolves.toEqual({ ok: true, data: { userKey } })
})

it('平台元数据不参与身份判断，伪造内容不能改变归属或绕过缺失上下文', async () => {
  const event = { action: 'identity', payload: {}, userInfo: { openId: 'forged-user', appId: 'forged-app' },
    tcbContext: { OPENID: 'forged-user', APPID: 'forged-app', ENV: 'forged-env' } }
  await expect(main(event)).resolves.toEqual({
    ok: true, data: { userKey: scopedId('trusted-app', 'wechat-user', 'trusted-user') },
  })
  sdk.getWXContext.mockReturnValue({})
  await expect(main(event)).resolves.toMatchObject({ ok: false, error: { code: 'IDENTITY' } })
})

it('忽略平台元数据后仍拒绝非法请求、未知业务字段和其他账号的会话', async () => {
  for (const event of [null, [], 'identity',
    { action: 'identity', ownerId: 'forged', userInfo: {} },
    { action: 'identity', unexpected: true, userInfo: {} },
    { action: 'identity', payload: { userInfo: {} }, userInfo: {} },
    { action: 'identity', payload: { tcbContext: {} }, tcbContext: {}, userInfo: {} },
    { action: 'identity', ownerId: 'forged', tcbContext: {}, userInfo: {} },
  ]) await expect(main(event)).resolves.toMatchObject({ ok: false, error: { code: 'INVALID' } })
  await expect(main({ action: 'getConfig', payload: {}, sessionKey: 'forged', tcbContext: {}, userInfo: {} }))
    .resolves.toMatchObject({ ok: false, error: { code: 'IDENTITY' } })
})

it('INVALID 返回可识别的部署标记和字段类型，不泄露请求值或嵌套身份', async () => {
  const result = await main({ action: 'identity', payload: {}, unexpected: 'private-value',
    userInfo: { openId: 'private-openid' } })
  expect(result).toMatchObject({ ok: false, error: { code: 'INVALID', diagnostic: {
    revision: 'wechat-request-v2', action: 'identity',
    envelope: { type: 'object', fields: expect.arrayContaining([{ name: 'unexpected', type: 'string' }]) },
    payload: { type: 'object', count: 0, fields: [] },
  } } })
  expect(JSON.stringify(result)).not.toContain('private-value')
  expect(JSON.stringify(result)).not.toContain('private-openid')
})

it('诊断识别非法 payload，限制字段数量和字段名，隐藏未知操作值', async () => {
  const { requestDiagnostic } = await import('./request-diagnostic')
  const event = { action: 'private-action', payload: { rates: ['private-rate'], '姓名': 'private-name' } }
  const result = requestDiagnostic(event)
  expect(result.action).toBe('[unknown]')
  expect(result.payload.fields).toEqual([{ name: 'rates', type: 'array' }, { name: '[redacted]', type: 'string' }])
  expect(requestDiagnostic({ action: 'identity', payload: [] }).payload).toEqual({ type: 'array' })
  expect(requestDiagnostic(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, i]))).envelope.fields).toHaveLength(20)
  expect(JSON.stringify(result)).not.toContain('private-')
})
