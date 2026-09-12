import { Check, ChevronDown, Clock3, FileText, Layers3, ReceiptText, ShieldCheck, Table2 } from 'lucide-react'
import { CLASS_NAMES, decimal, GRADES, GROUPS, hours, lessons, money, TIERS } from './domain'
import type { Result } from './domain'

export function monthLabel(month: string): string { const [year, m] = month.split('-'); return `${year} 年 ${Number(m)} 月` }
export function timeLabel(time: string): string { return new Date(time).toLocaleString('zh-CN', { hour12: false }) }
export function ResultSummary({ result, stale }: { result: Result | null; stale: boolean }) {
  return <aside className="summary-column">
    <section className="summary-card" aria-labelledby="summary-title">
      <div className="summary-top"><span id="summary-title"><ReceiptText size={18} />{result ? `${monthLabel(result.input.month)}结算` : '本月结算概览'}</span><span className="summary-status">{result ? stale ? '上次计算' : <><Check size={12} />已计算</> : '待计算'}</span></div>
      <p className="amount-label">{stale ? '上次计算的月度课时费' : '月度课时费'}</p>
      <div className="main-amount" data-testid="total-fee"><span>¥</span>{result ? money(result.totalFeeCents) : '—'}</div>
      <p className="amount-caption">{result ? result.totalHoursHundredths === 0 ? '本月暂无授课' : '每一份付出，都有清楚的记录。' : '填写课时后点击计算'}</p>
      <div className="summary-stats"><div><span>实际授课</span><p><strong>{result ? hours(result.totalHoursHundredths) : '—'}</strong> 小时</p></div><div><span>折算课时</span><p><strong>{result ? result.totalLessons : '—'}</strong> 节</p></div></div>
      {result && <p className="calculation-time"><Clock3 size={12} />计算于 {timeLabel(result.calculatedAt)}</p>}
    </section>
    {stale && <div className="notice stale-notice" role="status">输入或规则已变化，请重新计算。下方明细和计费表为上次计算快照。</div>}
    <div className="privacy-card"><ShieldCheck size={21} /><div><strong>数据留在你的浏览器</strong><p>无需登录，课时与结算结果不上传。<br />仅计费配置保存到当前浏览器。</p></div></div>
  </aside>
}
export function Settlement({ result, stale }: { result: Result; stale: boolean }) {
  return <div className="settlement" key={result.calculatedAt}>
    <section className="card input-snapshot" aria-labelledby="snapshot-heading">
      <div className="section-heading"><div className="title-with-icon"><span className="icon-box"><FileText size={20} /></span><div><h2 id="snapshot-heading">{stale ? '上次计算 · 录入摘要' : '本次录入摘要'}</h2><p>{monthLabel(result.input.month)} · 按实际年级与班型核对</p></div></div><span className="subtle-badge">{result.input.entries.length} 项授课记录</span></div>
      {result.input.entries.length === 0 ? <p className="empty-inline">本月暂无授课</p> : <div className="snapshot-grid">{result.input.entries.map(entry => <div className="snapshot-item" key={`${entry.gradeId}-${entry.classSize}`}><div><strong>{GRADES[entry.gradeId]}</strong><span>{CLASS_NAMES[entry.classSize]}</span></div><p>{hours(entry.hoursHundredths)} 小时 <span>/ {lessons(entry.hoursHundredths)} 节</span></p></div>)}</div>}
    </section>
    <section className="card detail-card" aria-labelledby="details-heading">
      <div className="section-heading"><div className="title-with-icon"><span className="icon-box"><Layers3 size={20} /></span><div><h2 id="details-heading">{stale ? '上次计算 · 阶梯明细' : '阶梯结算明细'}</h2><p>按全月累计工时分配，每一笔都可核对</p></div></div><span className="subtle-badge">共 6 个阶梯</span></div>
      <div className="tier-list">{result.tiers.map(tier => <details className="tier-details" key={tier.tierId} open={tier.hoursHundredths > 0}>
        <summary><span className={`tier-index ${tier.hoursHundredths ? 'used' : ''}`}>{String(tier.tierId + 1).padStart(2, '0')}</span><strong>{TIERS[tier.tierId]}</strong><span className="tier-usage">已占 {hours(tier.hoursHundredths)} 小时</span><span className="tier-amount">¥{money(tier.feeCents)}</span><ChevronDown size={17} /></summary>
        <div className="tier-body">{tier.details.length === 0 ? <p className="empty-inline">本阶梯未使用</p> : <>
          <p className="tier-composition">{tier.details.map(d => `${GRADES[d.gradeId]}${CLASS_NAMES[d.classSize]} ${hours(d.hoursHundredths)} 小时`).join(' ＋ ')}</p>
          <div className="table-scroll" role="region" aria-label={`第${tier.tierId + 1}阶梯明细表`} tabIndex={0}><table className="detail-table"><thead><tr><th>年级 / 班型</th><th>累计占用区间</th><th>分配小时</th><th>基础单价</th><th>系数</th><th>计算公式</th><th>金额（元）</th></tr></thead><tbody>{tier.details.map(d => <tr key={`${d.gradeId}-${d.classSize}`}><td><strong>{GRADES[d.gradeId]} · {CLASS_NAMES[d.classSize]}</strong><small>计费组：{GROUPS[d.gradeGroupId].name}</small></td><td>({hours(d.startHundredths)}, {hours(d.endHundredths)}] 小时</td><td>{hours(d.hoursHundredths)}</td><td>¥{money(d.rateCents)}</td><td>×{(d.multiplier / 10).toFixed(1)}</td><td>{hours(d.hoursHundredths)} × {decimal(d.rateCents, 2)} × {(d.multiplier / 10).toFixed(1)}</td><td className="fee-cell">{money(d.feeCents)}</td></tr>)}</tbody></table></div>
        </>}</div>
      </details>)}</div>
      <div className="settlement-total"><span>阶梯小计合计{stale && '（上次计算）'}<small>{result.tiers.filter(t => t.hoursHundredths > 0).map(t => money(t.feeCents)).join(' + ') || '0.00'} = {money(result.totalFeeCents)} 元</small></span><strong>¥{money(result.totalFeeCents)}</strong></div>
    </section>
    <section className="card rate-card" aria-labelledby="rates-heading" data-testid="snapshot-rates">
      <div className="section-heading"><div className="title-with-icon"><span className="icon-box"><Table2 size={20} /></span><div><h2 id="rates-heading">{stale ? '上次计算 · 完整计费表' : '本次计费表'}</h2><p>元／小时，一对一基准 · 本次计算使用的完整价格</p></div></div><span className="subtle-badge">价格快照</span></div>
      <div className="table-scroll" role="region" aria-label="本次完整计费表" tabIndex={0}><table className="rate-table"><thead><tr><th>累计授课小时</th>{GROUPS.map(g => <th key={g.name}>{g.name}</th>)}</tr></thead><tbody>{result.config.rates.map((row, i) => <tr key={i}><th>{TIERS[i]}</th>{row.map((rate, j) => <td key={j} data-testid={`snapshot-price-${i}-${j}`}>{money(rate)}</td>)}</tr>)}</tbody></table></div>
      <div className="snapshot-notes"><p><strong>班型与时长</strong>一对一 ×1.0 / 一对二 ×1.2 / 一对三 ×1.3；每节 2 小时，多人班不按人数累计工时。</p><p><strong>填充顺序</strong>一年级 → 二年级 → 三年级 → 四年级 → 五年级 → 六年级 → 初一 → 初二 → 初三 → 高一 → 高二 → 高三；同年级按一对一 → 一对二 → 一对三。</p><p><strong>舍入口径</strong>基础单价乘系数不提前舍入；每条最终明细十进制四舍五入到分，阶梯小计与总额相加已舍入金额。</p><div className="snapshot-meta"><span>配置版本：{result.config.configRevision}</span><span>配置时间：{timeLabel(result.config.updatedAt)}</span><span>计算时间：{timeLabel(result.calculatedAt)}</span><span>规则版本：{result.config.ruleVersion}</span></div></div>
    </section>
  </div>
}
