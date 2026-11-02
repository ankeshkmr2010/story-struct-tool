import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type ProductFeedbackInput } from '../api/client'
import { errorText } from '../api/errors'
import { t } from '../i18n'

export default function Feedback() {
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<ProductFeedbackInput['category']>('other')
  const send = useMutation({
    mutationFn: () => api.sendProductFeedback({ message: message.trim(), category }),
    onSuccess: () => { setMessage('') },
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
      <p className="mt-12 text-sm text-[var(--muted)]"><Link to="/library" className="underline">{t('← Your stories')}</Link></p>
    </main>
  )
}
