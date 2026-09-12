import { useEffect, useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'

export default function MonthLabel() {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    function dismissWithEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissWithEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissWithEscape)
    }
  }, [open])

  return (
    <div className="month-label" ref={container} onPointerLeave={() => {
      if (!container.current?.contains(document.activeElement)) setOpen(false)
    }} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <label htmlFor="month">结算月份</label>
      <button type="button" className="month-help-button" aria-label="结算月份说明" aria-describedby="month-hint"
        onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true) }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>
        <CircleHelp size={14} />
      </button>
      <span id="month-hint" className="month-tooltip" role="tooltip" hidden={!open}>用于标记本次结算所属月份，不影响计费价格</span>
    </div>
  )
}
