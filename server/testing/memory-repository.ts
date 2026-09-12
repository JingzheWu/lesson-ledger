import { clone } from '../../packages/core/contracts'
import type { Cursor, RecordSummary } from '../../packages/core/contracts'
import type { Collection, Documents, Repository } from '../repository'

// Transactional test double, not a production/offline persistence path.
export class MemoryRepository implements Repository {
  data = new Map<string, object>()
  private tail: Promise<unknown> = Promise.resolve()
  async get<T>(collection: Collection, id: string): Promise<T | null> { return clone((this.data.get(`${collection}/${id}`) as T) ?? null) }
  async put<T extends object>(collection: Collection, id: string, value: T): Promise<void> { this.data.set(`${collection}/${id}`, clone(value)) }
  async remove(collection: Collection, id: string): Promise<void> { this.data.delete(`${collection}/${id}`) }
  async transaction<T>(work: (tx: Documents) => Promise<T>): Promise<T> {
    const current = this.tail.then(async () => {
      const staged = new MemoryRepository()
      staged.data = new Map([...this.data].map(([key, value]) => [key, clone(value)]))
      const value = await work(staged)
      this.data = staged.data
      return clone(value)
    })
    this.tail = current.catch(() => undefined)
    return current
  }
  async list(ownerId: string, month: string | undefined, cursor: Cursor | undefined, limit: number): Promise<RecordSummary[]> {
    return [...this.data.entries()].filter(([k]) => k.startsWith('calculation_records/'))
      .map(([, r]) => r as RecordSummary & { ownerId: string })
      .filter(r => r.ownerId === ownerId && (!month || r.month === month) && (!cursor || r.savedAt < cursor.savedAt || (r.savedAt === cursor.savedAt && r.id < cursor.id)))
      .sort((a, b) => b.savedAt - a.savedAt || (a.id < b.id ? 1 : -1)).slice(0, limit)
      .map(r => ({ id: r.id, schemaVersion: r.schemaVersion, month: r.month, totalFeeCents: r.totalFeeCents,
        totalHoursHundredths: r.totalHoursHundredths, totalLessons: r.totalLessons, savedAt: r.savedAt, configUpdatedAt: r.configUpdatedAt }))
  }
  count(collection: Collection): number { return [...this.data.keys()].filter(k => k.startsWith(`${collection}/`)).length }
}
