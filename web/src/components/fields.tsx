import { useEffect, useRef, useState } from 'react'

/**
 * Inline editing primitives.
 *
 * Every entity in this tool is mostly-empty by design — a placeholder is just an incomplete
 * entity — so the common action is "fill in one field of something that already exists".
 * Modal forms would make that tedious, so fields edit in place and save on blur.
 *
 * Saving on blur rather than on a Save button matches the rest of the app (the prose editor
 * does the same) and means a half-filled entity is never lost to a forgotten click.
 */

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function useSaver<T>(onSave: (value: T) => Promise<unknown> | void) {
  const [state, setState] = useState<SaveState>('idle')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const save = async (next: T) => {
    setState('saving')
    try {
      await onSave(next)
      setState('saved')
      timer.current = window.setTimeout(() => setState('idle'), 1200)
    } catch {
      setState('error')
    }
  }
  return { state, save }
}

export function InlineText({
  value,
  placeholder,
  onSave,
  multiline = false,
  className = '',
}: {
  value: string | null
  placeholder: string
  onSave: (value: string | null) => Promise<unknown> | void
  multiline?: boolean
  className?: string
}) {
  const { state, save } = useSaver(onSave)
  const original = value ?? ''

  const shared = {
    defaultValue: original,
    placeholder,
    // Empty means "unset", not "empty string" — the API treats null as not-yet-filled.
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.target.value.trim()
      if (next !== original.trim()) void save(next === '' ? null : next)
    },
    className: [
      'w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm',
      'hover:border-slate-200 dark:hover:border-slate-700 focus:border-slate-400 dark:focus:border-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none',
      value ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 italic',
      className,
    ].join(' '),
  }

  return (
    <span className="relative block">
      {multiline ? (
        <textarea {...shared} rows={2} key={original} />
      ) : (
        <input {...shared} key={original} />
      )}
      {state === 'saving' && (
        <span className="absolute -top-3 right-0 text-[10px] text-slate-400">saving…</span>
      )}
      {state === 'saved' && (
        <span className="absolute -top-3 right-0 text-[10px] text-emerald-600 dark:text-emerald-300">saved</span>
      )}
      {state === 'error' && (
        <span className="absolute -top-3 right-0 text-[10px] text-red-600 dark:text-red-300">save failed</span>
      )}
    </span>
  )
}

export function InlineSelect({
  value,
  options,
  onSave,
  placeholder = '— not set —',
  highlight = false,
}: {
  value: string | null
  options: readonly (string | { value: string; label: string })[]
  onSave: (value: string | null) => Promise<unknown> | void
  placeholder?: string
  /** Draws attention when set, e.g. the protagonist among the cast. */
  highlight?: boolean
}) {
  const { state, save } = useSaver(onSave)
  return (
    <span className="relative inline-block">
      <select
        value={value ?? ''}
        onChange={(e) => void save(e.target.value || null)}
        className={[
          'rounded border px-1.5 py-0.5 text-xs capitalize',
          value
            ? highlight
              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
              : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'
            : 'border-slate-200 dark:border-slate-700 text-slate-400',
        ].join(' ')}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option
            key={typeof option === 'string' ? option : option.value}
            value={typeof option === 'string' ? option : option.value}
          >
            {typeof option === 'string' ? option.replace(/_/g, ' ') : option.label}
          </option>
        ))}
      </select>
      {state === 'saving' && (
        <span className="absolute -top-3 right-0 text-[10px] text-slate-400">…</span>
      )}
      {state === 'error' && (
        <span className="absolute -top-3 right-0 text-[10px] text-red-600 dark:text-red-300">save failed</span>
      )}
    </span>
  )
}

export function InlineNumber({
  value,
  onSave,
  min,
}: {
  value: number | null
  onSave: (value: number | null) => Promise<unknown> | void
  min?: number
}) {
  const { state, save } = useSaver(onSave)
  return (
    <span className="relative inline-block">
      <input
        key={value ?? 'empty'}
        type="number"
        min={min}
        defaultValue={value ?? ''}
        className="w-20 rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-sm"
        onBlur={(event) => {
          const next = event.target.value === '' ? null : Number(event.target.value)
          if (next !== value && (next === null || (Number.isFinite(next) && (min === undefined || next >= min)))) {
            void save(next)
          }
        }}
      />
      {state === 'error' && <span className="text-[10px] text-red-600 dark:text-red-300">save failed</span>}
    </span>
  )
}

export function DeleteButton({
  onConfirm,
  what,
}: {
  onConfirm: () => void
  what: string
}) {
  const [armed, setArmed] = useState(false)

  // Two-step rather than a browser confirm(): deletion here cascades (a chapter takes its
  // scenes' links with it), so it should take a deliberate second click, but a modal for
  // every row would be heavy.
  if (armed) {
    return (
      <span className="flex items-center gap-1.5">
        <button
          onClick={onConfirm}
          className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white"
        >
          delete {what}
        </button>
        <button
          onClick={() => setArmed(false)}
          className="text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          cancel
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => setArmed(true)}
      className="text-xs text-slate-300 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-300"
      aria-label={`Delete ${what}`}
    >
      ×
    </button>
  )
}

export function Chip({ complete, missing = [] }: { complete: boolean; missing?: readonly string[] }) {
  const label = (field: string) => field === 'pov_character_id' ? 'POV character' : field.replaceAll('_', ' ')
  if (!complete) return (
    <details className="relative shrink-0 text-[10px]">
      <summary aria-label="Placeholder — show missing details" className="cursor-pointer list-none rounded bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 uppercase tracking-wide text-amber-700 dark:text-amber-300 [&::-webkit-details-marker]:hidden">placeholder ⓘ</summary>
      <div className="absolute right-0 top-full z-30 mt-2 w-60 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 p-3 text-xs normal-case leading-5 text-slate-600 dark:text-slate-300 shadow-lg">
        <p className="font-semibold text-slate-800 dark:text-slate-100">Required details are still missing</p>
        {missing.length > 0 && <p className="mt-1">Fill in: {missing.map(label).join(', ')}.</p>}
        <p className="mt-2">Edit the fields on this card. The badge changes automatically when those details are filled. Draft status is a separate choice.</p>
      </div>
    </details>
  )
  return (
    <span
      title="Required structural details are filled. This does not mean the story or draft is finished."
      className={[
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
        complete ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
      ].join(' ')}
    >
      {complete ? 'complete' : 'placeholder'}
    </span>
  )
}

export function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-400 italic">{children}</span>
}

export function AddForm({
  placeholder,
  onAdd,
  pending = false,
}: {
  placeholder: string
  onAdd: (value: string) => Promise<unknown> | void
  pending?: boolean
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  return (
    <form
      className="flex gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!value.trim()) return
        setError(false)
        try {
          await onAdd(value.trim())
          setValue('')
        } catch {
          setError(true)
        }
      }}
    >
      <input
        className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm"
        placeholder={error ? 'Could not add; try again' : placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="submit"
        disabled={!value.trim() || pending}
        className="rounded bg-slate-900 dark:bg-slate-200 px-3 py-1.5 text-sm text-white dark:text-slate-950 disabled:opacity-40"
      >
        Add
      </button>
    </form>
  )
}
