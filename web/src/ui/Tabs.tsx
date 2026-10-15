import type { KeyboardEvent, ReactNode } from 'react'

export function Tabs<T extends string>({ items, value, onChange, label, className = '' }: { items: readonly { id: T; label: ReactNode; className?: string }[]; value: T; onChange: (id: T) => void; label: string; className?: string }) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = items.findIndex(item => item.id === value)
    const next = items[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]
    onChange(next.id)
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus()
  }
  return <div role="tablist" aria-label={label} className={`ui-tabs ${className}`} onKeyDown={move}>
    {items.map(item => <button key={item.id} type="button" role="tab" data-tab={item.id} aria-selected={item.id === value} tabIndex={item.id === value ? 0 : -1} className={`ui-tab ${item.className ?? ""}`} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>
}
