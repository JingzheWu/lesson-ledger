import { defaultConfig, isConfig } from './domain'
import type { Config } from './domain'

export const STORAGE_KEY = 'lesson-ledger:pricing:v1'
export const STORAGE_WARNING = '本地配置不可用，当前使用默认价格，请核对'
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function loadConfig(getStorage: () => StoragePort): { config: Config; warning: string } {
  try {
    const raw = getStorage().getItem(STORAGE_KEY)
    if (raw === null) return { config: defaultConfig(), warning: '' }
    const parsed: unknown = JSON.parse(raw)
    if (!isConfig(parsed)) throw new Error('Invalid config')
    return { config: parsed, warning: '' }
  } catch {
    return { config: defaultConfig(), warning: STORAGE_WARNING }
  }
}
export function saveConfig(config: Config, getStorage: () => StoragePort): void {
  if (!isConfig(config)) throw new Error('计费配置无效')
  getStorage().setItem(STORAGE_KEY, JSON.stringify(config))
}
