import { useEffect, useRef, type ReactNode } from 'react'

// Native modal dialog: focus trap, Escape and backdrop come from the browser.
export function Dialog({ open, onClose, title, children, className = '' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])
  return <dialog ref={dialog} className={`ui-dialog ${className}`} onClose={onClose} aria-label={typeof title === 'string' ? title : undefined}>
    {open && <>
      <div className="ui-dialog-head"><h2>{title}</h2><button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onClose}>Close</button></div>
      {children}
    </>}
  </dialog>
}
