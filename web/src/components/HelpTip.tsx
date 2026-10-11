import { useState, type ReactNode } from 'react'

/** A small ⓘ that explains jargon in place. Tap or click toggles it, so it works on phones too. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex align-middle">
      <button type="button" aria-label={`What is ${label}?`} aria-expanded={open} onClick={(event) => { event.preventDefault(); setOpen(!open) }} className="ml-1 inline-flex size-4 items-center justify-center rounded-full border border-slate-300 text-[10px] leading-none text-slate-500 hover:border-slate-500 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:text-slate-100">i</button>
      {open && (
        <span role="note" className="absolute left-0 top-6 z-30 w-72 max-w-[80vw] rounded-md border border-slate-200 bg-white p-3 text-xs font-normal normal-case leading-5 tracking-normal text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {children}
        </span>
      )}
    </span>
  )
}
