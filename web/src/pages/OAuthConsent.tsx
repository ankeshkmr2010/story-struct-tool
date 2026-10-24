import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { t, tx } from '../i18n'

const scopeLabels: Record<string, string> = {
  'story:read': tx('Read structure, characters, timeline, and story findings'),
  'prose:read': tx('Read scene prose, notes, and version previews'),
  'story:write': tx('Propose and apply edits; create named versions'),
  'versions:restore': 'Restore whole-story versions with recovery checkpoints',
}

export default function OAuthConsent() {
  const [params] = useSearchParams()
  const requestId = params.get('request_id') ?? ''
  const request = useQuery({ queryKey: ['oauth-consent', requestId], queryFn: () => api.getOAuthConsent(requestId), enabled: !!requestId, retry: false })
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false })
  const stories = useQuery({ queryKey: ['stories'], queryFn: api.listStories })
  const [storyId, setStoryId] = useState('')
  const [allowProse, setAllowProse] = useState(true)
  const [allowWrite, setAllowWrite] = useState(false)
  const [allowRestore, setAllowRestore] = useState(false)
  const [allowCreate, setAllowCreate] = useState(false)
  const [allowReadValidators, setAllowReadValidators] = useState(false)
  const [allowWriteValidators, setAllowWriteValidators] = useState(false)
  const [allowBetaWrite, setAllowBetaWrite] = useState(false)
  const library = storyId === '__library__'
  const readerRound = storyId.startsWith('round:') ? storyId.slice(6) : null
  const requested = request.data?.requested_scopes ?? []
  const scopes = readerRound ? ['beta:read'] : ['story:read', ...(allowProse ? ['prose:read'] : []), ...(allowWrite ? ['story:write'] : []), ...(allowWrite && allowProse && allowRestore ? ['versions:restore'] : []), ...(library ? ['library:read'] : []), ...(library && allowCreate ? ['story:create'] : []), ...(allowReadValidators || allowWriteValidators ? ['validators:read'] : []), ...(allowWriteValidators ? ['validators:write'] : []), ...(allowBetaWrite && requested.includes('beta:write') ? ['beta:write'] : [])].filter(scope => requested.includes(scope))
  const decide = useMutation({ mutationFn: (deny: boolean) => api.decideOAuthConsent(requestId, { story_id: deny || library || readerRound ? null : storyId, round_id: deny ? null : readerRound, scopes: deny ? [] : scopes, deny }), onSuccess: ({ redirect_url }) => window.location.assign(redirect_url) })
  return <main className="mx-auto max-w-xl px-5 py-10">
    <p className="text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('StoryTool connection')}</p>
    <h1 className="mt-3 text-2xl font-semibold">{t('Connect your AI client')}</h1>
    {!requestId && <p role="alert" className="mt-4 text-red-600 dark:text-red-300">{t('No connection request. Start again from your AI client\'s Connected Apps settings.')}</p>}
    {request.isPending && requestId && <p className="mt-4">{t('Loading connection request…')}</p>}
    {request.isError && <p role="alert" className="mt-4 text-red-600 dark:text-red-300">{t('{0} Start a new connection from your AI client.', errorText(request.error))}</p>}
    {request.data && <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <p className="break-words text-lg font-medium">{request.data.client_name}</p>
      <p className="mt-2 break-words text-sm text-slate-500 dark:text-slate-400">{t('Return address: {0}. The client supplies its display name; check that this address matches the app you are connecting.', request.data.redirect_host)}</p>
      <p className="mt-4 break-words text-sm">{t('Signed in as')}{' '}<strong>{me.data?.email}</strong></p>
      <label className="mt-5 block text-sm font-medium">{t('Choose access')}<select aria-label={t('Story to connect')} value={storyId} onChange={event => setStoryId(event.target.value)} className="mt-2 block w-full rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900"><option value="">{t('Select access')}</option>{requested.includes('library:read') && <option value="__library__">{t('All my stories, including new stories')}</option>}{requested.includes('beta:read') && request.data.beta_rounds?.map(round => <option key={round.id} value={`round:${round.id}`}>{t('Beta round I\'m reading: {0} ({1})', round.title, round.story_title)}</option>)}{stories.data?.map(story => <option key={story.id} value={story.id}>{story.title}</option>)}</select></label>
      {stories.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{errorText(stories.error)}</p>}
      {stories.data?.length === 0 && !requested.includes('library:read') && <p className="mt-3 text-sm">{t('Create or restore a story in your library, then restart the connection.')}</p>}
      {readerRound && <p className="mt-5 text-sm">{t('Your AI client can read this round’s frozen chapters, your own comments and drafts, and the author’s polls, read-only. It cannot see other readers or the author’s live story, and it stops working if the author turns reader AI off or removes you from the round.')}</p>}
      <div className={readerRound ? "hidden" : "mt-5 space-y-3 text-sm"}>
        {requested.includes('validators:read') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowReadValidators || allowWriteValidators} disabled={allowWriteValidators} onChange={event => setAllowReadValidators(event.target.checked)} />{t('Read my private writing checks across all stories')}</label>}
        {requested.includes('validators:write') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowWriteValidators} onChange={event => setAllowWriteValidators(event.target.checked)} />{t('Create, edit, enable and delete my private writing checks across all stories')}</label>}
        <p>{t('{0} (required)', t(scopeLabels['story:read']))}</p>
        {library && requested.includes('story:create') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowCreate} onChange={event => setAllowCreate(event.target.checked)} />{t('Create new stories in my account')}</label>}
        {requested.includes('prose:read') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowProse} onChange={event => setAllowProse(event.target.checked)} />{t(scopeLabels['prose:read'])}</label>}
        {requested.includes('story:write') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowWrite} onChange={event => setAllowWrite(event.target.checked)} />{t(scopeLabels['story:write'])}</label>}
        {requested.includes('beta:write') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowBetaWrite} onChange={event => setAllowBetaWrite(event.target.checked)} />{t('Draft replies to beta readers (you review and send them) and mark their feedback addressed')}</label>}
        {requested.includes('versions:restore') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowRestore && allowWrite && allowProse} disabled={!allowWrite || !allowProse} onChange={event => setAllowRestore(event.target.checked)} />{t(scopeLabels['versions:restore'])}</label>}
      </div>
      <p className="mt-5 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('{0} Provider keys and other users’ stories stay private. Access lasts up to 30 days and can be revoked in Settings. Text you share goes to the connected AI client.', library ? t('This connection can access all active stories in your account, including stories created later.') : t('This connection can access only the selected story.'))}</p>
      {decide.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{errorText(decide.error)}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={decide.isPending} onClick={() => decide.mutate(true)} className="rounded border border-slate-300 px-4 py-2 text-sm dark:border-slate-600">{t('Cancel')}</button><button type="button" disabled={!storyId || decide.isPending || !(readerRound ? requested.includes('beta:read') : requested.includes('story:read'))} onClick={() => decide.mutate(false)} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950">{decide.isPending ? t('Connecting…') : t('Allow connection')}</button></div>
    </section>}
  </main>
}
