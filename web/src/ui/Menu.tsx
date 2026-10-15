import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

// One menu behaviour everywhere: a single open menu, Escape and outside pointer close it,
// arrow keys move between items, and focus returns to the trigger.
const OPEN_EVENT = 'storytool-menu-open'
const CloseContext = createContext<() => void>(() => {})

export function Menu({ label, ariaLabel, children, align = 'end', className = '', triggerClassName = 'ui-btn ui-btn-secondary', panelClassName = '' }: {
  label: ReactNode; ariaLabel?: string; children: ReactNode; align?: 'start' | 'end'
  className?: string; triggerClassName?: string; panelClassName?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = (focusTrigger = true) => { setOpen(false); if (focusTrigger) trigger.current?.focus() }
  useEffect(() => {
    const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setOpen(false) }
    document.addEventListener(OPEN_EVENT, other)
    return () => document.removeEventListener(OPEN_EVENT, other)
  }, [id])
  useEffect(() => {
    if (!open) return
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])
      if (!items.length) return
      event.preventDefault()
      const index = items.indexOf(document.activeElement as HTMLElement)
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keys)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keys) }
  }, [open, id])
  return <div ref={root} className={`ui-menu ${className}`}>
    <button ref={trigger} type="button" className={triggerClassName} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} onClick={() => setOpen(value => !value)}>{label}</button>
    {open && <div id={`${id}-menu`} role="menu" className={`ui-menu-panel ui-menu-${align} ${panelClassName}`}>
      <CloseContext.Provider value={() => close(false)}>{children}</CloseContext.Provider>
    </div>}
  </div>
}

export function MenuItem({ children, onSelect, disabled, title, className = '' }: { children: ReactNode; onSelect: () => void; disabled?: boolean; title?: string; className?: string }) {
  const close = useContext(CloseContext)
  return <button type="button" role="menuitem" className={`ui-menu-item ${className}`} disabled={disabled} title={title} onClick={() => { close(); onSelect() }}>{children}</button>
}

export function MenuLink({ children, href, className = '' }: { children: ReactNode; href: string; className?: string }) {
  const close = useContext(CloseContext)
  return <a role="menuitem" href={href} className={`ui-menu-item ${className}`} onClick={close}>{children}</a>
}
