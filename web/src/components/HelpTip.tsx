import type { ReactNode } from 'react'
import { t } from '../i18n'

/** A small ⓘ that explains jargon on hover (or keyboard focus / tap), and hides when you move away. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button type="button" aria-label={t('What is {0}?', label)} onClick={(event) => event.preventDefault()} className="ml-1 inline-flex size-5 items-center justify-center rounded-full border border-slate-400 text-xs leading-none text-slate-500 hover:border-slate-500 hover:text-slate-800 dark:border-slate-500 dark:text-slate-400 dark:hover:text-slate-100">{t('i')}</button>
      <span role="tooltip" className="pointer-events-none absolute left-0 top-6 z-30 hidden w-72 max-w-[80vw] rounded-md border border-slate-200 bg-white p-3 text-xs font-normal normal-case leading-5 tracking-normal text-slate-700 shadow-lg group-hover:block group-focus-within:block dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        {children}
      </span>
    </span>
  )
}
