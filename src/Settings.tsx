import { useState } from 'react'
import { useModal } from './useModal'
import { Info, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { defaultConfig, decimal, GROUPS, parsePrice, TIERS } from './domain'
import type { Config } from './domain'
import { saveConfig } from './config'

interface Props { config: Config; onClose: () => void; onApply: (config: Config, persisted: boolean) => void; returnFocus?: HTMLElement }
export default function Settings({ config, onClose, onApply, returnFocus }: Props) {
  const dialog = useModal(returnFocus)
  const [draft, setDraft] = useState(() => config.rates.map(row => row.map(rate => decimal(rate, 2))))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState('')
  function apply(persist: boolean) {
    const nextErrors: Record<string, string> = {}
    const rates = draft.map((row, i) => row.map((text, j) => {
      const parsed = parsePrice(text)
      if (parsed.error !== undefined) { nextErrors[`${i}-${j}`] = parsed.error; return 0 }
      return parsed.value
    }))
    setErrors(nextErrors)
    const first = Object.keys(nextErrors)[0]
    if (first) { document.getElementById(`price-${first}`)?.focus(); return }
    const revision = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const next: Config = { ...config, rates, configRevision: `自定义 ${revision}`, updatedAt: new Date().toISOString() }
    if (persist) {
      try { saveConfig(next, () => window.localStorage) }
      catch { setSaveError('保存失败，当前价格尚未改变。请检查浏览器存储权限，或选择仅本次使用。'); return }
    }
    onApply(next, persist)
  }
  function restore() {
    if (!window.confirm('将编辑草稿中的 24 个单价恢复为默认价格？保存后才会正式应用。')) return
    setDraft(defaultConfig().rates.map(row => row.map(rate => decimal(rate, 2))))
    setErrors({})
    setSaveError('')
  }
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={onClose} onClose={onClose}>
    <div className="dialog-heading"><div className="title-with-icon"><span className="icon-box"><SlidersHorizontal size={20} /></span><div><h2 id="settings-title">计费设置</h2><p>自定义每个阶梯的基础时薪</p></div></div><button className="icon-button" aria-label="关闭计费设置" onClick={onClose}><X size={21} /></button></div>
    <div className="settings-intro"><span className="eyebrow">基础计费表</span><span>元／小时 · 一对一基准</span></div>
    <div className="dialog-body">
      <div className="price-editor">
        <div className="price-editor-header"><span>累计授课小时</span>{GROUPS.map(g => <span key={g.name}>{g.name}</span>)}</div>
        {TIERS.map((tier, i) => <section className="price-editor-row" key={tier} aria-label={`第${i + 1}阶梯价格`}>
          <h3><span className="tier-index">{i + 1}</span>{tier}</h3>
          {GROUPS.map((group, j) => <label key={group.name} className="price-field">
            <span className="mobile-price-label">{group.name}</span>
            <div className="price-input"><span aria-hidden="true">¥</span><input id={`price-${i}-${j}`} inputMode="decimal" autoComplete="off" aria-label={`第${i + 1}阶梯${group.name}单价`} value={draft[i][j]}
              aria-invalid={Boolean(errors[`${i}-${j}`])} aria-describedby={errors[`${i}-${j}`] ? `price-error-${i}-${j}` : undefined}
              onChange={e => { setDraft(current => current.map((row, r) => row.map((value, c) => r === i && c === j ? e.target.value : value))); setErrors(current => ({ ...current, [`${i}-${j}`]: '' })) }} /></div>
            {errors[`${i}-${j}`] && <small className="field-error" id={`price-error-${i}-${j}`}>{errors[`${i}-${j}`]}</small>}
          </label>)}
        </section>)}
      </div>
      <p className="settings-scope">仅调整基础单价；阶梯边界、年级分组、每节时长与班型系数固定。</p>
      <p className="local-notice"><Info size={16} />配置仅保存在当前站点、当前浏览器。清除浏览器数据或更换设备后不会自动恢复。月份仅作结算标签，不匹配历史价格。</p>
      <p className="revision">当前版本：{config.configRevision}</p>
      {saveError && <div className="notice error-notice" role="alert">{saveError}<button className="text-button" onClick={() => apply(false)}>仅本次使用（刷新后不保留）</button></div>}
    </div>
    <div className="dialog-footer"><button className="text-button restore-button" onClick={restore}><RotateCcw size={15} />恢复默认价格</button><div><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => apply(true)}>保存并应用</button></div></div>
  </dialog>
}
