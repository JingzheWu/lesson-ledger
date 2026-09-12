import type { Cursor, RecordSummary } from '../packages/core/contracts'
import type { Collection, Documents, Repository } from './repository'

// A narrow SDK boundary: wx-server-sdk's public types also include callback
// overloads. Here we exclusively use its verified Promise API.
export interface CloudDocument {
  get(): Promise<{ data: object | null }>
  set(options: { data: object }): Promise<unknown>
  remove(): Promise<unknown>
}
export interface CloudQuery {
  doc(id: string): CloudDocument
  where(condition: object): CloudQuery
  orderBy(field: string, direction: string): CloudQuery
  field(fields: Record<string, boolean>): CloudQuery
  limit(limit: number): CloudQuery
  get(): Promise<{ data: RecordSummary[] }>
}
export interface CloudDatabase {
  collection(name: string): CloudQuery
  runTransaction<T>(callback: (tx: Pick<CloudDatabase, 'collection'>) => Promise<T>, retries: number): Promise<T>
  command: { and(...args: object[]): object; or(...args: object[]): object; lt(value: number | string): object }
}
function documents(db: Pick<CloudDatabase, 'collection'>): Documents {
  return {
    async get<T>(collection: Collection, id: string) {
      // throwOnNotFound:false makes ONLY missing documents null. Service errors
      // must propagate, never masquerade as a first-time user.
      const result = await db.collection(collection).doc(id).get()
      if (!result.data) return null
      // SDK reads include _id, while doc.set explicitly rejects _id in data.
      // Keep database metadata out of domain objects, including pointer/receipt updates.
      const document = { ...result.data } as Record<string, unknown>
      delete document._id
      return document as T
    },
    async put(collection, id, value) { await db.collection(collection).doc(id).set({ data: value }) },
    async remove(collection, id) { await db.collection(collection).doc(id).remove() },
  }
}
export function cloudRepository(db: CloudDatabase): Repository {
  return {
    ...documents(db),
    transaction: work => db.runTransaction(tx => work(documents(tx)), 5),
    async list(ownerId: string, month: string | undefined, cursor: Cursor | undefined, limit: number) {
      const base = { ownerId, ...(month ? { month } : {}) }
      const condition = cursor ? db.command.and(base, db.command.or(
        { savedAt: db.command.lt(cursor.savedAt) },
        { savedAt: cursor.savedAt, id: db.command.lt(cursor.id) },
      )) : base
      const result = await db.collection('calculation_records').where(condition)
        .orderBy('savedAt', 'desc').orderBy('id', 'desc').limit(limit)
        .field({ _id: false, id: true, schemaVersion: true, month: true, totalFeeCents: true,
          totalHoursHundredths: true, totalLessons: true, savedAt: true, configUpdatedAt: true }).get()
      return result.data
    },
  }
}
