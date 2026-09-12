import type { Cursor, RecordSummary } from '../packages/core/contracts'

export type Collection = 'user_configs' | 'config_versions' | 'calculation_records' | 'operation_receipts'
export interface Documents {
  get<T>(collection: Collection, id: string): Promise<T | null>
  put<T extends object>(collection: Collection, id: string, value: T): Promise<void>
  remove(collection: Collection, id: string): Promise<void>
}
export interface Repository extends Documents {
  transaction<T>(work: (tx: Documents) => Promise<T>): Promise<T>
  list(ownerId: string, month: string | undefined, cursor: Cursor | undefined, limit: number): Promise<RecordSummary[]>
}
