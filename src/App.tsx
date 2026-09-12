import { useState } from 'react'
import { BookOpen, CalendarDays, CheckCircle2, CircleHelp, SlidersHorizontal } from 'lucide-react'
import { calculate, GROUPS, validMonth } from './domain'
import type { Config, Quantity, Result } from './domain'
import { loadConfig } from './config'
import InputEditor, { emptyRows, entriesOf, rowKey, updateRow } from './InputEditor'
import Settings from './Settings'
import BillingHelp from './BillingHelp'
import MonthLabel from './MonthLabel'
import { ResultSummary, Settlement } from './Results'

function localMonth() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` }
export default function App() {
  const [initial] = useState(() => loadConfig(() => window.localStorage))
  const [config, setConfig] = useState(initial.config)
  const [configWarning, setConfigWarning] = useState(initial.warning)
  const [month, setMonth] = useState(localMonth)
  const [monthChanged, setMonthChanged] = useState(false)
  const [rows, setRows] = useState(emptyRows)
  const [result, setResult] = useState<Result | null>(null)
  const [stale, setStale] = useState(false)
  const [modal, setModal] = useState<{ view: 'help' | 'settings'; trigger: HTMLElement } | null>(null)
  const [openGroups, setOpenGroups] = useState([0])
  const [openGrades, setOpenGrades] = useState([0])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sessionConfig, setSessionConfig] = useState(false)
  const dirty = () => { if (result) setStale(true); setNotice('') }
  function setRow(index: number, unit: Quantity, value: string, validate = false) {
    if (!validate) dirty()
    setRows(current => current.map((row, i) => i === index ? updateRow(row, unit, value, validate) : row))
    setError('')
  }
  function onCalculate() {
    const validated = rows.map(row => updateRow(row, row.last, row[row.last], true))
    setRows(validated)
    if (!validMonth(month)) { setError('请选择有效的结算月份'); document.getElementById('month')?.focus(); return }
    const first = validated.find(row => row.error)
    if (first) {
      const groupId = GROUPS.findIndex(g => (g.grades as readonly number[]).includes(first.gradeId))
      setOpenGroups(current => [...new Set([...current, groupId])])
      setOpenGrades(current => [...new Set([...current, first.gradeId])])
      setError('有课时输入不合法，请修正标记的输入项后再计算。')
      requestAnimationFrame(() => { const field = document.getElementById(`${rowKey(first)}-${first.last}`); field?.focus(); field?.scrollIntoView({ block: 'center', behavior: 'smooth' }) })
      return
    }
    try {
      setResult(calculate({ month, entries: entriesOf(validated) }, config, new Date().toISOString()))
      setStale(false)
      setError('')
      setNotice('计算完成，可在下方核对阶梯明细与本次计费表。')
    } catch (e) { setError(e instanceof Error ? e.message : '计算失败，请检查输入') }
  }
  function clear() {
    if (rows.some(r => r.hours || r.lessons) && !window.confirm('确定清空全部课时与结算结果？月份和已保存的计费配置会保留。')) return
    setRows(emptyRows()); setResult(null); setStale(false); setError(''); setNotice('课时与结果已清空。'); setMonthChanged(false)
  }
  function applyConfig(next: Config, persisted: boolean) {
    setConfig(next); setSessionConfig(!persisted); setConfigWarning(''); setModal(null)
    if (result) setStale(true)
    setNotice(persisted ? '计费配置已保存并应用。' : '价格仅本次使用，刷新后不会保留。')
  }
  return <>
    <header className="site-header"><div className="header-inner"><a href="#" className="brand" aria-label="课时小账首页"><span className="brand-icon"><BookOpen size={22} /></span><span>课时小账<small>LESSON LEDGER</small></span></a><div className="header-right"><span className="local-badge"><span />本地计算，安心记录</span><button className="help-button" aria-haspopup="dialog" onClick={e => setModal({ view: 'help', trigger: e.currentTarget })}><CircleHelp size={16} />计费说明</button></div></div></header>
    <main>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span />记录教学，也记录收获</div>
          <h1>月度课时费计算器</h1>
          <p>把每一节课，算得明明白白。</p>
        </div>
        <div className="heading-actions">
          <MonthLabel />
          <div className="month-picker">
            <CalendarDays size={18} />
            <input id="month" type="month" value={month} min="0001-01" max="9999-12" aria-describedby="month-hint" aria-invalid={!validMonth(month)} onChange={e => { setMonth(e.target.value); setMonthChanged(true); dirty() }} />
          </div>
          <button className="secondary-button settings-button" aria-haspopup="dialog" onClick={e => setModal({ view: 'settings', trigger: e.currentTarget })}><SlidersHorizontal size={16} />计费设置</button>
        </div>
      </div>
      {configWarning && <div className="notice warning-notice" role="alert">{configWarning}</div>}
      {sessionConfig && <div className="notice warning-notice" role="status">当前价格仅本次使用，刷新后不会保留。</div>}
      {monthChanged && <div className="notice month-notice" role="status">已切换结算月份，课时尚未清空。请核对并修改本月课时；月份不自动加载历史记录或价格。</div>}
      <div className="workspace"><InputEditor rows={rows} setRow={setRow} openGroups={openGroups} setOpenGroups={setOpenGroups} openGrades={openGrades} setOpenGrades={setOpenGrades} onClear={clear} onCalculate={onCalculate} error={error} /><ResultSummary result={result} stale={stale} /></div>
      <div className="live-notice" role="status" aria-live="polite">{notice && <><CheckCircle2 size={16} />{notice}</>}</div>
      {result ? <Settlement result={result} stale={stale} /> : <section className="empty-result"><div className="empty-icon"><ReceiptIllustration /></div><div><h2>明细清楚，结算心中有数</h2><p>填写课时后点击计算，查看阶梯明细与完整计费表。</p></div><span className="empty-pill">等待你的第一笔记录</span></section>}
      <footer className="site-footer"><span><BookOpen size={15} />课时小账 <i>·</i> 认真记录每一份付出</span><p>月度课时费不含底薪、奖金或税费，不等同于实发工资。</p></footer>
    </main>
    {modal?.view === 'help' && <BillingHelp config={config} returnFocus={modal.trigger} onClose={() => setModal(null)} onEditRates={() => setModal({ ...modal, view: 'settings' })} />}
    {modal?.view === 'settings' && <Settings config={config} returnFocus={modal.trigger} onClose={() => setModal(null)} onApply={applyConfig} />}
  </>
}
function ReceiptIllustration() { return <svg width="42" height="48" viewBox="0 0 42 48" fill="none" aria-hidden="true"><path d="M9 4h24v39l-4-3-4 3-4-3-4 3-4-3-4 3V4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M15 13h12M15 20h12M15 27h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="30" cy="31" r="9" fill="#edf4ee" stroke="currentColor" strokeWidth="1.5"/><path d="m26 31 3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
