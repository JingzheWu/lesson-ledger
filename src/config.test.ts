import { describe, expect, it, vi } from 'vitest'
import { loadConfig, saveConfig, STORAGE_KEY, STORAGE_WARNING } from './config'
import { defaultConfig } from './domain'

describe('本地配置管理', () => {
  it('首次访问加载默认，显式保存后重新加载', () => {
    const map = new Map<string, string>()
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }
    expect(loadConfig(() => storage)).toEqual({ config: defaultConfig(), warning: '' })
    const changed = defaultConfig(); changed.rates[0][0] = 2000
    saveConfig(changed, () => storage)
    expect(loadConfig(() => storage).config.rates[0][0]).toBe(2000)
  })
  it.each(['{broken', '{}', 'null', JSON.stringify({ ...defaultConfig(), schemaVersion: 2 }), JSON.stringify({ ...defaultConfig(), ruleVersion: 'unknown' }), JSON.stringify({ ...defaultConfig(), rates: [[-1]] })])('损坏 / 不兼容配置回退且不覆盖原值：%s', raw => {
    const setItem = vi.fn()
    const result = loadConfig(() => ({ getItem: () => raw, setItem }))
    expect(result).toEqual({ config: defaultConfig(), warning: STORAGE_WARNING })
    expect(setItem).not.toHaveBeenCalled()
  })
  it('获取 localStorage 本身抛错时回退', () => {
    expect(loadConfig(() => { throw new Error('SecurityError') }).warning).toBe(STORAGE_WARNING)
  })
  it('读取失败时回退，保存失败时抛错供界面保留草稿', () => {
    const storage = { getItem: () => { throw new Error('denied') }, setItem: vi.fn(() => { throw new Error('quota') }) }
    expect(loadConfig(() => storage).warning).toBe(STORAGE_WARNING)
    expect(() => saveConfig(defaultConfig(), () => storage)).toThrow('quota')
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(defaultConfig()))
  })
})
