import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type RoadmapItem, type RoadmapInput } from '../api/client'
import { errorText } from '../api/errors'
import { t, tx } from '../i18n'

type Status = NonNullable<RoadmapInput['status']>
const LABELS: Record<Status, string> = { exploring: tx('Exploring'), planned: tx('Planned'), in_progress: tx('In progress'), delivered: tx('Delivered') }
const BADGE: Record<Status, string> = {
  in_progress: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  planned: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  exploring: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
}
const blank = (): RoadmapInput => ({ title: '', description: '', status: 'planned', hero: false, delivered_on: null })
const input = (item: RoadmapItem): RoadmapInput => ({ title: item.title, description: item.description, status: item.status, hero: item.hero, delivered_on: item.delivered_on })
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function Roadmap() {
  const qc = useQueryClient()
  const roadmap = useQuery({ queryKey: ['roadmap'], queryFn: api.listRoadmap })
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false })
  const admin = useQuery({ queryKey: ['admin-status', me.data?.id], queryFn: api.adminStatus, enabled: Boolean(me.data), retry: false })
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<RoadmapInput>(blank)
  const [baseline, setBaseline] = useState(() => JSON.stringify(blank()))
  const [message, setMessage] = useState('')
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const formRef = useRef<HTMLFormElement>(null)
  const save = useMutation({
    mutationFn: () => editing === 'new' ? api.createRoadmapItem(draft) : api.updateRoadmapItem(editing!, draft),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['roadmap'] })
      setEditing(null); setMessage(t('Roadmap saved.'))
    },
  })
  const open = (item?: RoadmapItem) => {
    if (editing && JSON.stringify(draft) !== baseline && !window.confirm(t('Discard unsaved roadmap changes?'))) return
    const next = item ? input(item) : blank()
    setDraft(next); setBaseline(JSON.stringify(next)); setEditing(item?.id ?? 'new'); save.reset(); setMessage('')
    requestAnimationFrame(() => { formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); formRef.current?.querySelector('input')?.focus({ preventScroll: true }) })
  }
  const cancel = () => {
    if (JSON.stringify(draft) !== baseline && !window.confirm(t('Discard unsaved roadmap changes?'))) return
    setEditing(null); save.reset()
  }
  const editButton = (item: RoadmapItem) => admin.data?.is_admin && <button type="button" disabled={save.isPending} className="ml-2 text-xs underline underline-offset-4" onClick={() => open(item)}>{t('Edit')}</button>
  const editor = <form ref={formRef} className="my-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4" onSubmit={event => { event.preventDefault(); save.mutate() }}>
    <fieldset disabled={save.isPending} className="space-y-3">
      <legend className="mb-3 font-semibold">{editing === 'new' ? t('Add roadmap item') : t('Edit roadmap item')}</legend>
      <label className="block text-sm">{t('Title')}<input required maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} className="mt-1 block w-full rounded border border-[var(--line)] bg-[var(--page)] p-2" /></label>
      <label className="block text-sm">{t('Description')}<textarea required maxLength={3000} rows={3} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} className="mt-1 block w-full rounded border border-[var(--line)] bg-[var(--page)] p-2" /></label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">{t('Status')}<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Status })} className="mt-1 block rounded border border-[var(--line)] bg-[var(--page)] p-2">{Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {draft.status === 'delivered' && <label className="text-sm">{t('Delivered date')}<input type="date" required value={draft.delivered_on ?? today} onChange={event => setDraft({ ...draft, delivered_on: event.target.value || null })} className="mt-1 block rounded border border-[var(--line)] bg-[var(--page)] p-2" /></label>}
        <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={draft.hero ?? false} onChange={event => setDraft({ ...draft, hero: event.target.checked })} />{t('Highlight as a hero feature')}</label>
      </div>
      {save.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{t('Could not save. {0}', errorText(save.error))}</p>}
      <div className="flex gap-3"><button type="submit" className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-[var(--button-ink)]">{save.isPending ? t('Saving…') : t('Save item')}</button><button type="button" onClick={cancel} className="text-sm underline">{t('Cancel')}</button></div>
    </fieldset>
  </form>
  const items = roadmap.data ?? []
  const upcoming = items.filter(item => item.status !== 'delivered')
  const dates = [...new Set(items.filter(item => item.status === 'delivered').map(item => item.delivered_on).filter((day): day is string => Boolean(day)))].sort().reverse()
  return <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
      <header className="mt-4 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('On the horizon')}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t('What we\'re building next.')}</h1>
        <p className="mt-5 text-base leading-7 text-slate-600 dark:text-slate-300">{t('StoryTool grows from what writers ask for. Here\'s what\'s on the way.')}</p>
        {admin.data?.is_admin && <button type="button" disabled={save.isPending} className="mt-4 rounded border border-[var(--line)] px-3 py-2 text-sm" onClick={() => open()}>{t('+ Add roadmap item')}</button>}
        {message && <p role="status" className="mt-2 text-sm text-[var(--accent)]">{message}</p>}
      </header>
      {editing === 'new' && editor}
      {roadmap.isPending && <p role="status" className="mt-8">{t('Loading roadmap…')}</p>}
      {roadmap.isError && <p role="alert" className="mt-8">{t('The roadmap could not be loaded.')}{' '}<button type="button" className="underline" onClick={() => { void roadmap.refetch() }}>{t('Retry')}</button></p>}
      <ul className="mt-8 space-y-3">{upcoming.map(item => <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{item.title}</h2><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[item.status ?? 'planned']}`}>{t(LABELS[item.status ?? 'planned'])}</span>{editButton(item)}</div>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
        {editing === item.id && editor}
      </li>)}</ul>
      {roadmap.isSuccess && !upcoming.length && <p className="mt-8 text-sm text-[var(--muted)]">{t('No upcoming work listed.')}</p>}
      <section className="mt-12" aria-labelledby="delivered-heading">
        <h2 id="delivered-heading" className="text-xl font-semibold tracking-tight">{t('Delivered')}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('What has shipped so far, newest first.')}</p>
        <ol className="mt-6 border-l-2 border-slate-200 dark:border-slate-800">{dates.map(day => <li key={day} className="relative pb-8 pl-6 last:pb-0">
          <span aria-hidden="true" className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-slate-50 dark:ring-slate-950" />
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">{dayLabel(day)}</p>
          <ul className="mt-2 space-y-2">{items.filter(item => item.status === 'delivered' && item.delivered_on === day).map(item => <li key={item.id} className="text-sm leading-6">
            <span className={item.hero ? 'rounded-full px-2 py-0.5 font-semibold ring-1 ring-emerald-400 dark:ring-emerald-600' : 'font-semibold'}>{item.title}</span>
            <span className="text-slate-600 dark:text-slate-300"> — {item.description}</span>{editButton(item)}
            {editing === item.id && editor}
          </li>)}</ul>
        </li>)}</ol>
      </section>
      <p className="mt-8 text-sm text-slate-500 dark:text-slate-400"><Link to="/" className="underline underline-offset-4 hover:text-slate-900 dark:hover:text-slate-100">{t('← Back to StoryTool')}</Link></p>
    </div>
  </main>
}
