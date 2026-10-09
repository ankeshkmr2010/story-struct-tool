import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { errorText } from '../api/errors'

const scopeLabels: Record<string, string> = {
  'story:read': 'Read structure, characters, timeline, and story findings',
  'prose:read': 'Read scene prose, notes, and version previews',
  'story:write': 'Propose and apply edits; create named versions',
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
  const library = storyId === '__library__'
  const requested = request.data?.requested_scopes ?? []
  const scopes = ['story:read', ...(allowProse ? ['prose:read'] : []), ...(allowWrite ? ['story:write'] : []), ...(allowWrite && allowProse && allowRestore ? ['versions:restore'] : []), ...(library ? ['library:read'] : []), ...(library && allowCreate ? ['story:create'] : [])].filter(scope => requested.includes(scope))
  const decide = useMutation({ mutationFn: (deny: boolean) => api.decideOAuthConsent(requestId, { story_id: deny || library ? null : storyId, scopes: deny ? [] : scopes, deny }), onSuccess: ({ redirect_url }) => window.location.assign(redirect_url) })
  return <main className="mx-auto max-w-xl px-5 py-10">
    <p className="text-xs uppercase tracking-widest text-slate-500 dark:text-slate-400">StoryTool connection</p>
    <h1 className="mt-3 text-2xl font-semibold">Connect your AI client</h1>
    {!requestId && <p role="alert" className="mt-4 text-red-600 dark:text-red-300">No connection request. Start again from your AI client's Connected Apps settings.</p>}
    {request.isPending && requestId && <p className="mt-4">Loading connection request…</p>}
    {request.isError && <p role="alert" className="mt-4 text-red-600 dark:text-red-300">{errorText(request.error)} Start a new connection from your AI client.</p>}
    {request.data && <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <p className="break-words text-lg font-medium">{request.data.client_name}</p>
      <p className="mt-2 break-words text-sm text-slate-500 dark:text-slate-400">Return address: {request.data.redirect_host}. The client supplies its display name; check that this address matches the app you are connecting.</p>
      <p className="mt-4 break-words text-sm">Signed in as <strong>{me.data?.email}</strong></p>
      <label className="mt-5 block text-sm font-medium">Choose access<select aria-label="Story to connect" value={storyId} onChange={event => setStoryId(event.target.value)} className="mt-2 block w-full rounded border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900"><option value="">Select access</option>{requested.includes('library:read') && <option value="__library__">All my stories, including new stories</option>}{stories.data?.map(story => <option key={story.id} value={story.id}>{story.title}</option>)}</select></label>
      {stories.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{errorText(stories.error)}</p>}
      {stories.data?.length === 0 && !requested.includes('library:read') && <p className="mt-3 text-sm">Create or restore a story in your library, then restart the connection.</p>}
      <div className="mt-5 space-y-3 text-sm">
        <p>{scopeLabels['story:read']} (required)</p>
        {library && requested.includes('story:create') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowCreate} onChange={event => setAllowCreate(event.target.checked)} />Create new stories in my account</label>}
        {requested.includes('prose:read') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowProse} onChange={event => setAllowProse(event.target.checked)} />{scopeLabels['prose:read']}</label>}
        {requested.includes('story:write') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowWrite} onChange={event => setAllowWrite(event.target.checked)} />{scopeLabels['story:write']}</label>}
        {requested.includes('versions:restore') && <label className="flex items-start gap-2"><input type="checkbox" checked={allowRestore && allowWrite && allowProse} disabled={!allowWrite || !allowProse} onChange={event => setAllowRestore(event.target.checked)} />{scopeLabels['versions:restore']}</label>}
      </div>
      <p className="mt-5 text-xs leading-5 text-slate-500 dark:text-slate-400">{library ? 'This connection can access all active stories in your account, including stories created later.' : 'This connection can access only the selected story.'} Provider keys and other users’ stories stay private. Access lasts up to 30 days and can be revoked in Settings. Text you share goes to the connected AI client.</p>
      {decide.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{errorText(decide.error)}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={decide.isPending} onClick={() => decide.mutate(true)} className="rounded border border-slate-300 px-4 py-2 text-sm dark:border-slate-600">Cancel</button><button type="button" disabled={!storyId || decide.isPending || !requested.includes('story:read')} onClick={() => decide.mutate(false)} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-950">{decide.isPending ? 'Connecting…' : 'Allow connection'}</button></div>
    </section>}
  </main>
}
