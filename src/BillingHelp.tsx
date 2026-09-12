import { CircleHelp, SlidersHorizontal, X } from 'lucide-react'
import { GROUPS, money, TIERS } from './domain'
import type { Config } from './domain'
import { useModal } from './useModal'

interface Props {
  config: Config
  onClose: () => void
  onEditRates: () => void
  returnFocus?: HTMLElement
}

export default function BillingHelp({ config, onClose, onEditRates, returnFocus }: Props) {
  const dialog = useModal(returnFocus)

  return (
    <dialog ref={dialog} className="settings-dialog billing-help-dialog" aria-labelledby="billing-help-title" onCancel={onClose} onClose={onClose}>
      <div className="dialog-heading">
        <div className="title-with-icon">
          <span className="icon-box"><CircleHelp size={20} /></span>
          <div><h2 id="billing-help-title">计费说明</h2><p>了解工时如何分配、课时费如何计算</p></div>
        </div>
        <button className="icon-button" aria-label="关闭计费说明" onClick={onClose}><X size={21} /></button>
      </div>
      <div className="dialog-body billing-help-body">
        <section className="help-rates" aria-labelledby="help-rates-title">
          <div className="help-rates-heading">
            <div><h3 id="help-rates-title">当前计费阶梯表</h3><p>元／小时 · 一对一基准 · 当前生效价格</p></div>
            <button className="secondary-button" aria-haspopup="dialog" onClick={onEditRates}><SlidersHorizontal size={14} />修改阶梯表</button>
          </div>
          <div className="table-scroll help-rates-scroll" role="region" aria-label="当前计费阶梯表" tabIndex={0}>
            <table className="rate-table help-rate-table" aria-labelledby="help-rates-title">
              <thead><tr><th scope="col">累计授课小时</th>{GROUPS.map(group => <th scope="col" key={group.name}>{group.name}</th>)}</tr></thead>
              <tbody>{config.rates.map((rates, tierId) => <tr key={tierId}>
                <th scope="row">{TIERS[tierId]}</th>
                {rates.map((rate, groupId) => <td key={groupId}>{money(rate)}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
          <p className="help-table-hint">左右滑动可查看完整价格</p>
        </section>
        <ol className="billing-help-steps">
          <li>
            <span className="help-step-number">01</span>
            <div><h3>先换算实际授课工时</h3><p>每节课固定 2 小时。节数和小时数可双向换算；一对二、一对三也按实际授课时长记录，不乘学生人数。</p></div>
          </li>
          <li>
            <span className="help-step-number">02</span>
            <div><h3>低年级先填，同年级按班型排序</h3><p>按一年级至高三、实际年级从低到高分配。同年级按「一对一 → 一对二 → 一对三」依次填充；录入顺序不影响结果。</p></div>
          </li>
          <li>
            <span className="help-step-number">03</span>
            <div><h3>全月共享阶梯，超出部分进入下一档</h3><p>前 150 小时每 30 小时一档，超过 150 小时使用第六档，每月从零累计。同一项授课可以跨多个阶梯。</p><p className="help-example">例如，31 小时中有 30 小时使用第一档价格，剩余 1 小时使用第二档价格。</p></div>
          </li>
          <li>
            <span className="help-step-number">04</span>
            <div><h3>逐条计算到分，再汇总金额</h3><p>基础单价取对应年级组与阶梯的价格；一对一 ×1.0、一对二 ×1.2、一对三 ×1.3。</p><div className="help-formula">分段课时费 = 分配小时 × 基础单价 × 班型系数</div><p>中间结果不提前舍入，每条最终明细四舍五入到分，再相加得到阶梯小计与月度课时费。</p></div>
          </li>
        </ol>
        <p className="help-context">基础单价可在“计费设置”中查看和修改。月份仅作结算标签，不自动匹配历史价格；计算后可在结果末尾核对本次使用的完整计费表。</p>
      </div>
      <div className="dialog-footer billing-help-footer"><button className="primary-button" onClick={onClose}>我知道了</button></div>
    </dialog>
  )
}
