import { useEffect, useRef } from 'react'

// Keep keyboard navigation within the modal and restore its opener on close.
export function useModal(returnFocusTarget?: HTMLElement) {
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef(returnFocusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    function containTab(event: KeyboardEvent) {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const controls = Array.from(element!.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter(control => !control.matches(':disabled, [tabindex="-1"]') && control.getClientRects().length > 0)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    element.addEventListener('keydown', containTab)
    const previous = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    // Compensate inside the page so the dialog backdrop still covers the full viewport.
    if (scrollbarWidth > 0) {
      const paddingRight = parseFloat(getComputedStyle(document.body).paddingRight) || 0
      document.body.style.paddingRight = `${paddingRight + scrollbarWidth}px`
    }
    document.body.style.overflow = 'hidden'
    return () => {
      element.removeEventListener('keydown', containTab)
      document.body.style.overflow = previous
      document.body.style.paddingRight = previousPaddingRight
      returnFocus.current?.focus({ preventScroll: true })
    }
  }, [])

  return dialog
}
