import { ArrowRightLeft, BookOpen, ChevronDown, Info, Trash2 } from 'lucide-react'
import { CLASS_NAMES, CLASSES, GRADES, GROUPS, hours, lessons, parseQuantity } from './domain'
import type { ClassSize, Entry, Quantity } from './domain'

export interface Row {
  gradeId: number
  classSize: ClassSize
  hoursHundredths: number
  hours: string
  lessons: string
  last: Quantity
  error: string
}
export function emptyRows(): Row[] {
  return GRADES.flatMap((_, gradeId) => CLASSES.map(classSize => ({ gradeId, classSize, hoursHundredths: 0, hours: '', lessons: '', last: 'hours' as const, error: '' })))
}
export function rowKey(row: Pick<Row, 'gradeId' | 'classSize'>): string { return `${row.gradeId}-${row.classSize}` }
export function updateRow(row: Row, unit: Quantity, text: string, validate = false): Row {
  const next = { ...row, [unit]: text, last: unit, error: '' }
  if (!validate && (text.trim() === '' || text.endsWith('.') || text === '.')) {
    if (text.trim() === '') return { ...next, hoursHundredths: 0, [unit === 'hours' ? 'lessons' : 'hours']: '' }
    return next
  }
  const parsed = parseQuantity(text, unit)
  if (parsed.error !== undefined) return { ...next, error: validate ? parsed.error : '' }
  next.hoursHundredths = parsed.value
  const other = unit === 'hours' ? 'lessons' : 'hours'
  next[other] = parsed.value === 0 ? '' : other === 'hours' ? hours(parsed.value) : lessons(parsed.value)
  if (validate) next[unit] = parsed.value === 0 ? '' : unit === 'hours' ? hours(parsed.value) : lessons(parsed.value)
  return next
}
export function entriesOf(rows: Row[]): Entry[] {
  return rows.map(({ gradeId, classSize, hoursHundredths }) => ({ gradeId, classSize, hoursHundredths }))
}
interface Props {
  rows: Row[]
  setRow: (index: number, unit: Quantity, value: string, validate?: boolean) => void
  openGroups: number[]
  setOpenGroups: (value: number[]) => void
  openGrades: number[]
  setOpenGrades: (value: number[]) => void
  onClear: () => void
  onCalculate: () => void
  error: string
}
export default function InputEditor({ rows, setRow, openGroups, setOpenGroups, openGrades, setOpenGrades, onClear, onCalculate, error }: Props) {
  const total = rows.reduce((sum, r) => sum + r.hoursHundredths, 0)
  const totalSafe = Number.isSafeInteger(total)
  const gradeCount = new Set(rows.filter(r => r.hoursHundredths > 0).map(r => r.gradeId)).size
  const hasPending = rows.some(r => r.error || parseQuantity(r[r.last], r.last).error || r[r.last].endsWith('.'))
  const toggle = (items: number[], id: number) => items.includes(id) ? items.filter(x => x !== id) : [...items, id]
  return <section className="card input-card" aria-labelledby="entry-heading">
    <div className="section-heading">
      <div className="title-with-icon"><span className="icon-box"><BookOpen size={20} /></span><div><h2 id="entry-heading">课时录入</h2><p>按实际年级填写本月授课量</p></div></div>
      <button className="text-button muted" onClick={onClear}><Trash2 size={15} />清空课时</button>
    </div>
    <div className="input-tip"><ArrowRightLeft size={15} /><span>节数、小时均可输入，自动换算</span><strong>1 节 = 2 小时</strong></div>
    <div className="groups">
      {GROUPS.map((group, groupId) => {
        const subtotal = rows.filter(r => (group.grades as readonly number[]).includes(r.gradeId)).reduce((sum, r) => sum + r.hoursHundredths, 0)
        const open = openGroups.includes(groupId)
        return <div className={`grade-group ${open ? 'is-open' : ''}`} key={group.name}>
          <button className="group-toggle" aria-expanded={open} aria-controls={`group-${groupId}`} onClick={() => setOpenGroups(toggle(openGroups, groupId))}>
            <span className={`group-number group-color-${groupId}`}>0{groupId + 1}</span>
            <span className="group-title"><strong>{group.name}</strong><small>{group.short}</small></span>
            <span className="group-hours">{Number.isSafeInteger(subtotal) ? hours(subtotal) : '—'} <small>小时</small></span><ChevronDown className={open ? 'rotated' : ''} size={17} />
          </button>
          <div id={`group-${groupId}`} hidden={!open} className="group-content">
            {group.grades.map(gradeId => {
              const gradeOpen = openGrades.includes(gradeId)
              const gradeRows = rows.filter(r => r.gradeId === gradeId)
              const gradeTotal = gradeRows.reduce((sum, r) => sum + r.hoursHundredths, 0)
              return <div className="grade" key={gradeId}>
                <button className="grade-toggle" aria-expanded={gradeOpen} aria-controls={`grade-${gradeId}`} onClick={() => setOpenGrades(toggle(openGrades, gradeId))}>
                  <span>{GRADES[gradeId]}{gradeRows.some(r => r.error) && <span className="error-dot"> · 输入有误</span>}</span>
                  <span>{gradeTotal > 0 && <small>{Number.isSafeInteger(gradeTotal) ? hours(gradeTotal) : '—'} 小时</small>}<ChevronDown size={15} className={gradeOpen ? 'rotated' : ''} /></span>
                </button>
                <div id={`grade-${gradeId}`} hidden={!gradeOpen}>
                  <div className="input-columns"><span>班型</span><span>节数 <small>（节）</small></span><span aria-hidden="true" /><span>小时数 <small>（小时）</small></span></div>
                  {gradeRows.map(row => {
                    const index = gradeId * 3 + row.classSize - 1
                    const key = rowKey(row)
                    return <div key={key} className="input-row-wrap">
                      <div className="input-row">
                        <span className="class-label"><span className={`class-dot class-${row.classSize}`} />{CLASS_NAMES[row.classSize]}</span>
                        {(['lessons', 'hours'] as const).map((unit, unitIndex) => <div className="quantity-cell" key={unit}>
                          {unitIndex === 1 && <ArrowRightLeft className="conversion-icon" size={13} aria-hidden="true" />}
                          <input id={`${key}-${unit}`} aria-label={`${GRADES[gradeId]}${CLASS_NAMES[row.classSize]}${unit === 'hours' ? '小时数' : '节数'}`}
                            aria-invalid={Boolean(row.error) && row.last === unit} aria-describedby={row.error ? `${key}-error` : undefined}
                            inputMode="decimal" autoComplete="off" placeholder="0" value={row[unit]}
                            onChange={e => setRow(index, unit, e.target.value)} onBlur={e => setRow(index, unit, e.target.value, true)} />
                        </div>)}
                      </div>
                      {row.error && <p className="field-error" id={`${key}-error`} role="alert">{row.error}</p>}
                    </div>
                  })}
                </div>
              </div>
            })}
          </div>
        </div>
      })}
    </div>
    <div className="entry-footer">
      <div className="entry-totals"><span>已录入 <strong>{gradeCount}</strong> 个年级</span><span><strong>{totalSafe ? hours(total) : '—'}</strong> 小时 <i>/</i> {totalSafe ? lessons(total) : '—'} 节</span></div>
      <div className="class-totals">{CLASSES.map(size => { const sum = rows.filter(r => r.classSize === size).reduce((n, r) => n + r.hoursHundredths, 0); return <span key={size}>{CLASS_NAMES[size]} <b>{Number.isSafeInteger(sum) ? hours(sum) : '—'}</b> 小时</span> })}</div>
      {hasPending && <p className="field-note">合计暂按最近一次合法输入展示，请完成输入后计算。</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="primary-button calculate-button" onClick={onCalculate}>计算课时费 <span aria-hidden="true">→</span></button>
      <p className="privacy-note"><Info size={13} />课时与结果仅在本页保留，刷新后清空</p>
    </div>
  </section>
}
