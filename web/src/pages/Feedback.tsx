import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type ProductFeedbackInput } from '../api/client'
import { errorText } from '../api/errors'
import { ReaderCalibration } from '../components/ReaderCalibration'
import { t } from '../i18n'

export default function Feedback() {
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<ProductFeedbackInput['category']>('other')
  const admin = useQuery({ queryKey: ['admin-status'], queryFn: api.adminStatus })
  const feedback = useQuery({ queryKey: ['product-feedback'], queryFn: api.listProductFeedback, enabled: admin.data?.is_admin === true })
  const funnel = useQuery({ queryKey: ['funnel-counts'], queryFn: api.funnelCounts, enabled: admin.data?.is_admin === true })
  const tryFunnel = useQuery({ queryKey: ['try-funnel-counts'], queryFn: api.tryFunnelCounts, enabled: admin.data?.is_admin === true })
  const send = useMutation({
    mutationFn: () => api.sendProductFeedback({ message: message.trim(), category }),
    onSuccess: () => { setMessage(''); if (admin.data?.is_admin) void feedback.refetch() },
  })
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-[var(--ink)] sm:px-8">
      <header>
        <p className="eyebrow">{t('PRODUCT FEEDBACK')}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{t('Help make StoryTool better.')}</h1>
        <p className="mt-5 leading-7 text-[var(--muted)]">{t('Report a bug, suggest an improvement, or tell us what works. Your feedback is private to the site admins. For story reviews, use Check my story inside your story.')}</p>
      </header>
      <form className="mt-8 space-y-5" onSubmit={(event) => { event.preventDefault(); send.mutate() }}>
        <label className="block text-sm">{t('Category (optional)')}
          <select disabled={send.isPending} value={category} onChange={(event) => { setCategory(event.target.value as ProductFeedbackInput['category']); send.reset() }} className="mt-2 block rounded-md border border-[var(--line)] bg-[var(--surface)] p-3">
            <option value="other">{t('Other / not sure')}</option><option value="bug">{t('Bug')}</option><option value="suggestion">{t('Suggestion')}</option>
          </select>
        </label>
        <label className="block text-sm">{t('Your feedback')}
          <textarea required disabled={send.isPending} maxLength={4000} rows={6} value={message} onChange={(event) => { setMessage(event.target.value); send.reset() }} className="mt-2 block w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 leading-6" placeholder={t('What happened, or what would help you?')} />
        </label>
        <button type="submit" disabled={!message.trim() || send.isPending} className="landing-primary disabled:opacity-40">{send.isPending ? t('Sending…') : t('Send product feedback')}</button>
        {send.isSuccess && <p role="status" className="text-sm text-[var(--accent)]">{t('Thank you. Your feedback has been saved.')}</p>}
        {send.error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(send.error)}</p>}
      </form>
      {admin.error && <p role="alert" className="mt-8 text-sm">{t('Could not check admin access.')}{' '}<button type="button" className="underline" onClick={() => void admin.refetch()}>{t('Try again')}</button></p>}
      {admin.data?.is_admin && <>
        <ReaderCalibration />
        <section className="mt-12" aria-labelledby="funnel-title">
          <h2 id="funnel-title" className="text-xl font-semibold">{t('Writer funnel')}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t('Since tracking began: unique browsers, then new accounts reaching each stage. Demo scenes are excluded. AI means a provider connection saved or OAuth access granted; it can happen before the scene is created.')}</p>
          {funnel.isPending && <p className="mt-3 text-sm">{t('Loading counts…')}</p>}
          {funnel.error && <p role="alert" className="mt-3 text-sm">{errorText(funnel.error)}</p>}
          {funnel.data && <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{([
            [t('Visit'), funnel.data.visit], [t('Signup'), funnel.data.signup], [t('First scene'), funnel.data.first_scene], [t('AI connected'), funnel.data.ai_connected],
          ] as const).map(([label, count]) => <div key={label} className="rounded-lg border border-[var(--line)] p-4"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-2 text-2xl font-semibold">{count}</dd></div>)}</dl>}
        </section>
        <section className="mt-12" aria-labelledby="feedback-title">
          <h2 className="text-xl font-semibold">{t('Guided sandbox funnel')}</h2>
          <p className="writer-help">{t('Unique browsers per milestone; signup means a new account from a browser that started the sandbox. Targets: tour completion >50% and signup >15%.')}</p>
          {tryFunnel.error && <p role="alert">{errorText(tryFunnel.error)}</p>}
          {tryFunnel.data && <><dl className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(tryFunnel.data).map(([kind, count]) => <div key={kind} className="rounded-lg border border-[var(--line)] p-3"><dt className="text-xs">{kind.replace('try_', '').replaceAll('_', ' ')}</dt><dd className="text-xl">{count}</dd></div>)}</dl><p className="writer-help">{t('Tour completion: {0}% · Sandbox → signup: {1}%', tryFunnel.data.try_start ? ((tryFunnel.data.try_step_6 / tryFunnel.data.try_start) * 100).toFixed(1) : '0', tryFunnel.data.try_start ? ((tryFunnel.data.try_signup / tryFunnel.data.try_start) * 100).toFixed(1) : '0')}</p></>}
          <div className="flex items-center justify-between gap-3"><h2 id="feedback-title" className="text-xl font-semibold">{t('Latest product feedback')}</h2><button type="button" className="text-sm underline" onClick={() => { void feedback.refetch(); void funnel.refetch(); void tryFunnel.refetch() }}>{t('Refresh')}</button></div>
          {feedback.isPending && <p className="mt-4 text-sm">{t('Loading feedback…')}</p>}
          {feedback.error && <p role="alert" className="mt-4 text-sm">{errorText(feedback.error)}</p>}
          {feedback.data?.length === 0 && <p className="mt-4 text-sm text-[var(--muted)]">{t('No feedback yet.')}</p>}
          <ul className="mt-4 space-y-3">{feedback.data?.map((item) => <li key={item.id} className="rounded-lg border border-[var(--line)] p-4"><p className="text-xs text-[var(--muted)]">{item.category} · {new Date(item.created_at).toLocaleString()} · {item.user_id ?? t('deleted user')}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.message}</p></li>)}</ul>
        </section>
      </>}
      <p className="mt-12 text-sm text-[var(--muted)]"><Link to="/library" className="underline">{t('← Your stories')}</Link></p>
    </main>
  )
}
