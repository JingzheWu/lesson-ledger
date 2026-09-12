import { describe, expect, it, vi } from 'vitest'
import * as cloud from 'wx-server-sdk'
import { LedgerError } from '../packages/core/contracts'
import { cloudRepository } from './cloud-repository'
import type { CloudDatabase } from './cloud-repository'

describe('固定 wx-server-sdk 4.0.2 的本地接口契约（传输替身）', () => {
  it('可信身份来自SDK上下文，不来自函数参数', () => {
    vi.stubEnv('WX_CONTEXT_KEYS', 'WX_OPENID,WX_APPID')
    vi.stubEnv('WX_OPENID', 'trusted-test-openid'); vi.stubEnv('WX_APPID', 'trusted-test-appid')
    try { expect(cloud.getWXContext()).toMatchObject({ OPENID: 'trusted-test-openid', APPID: 'trusted-test-appid' }) }
    finally { vi.unstubAllEnvs() }
  })
  it('实际SDK事务返回业务值，错误原样回滚，缺失文档null、网络错误不当作缺失', async () => {
    const config = { env: 'contract-test', throwOnNotFound: false }
    cloud.init(config)
    const db = cloud.database()
    const internal = db as unknown as { _db: { constructor: { reqClass: unknown } } }
    const original = internal._db.constructor.reqClass
    const calls: string[] = []
    let offline = false, exists = false
    class Transport {
      async send(action: string, payload?: { data?: string }) {
        calls.push(action)
        if (offline) throw new Error('network unavailable')
        if (action === 'database.startTransaction') return { transactionId: 'test-transaction' }
        if (action === 'database.getDocument') return { data: { list: exists ? [JSON.stringify({ _id: 'test-id', revision: 1 })] : [] } }
        if (action === 'database.modifyDocument') {
          expect(JSON.parse(payload!.data!)).not.toHaveProperty('_id')
          exists = true
          return { data: { updated: 1, upsert_id: 'test-id' } }
        }
        if (['database.commitTransaction', 'database.abortTransaction'].includes(action)) return {}
        throw new Error('Unexpected transport action: ' + action)
      }
    }
    internal._db.constructor.reqClass = Transport
    const repo = cloudRepository(db as unknown as CloudDatabase)
    try {
      const value = await repo.transaction(async tx => {
        expect(await tx.get('user_configs', 'test-id')).toBeNull()
        await tx.put('user_configs', 'test-id', { revision: 1 })
        return { revision: 1 }
      })
      expect(value).toEqual({ revision: 1 })
      expect(calls).toContain('database.commitTransaction')
      await repo.transaction(async tx => {
        const pointer = await tx.get<{ revision: number }>('user_configs', 'test-id')
        expect(pointer).toEqual({ revision: 1 })
        await tx.put('user_configs', 'test-id', { ...pointer, revision: 2 })
      })
      const error = new LedgerError('CONFLICT', '计费表已在其他设备更新')
      await expect(repo.transaction(async () => { throw error })).rejects.toBe(error)
      expect(calls).toContain('database.abortTransaction')
      offline = true
      await expect(repo.get('user_configs', 'test-id')).rejects.toBeTruthy()
    } finally { internal._db.constructor.reqClass = original }
  })
})
