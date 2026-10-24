import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Shoutout, type ShoutoutInput } from '../api/client'
import { t } from '../i18n'

/**
 * The thank-you page. Entries live in the database; only the accounts listed in
 * STORYTOOL_ADMIN_EMAILS see the edit controls (the API enforces the same rule).
 */

const COLOURS: Record<string, string> = {
  rose: 'from-rose-500 via-fuchsia-500 to-violet-600',
  amber: 'from-amber-400 via-orange-500 to-rose-500',
  emerald: 'from-emerald-400 via-teal-500 to-cyan-600',
  sky: 'from-sky-400 via-blue-500 to-indigo-600',
  lime: 'from-lime-400 via-green-500 to-emerald-600',
  violet: 'from-violet-500 via-purple-500 to-fuchsia-600',
  slate: 'from-slate-500 via-slate-600 to-slate-800',
}

const BLANK: ShoutoutInput = { name: '', thanks: '', colour: 'rose', mark: '' }

function ShoutoutForm({ initial, onSave, onCancel }: { initial: ShoutoutInput; onSave: (value: ShoutoutInput) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const field = 'w-full rounded-lg bg-white/95 px-3 py-2 text-slate-900 placeholder:text-slate-400'
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault()
        setSaving(true)
        try { await onSave(value) } finally { setSaving(false) }
      }}
    >
      <input className={field} placeholder={t('Name')} value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} required maxLength={120} />
      <textarea className={field} placeholder={t('What you\'re thanking them for')} rows={3} value={value.thanks} onChange={(e) => setValue({ ...value, thanks: e.target.value })} required maxLength={2000} />
      <div className="flex flex-wrap gap-3">
        <select className={`${field} w-auto`} value={value.colour} onChange={(e) => setValue({ ...value, colour: e.target.value })} aria-label={t('Colour')}>
          {Object.keys(COLOURS).map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
        <input className={`${field} w-24`} placeholder={t('Emoji')} value={value.mark} onChange={(e) => setValue({ ...value, mark: e.target.value })} maxLength={16} aria-label={t('Emoji')} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-white px-4 py-2 font-semibold text-slate-900 disabled:opacity-60">{saving ? t('Saving…') : t('Save')}</button>
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 font-semibold text-white ring-1 ring-white/70">{t('Cancel')}</button>
      </div>
    </form>
  )
}

export default function Shoutouts() {
  const [items, setItems] = useState<Shoutout[] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [editing, setEditing] = useState<string | null>(null) // shoutout id, or 'new'
  const [error, setError] = useState<string | null>(null)

  const load = () => api.listShoutouts().then(setItems).catch(() => setError(t('Could not load the shoutouts.')))
  useEffect(() => {
    load()
    api.adminStatus().then((s) => setIsAdmin(s.is_admin)).catch(() => setIsAdmin(false))
  }, [])

  const act = async (action: () => Promise<unknown>) => {
    setError(null)
    try { await action(); setEditing(null); await load() } catch { setError(t('That change did not save. Try again.')) }
  }
  const move = (index: number, step: -1 | 1) => {
    if (!items) return
    const a = items[index], b = items[index + step]
    if (!b) return
    void act(async () => {
      await api.updateShoutout(a.id, { sort_key: b.sort_key })
      await api.updateShoutout(b.id, { sort_key: a.sort_key })
    })
  }
  const tool = 'rounded-md bg-white/20 px-2 py-1 text-xs font-semibold text-white hover:bg-white/30 disabled:opacity-40'

  return (
    <main className="min-h-screen bg-linear-to-br from-rose-50 via-amber-50 to-sky-50 text-slate-900 dark:from-slate-950 dark:via-violet-950 dark:to-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        <header className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-fuchsia-600 dark:text-fuchsia-300">
            {t('Thank you')}
          </p>
          <h1 className="mt-3 bg-linear-to-r from-rose-500 via-amber-500 to-sky-500 bg-clip-text text-5xl font-black tracking-tight text-transparent sm:text-7xl">
            {t('Shoutouts')}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-slate-700 dark:text-slate-300">
            {t('StoryTool is better because writers took the time to try it, challenge it, and make it better. This page is for them')}
          </p>
        </header>

        {error && <p role="alert" className="mt-8 text-center text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>}
        {items === null && !error && <p className="mt-12 text-center text-slate-500">{t('Loading…')}</p>}

        <ul className="mt-12 grid gap-5 sm:grid-cols-2">
          {items?.map((person, index) => (
            <li
              key={person.id}
              className={`relative overflow-hidden rounded-3xl bg-linear-to-br ${COLOURS[person.colour] ?? COLOURS.rose} p-6 text-white shadow-xl transition-transform hover:-translate-y-1 sm:p-8 ${index === 0 ? 'sm:col-span-2 sm:p-10' : ''}`}
            >
              <span aria-hidden="true" className="absolute -right-4 -top-6 text-8xl opacity-25 sm:text-9xl">
                {person.mark}
              </span>
              {editing === person.id ? (
                <ShoutoutForm
                  initial={{ name: person.name, thanks: person.thanks, colour: person.colour, mark: person.mark }}
                  onSave={(value) => act(() => api.updateShoutout(person.id, value))}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <p className="text-sm font-bold uppercase tracking-widest text-white/80">#{index + 1}</p>
                  <h2 className={`mt-2 font-black tracking-tight ${index === 0 ? 'text-4xl sm:text-5xl' : 'text-3xl'}`}>
                    {person.name}
                  </h2>
                  <p className={`mt-3 leading-relaxed text-white/95 ${index === 0 ? 'text-xl' : 'text-lg'}`}>
                    {person.thanks}
                  </p>
                  {isAdmin && (
                    <div className="relative mt-5 flex flex-wrap gap-2">
                      <button type="button" className={tool} onClick={() => setEditing(person.id)}>{t('Edit')}</button>
                      <button type="button" className={tool} disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('Move {0} up', person.name)}>↑</button>
                      <button type="button" className={tool} disabled={index === items.length - 1} onClick={() => move(index, 1)} aria-label={t('Move {0} down', person.name)}>↓</button>
                      <button type="button" className={tool} onClick={() => { if (window.confirm(t('Remove {0}?', person.name))) void act(() => api.deleteShoutout(person.id)) }}>{t('Delete')}</button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
          {isAdmin && items && (
            <li className="rounded-3xl border-2 border-dashed border-slate-300 p-6 dark:border-slate-700 sm:p-8">
              {editing === 'new' ? (
                <div className={`rounded-2xl bg-linear-to-br ${COLOURS.violet} p-5`}>
                  <ShoutoutForm initial={BLANK} onSave={(value) => act(() => api.createShoutout(value))} onCancel={() => setEditing(null)} />
                </div>
              ) : (
                <button type="button" onClick={() => setEditing('new')} className="h-full w-full text-lg font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
                  {t('+ Add a shoutout')}
                </button>
              )}
            </li>
          )}
        </ul>

        <h2 className="mx-auto mt-12 max-w-2xl text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('Built with feedback. Improved by writers. Always a work in progress')}
        </h2>

        <p className="mt-12 text-center text-sm text-slate-600 dark:text-slate-400">
          <Link to="/" className="underline underline-offset-4 hover:text-slate-900 dark:hover:text-slate-100">
            {t('← Back to StoryTool')}
          </Link>
        </p>
      </div>
    </main>
  )
}
