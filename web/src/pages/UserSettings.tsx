import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type AIConnection, type OAuthGrant } from '../api/client'
import { errorText } from '../api/errors'
import { LANGUAGES, type LanguageId } from '../components/languages'
import { t } from '../i18n'
import { serverText } from '../i18n/server'
import { HabitGoalForm } from '../components/Goals'

function AuthorNameSettings() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser })
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? me.data?.author_name ?? ''
  const save = useMutation({
    mutationFn: () => api.saveProfile({ author_name: value.trim() || null }),
    onSuccess: (user) => { qc.setQueryData(['me'], user); setDraft(null) },
  })
  return <section id="profile" className="scroll-mt-24 rounded-xl border border-slate-200 p-5 dark:border-slate-700 sm:p-6">
    <h2 className="text-lg font-semibold">{t('Author name')}</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('Your writing name or pen name, used as the byline in manuscript exports. Leave it blank to omit the byline. Your Google profile name stays separate.')}</p>
    <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
      <label className="min-w-0 flex-1 text-sm">{t('Name on exports')}<input maxLength={200} disabled={me.isPending || save.isPending} value={value} onChange={(event) => { setDraft(event.target.value); save.reset() }} className="mt-2 block w-full rounded-md border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900" /></label>
      <button type="submit" disabled={!me.data || save.isPending || value === (me.data.author_name ?? '')} className="ui-btn ui-btn-primary">{save.isPending ? t('Saving…') : t('Save author name')}</button>
    </form>
    {save.isSuccess && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{t('Author name saved.')}</p>}
    {(save.error || me.error) && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{errorText(save.error ?? me.error)}</p>}
  </section>
}

function LanguageSettings() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser })
  const save = useMutation({
    mutationFn: (language: LanguageId) => api.saveProfile({ language }),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  })
  return <section className="mt-6 rounded-xl border border-slate-200 p-5 dark:border-slate-700 sm:p-6">
    <h2 className="text-lg font-semibold">{t('Writing language')}</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('The default for your stories. Smart consistency in Evaluate flags spellings from the other variety, such as colour in a US story. A story can choose its own under Design → Premise.')}</p>
    <label className="mt-4 block text-sm">{t('Default language')}
      <select value={me.data?.language ?? 'en-US'} disabled={!me.data || save.isPending} onChange={(event) => save.mutate(event.target.value as LanguageId)} className="mt-2 block rounded-md border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900">
        {LANGUAGES.map((language) => <option key={language.id} value={language.id}>{t(language.label)}</option>)}
      </select>
    </label>
    {save.isSuccess && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{t('Default language saved.')}</p>}
    {save.error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{errorText(save.error)}</p>}
  </section>
}

export default function UserSettings() {
  const qc = useQueryClient()
  const connections = useQuery({ queryKey: ['ai-connections'], queryFn: api.listAIConnections })
  const stories = useQuery({ queryKey: ['stories'], queryFn: api.listStories })
  const tokens = useQuery({ queryKey: ['agent-tokens'], queryFn: api.listAgentTokens })
  const oauthGrants = useQuery({ queryKey: ['oauth-grants'], queryFn: api.listOAuthGrants })
  const revokeOAuth = useMutation({ mutationFn: (ids: string[]) => Promise.all(ids.map(id => api.revokeOAuthGrant(id))), onSettled: () => void qc.invalidateQueries({ queryKey: ['oauth-grants'] }) })
  // Each reconnect creates a grant; show one row per client, story, permissions and status.
  const grantGroups = Object.values((oauthGrants.data ?? []).reduce<Record<string, OAuthGrant[]>>((groups, grant) => {
    const key = [grant.client_name, grant.story_title, [...grant.scopes].sort().join(' '), grant.revoked_at ? 'revoked' : 'active'].join('|')
    groups[key] = [...(groups[key] ?? []), grant]
    return groups
  }, {}))
  const [provider, setProvider] = useState<AIConnection['provider']>('anthropic')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [storyId, setStoryId] = useState('')
  const [endpointCopied, setEndpointCopied] = useState(false)
  const [revealedToken, setRevealedToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [tested, setTested] = useState<string | null>(null)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ai-connections'] }); void qc.invalidateQueries({ queryKey: ['noticer'] }) }
  const save = useMutation({ mutationFn: () => api.saveAIConnection({ provider, model: model.trim(), api_key: key.trim() }), onSuccess: () => { setKey(''); setModel(provider === 'jev' ? 'jev-latest' : ''); refresh() } })
  const test = useMutation({ mutationFn: api.testAIConnection, onSuccess: (_, id) => setTested(id) })
  const remove = useMutation({ mutationFn: api.deleteAIConnection, onSuccess: refresh })
  const createToken = useMutation({ mutationFn: () => api.createAgentToken(storyId, 'Claude / Codex'), onSuccess: (result) => { setRevealedToken(result.token); setTokenVisible(false); setTokenCopied(false); setCopyError(false); void qc.invalidateQueries({ queryKey: ['agent-tokens'] }) } })
  const revoke = useMutation({ mutationFn: api.revokeAgentToken, onSuccess: () => { setRevealedToken(''); void qc.invalidateQueries({ queryKey: ['agent-tokens'] }) } })
  const pending = save.isPending || remove.isPending
  const copyToken = async () => {
    setCopyError(false)
    try {
      await navigator.clipboard.writeText(revealedToken)
      setTokenCopied(true)
    } catch {
      setTokenCopied(false)
      setTokenVisible(true)
      setCopyError(true)
    }
  }
  return (
    <main className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8">
      <Link to="/library" className="text-sm text-slate-500 dark:text-slate-400 hover:underline">{t('← Your stories')}</Link>
      <h1 className="mt-5 text-2xl font-semibold">{t('Your settings')}</h1>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('Settings sections')}><a href="#profile">{t('Profile')}</a><a href="#writing-goal">{t('Writing goal')}</a><a href="#ai-clients">{t('AI clients')}</a><a href="#api-keys">{t('API keys')}</a><Link to="/checks">{t('Writing checks')}</Link></nav>
        <div className="min-w-0">
      <AuthorNameSettings />
      <LanguageSettings />
      <section id="writing-goal" className="mt-6 scroll-mt-24 rounded-xl border border-slate-200 p-5 dark:border-slate-700 sm:p-6"><h2 className="text-lg font-semibold">{t('Writing goal')}</h2><p className="writer-help mb-3">{t('A daily habit across all your stories. Set a goal for one story from its Write screen or Design.')}</p><HabitGoalForm /></section>
      <section id="ai-clients" className="mt-6 scroll-mt-24 rounded-xl border border-slate-200 dark:border-slate-700 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{t('Connect an AI client · MCP')}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('Connect Claude or ChatGPT through browser sign-in, then choose the stories and permissions it can use. Your client supplies the model; no provider API key or token copying is needed here.')}{' '}<Link to="/#mcp" className="underline">{t('Open the connection guides →')}</Link></p>
        <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs leading-5">
          <label className="block font-medium" htmlFor="mcp-endpoint">{t('MCP server URL')}</label>
          <div className="mt-1 flex flex-wrap gap-2"><input id="mcp-endpoint" readOnly value={`${window.location.origin}/mcp`} className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 font-mono" /><button type="button" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/mcp`).then(() => setEndpointCopied(true)).catch(() => setEndpointCopied(false)) }} className="rounded border border-slate-300 dark:border-slate-600 px-3">{endpointCopied ? t('Copied') : t('Copy URL')}</button></div>
          <p className="mt-2 text-slate-500 dark:text-slate-400">{t('Add this URL in your client\'s connector settings and choose OAuth sign-in. Other compatible clients can use the same flow.')}</p>
        </div>
        <div className="mt-5 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className="text-sm font-semibold">{t('OAuth connections')}</h3><p className="text-xs text-slate-500 dark:text-slate-400">{t('These apps were authorized through a browser consent screen. Revoking disconnects their access and refresh tokens immediately.')}</p>{oauthGrants.isPending && <p className="text-xs">{t('Loading connections…')}</p>}{oauthGrants.data?.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">{t('No OAuth connections yet.')}</p>}{grantGroups.map(group => { const grant = group.reduce((latest, item) => item.expires_at > latest.expires_at ? item : latest); return <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><div className="min-w-0"><p className="break-words text-sm font-medium">{grant.client_name} · {serverText(grant.story_title)}{group.length > 1 ? t(' · {0} sign-ins', group.length) : ''}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{grant.revoked_at ? t('Revoked') : t('Expires {0}', new Date(grant.expires_at).toLocaleDateString())} · {grant.scopes.includes('story:write') ? t('Can edit') : t('Read only')}{grant.scopes.includes('prose:read') ? t(' · Prose shared') : ''}</p></div>{!grant.revoked_at && <button type="button" disabled={revokeOAuth.isPending} onClick={() => revokeOAuth.mutate(group.map(item => item.id))} className="text-xs text-red-600 dark:text-red-300">{group.length > 1 ? t('Revoke all') : t('Revoke connection')}</button>}</div> })}{(oauthGrants.isError || revokeOAuth.isError) && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{errorText(oauthGrants.error ?? revokeOAuth.error)}</p>}</div>
        <details className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-semibold">{t('Manual tokens for other clients')}</summary>
          <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('For clients that require a bearer token, create a seven-day token for one story. It includes structure and prose access, edits and whole-story restores. Set Authorization to Bearer followed by the token in your client\'s local configuration. Other stories and provider keys stay private.')}</p>
        <div className="mt-4 flex flex-wrap gap-3"><select aria-label={t('Story for external agent')} value={storyId} onChange={(event) => setStoryId(event.target.value)} className="min-w-0 max-w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-sm"><option value="">{t('Choose a story')}</option>{stories.data?.map((story) => <option key={story.id} value={story.id}>{story.title}</option>)}</select><button type="button" disabled={!storyId || createToken.isPending} onClick={() => createToken.mutate()} className="rounded-md bg-slate-900 dark:bg-slate-200 px-3 py-2 text-sm text-white dark:text-slate-950 disabled:opacity-40">{t('Create agent token')}</button></div>
        {revealedToken && (
          <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3">
            <p className="text-xs leading-5 text-amber-900 dark:text-amber-300">{t('Available until you leave or refresh this page. Copy it into your agent\'s local environment as STORYTOOL_AGENT_TOKEN. Keep it out of prompts and source control.')}</p>
            <input aria-label={t('New agent token')} type={tokenVisible ? 'text' : 'password'} autoComplete="off" spellCheck={false} readOnly value={revealedToken} className="mt-2 w-full rounded border border-amber-200 dark:border-amber-800 p-2 font-mono text-xs" onFocus={(event) => event.target.select()} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void copyToken()} className="rounded-md bg-slate-900 dark:bg-slate-200 px-3 py-1.5 text-xs text-white dark:text-slate-950">{tokenCopied ? t('Copied!') : t('Copy token')}</button>
              <button type="button" aria-pressed={tokenVisible} onClick={() => setTokenVisible(!tokenVisible)} className="rounded-md border border-amber-300 dark:border-amber-800 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-300">{tokenVisible ? t('Mask token') : t('Reveal token')}</button>
              <button type="button" onClick={() => { setRevealedToken(''); setTokenVisible(false); setTokenCopied(false); setCopyError(false) }} className="text-xs text-amber-800 dark:text-amber-300 underline">{t('Dismiss token')}</button>
            </div>
            {tokenCopied && <p role="status" className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">{t('Token copied to your clipboard.')}</p>}
            {copyError && <p role="alert" className="mt-2 text-xs text-amber-800 dark:text-amber-300">{t('Clipboard access is unavailable. Select and copy the revealed token manually.')}</p>}
          </div>
        )}
        {createToken.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{errorText(createToken.error)}</p>}
        {tokens.isPending && <p role="status" className="mt-4 text-xs text-slate-500 dark:text-slate-400">{t('Loading manual tokens…')}</p>}
        {tokens.isError && <p role="alert" className="mt-4 text-xs text-red-600 dark:text-red-300">{errorText(tokens.error)} <button type="button" onClick={() => void tokens.refetch()} className="underline">{t('Try again')}</button></p>}
        {tokens.data?.length === 0 && <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{t('No manual tokens yet.')}</p>}
        {revoke.isError && <p role="alert" className="mt-4 text-xs text-red-600 dark:text-red-300">{errorText(revoke.error)}</p>}
        <ul className="mt-4 space-y-2">{tokens.data?.map((token) => <li key={token.id} className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400"><span>{t('{0} · expires {1}', stories.data?.find((story) => story.id === token.story_id)?.title ?? t('Story'), new Date(token.expires_at).toLocaleDateString())}</span><button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)} className="text-red-600 dark:text-red-300">{t('Revoke')}</button></li>)}</ul>
        </details>
      </section>
      <section id="api-keys" className="mt-6 scroll-mt-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{t('AI connections')}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('Connect your own account to plan stories and improve suggestions. Requests use your provider\'s API billing. Saved keys are encrypted and belong only to your account.')}</p>
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); setTested(null); save.mutate() }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">{t('Provider')}<select aria-label={t('Provider')} value={provider} onChange={(event) => { setProvider(event.target.value as AIConnection['provider']); setModel(event.target.value === 'openrouter' ? 'nvidia/nemotron-3.5-lightning:free' : event.target.value === 'jev' ? 'jev-latest' : ''); setKey('') }} className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"><option value="anthropic">{t('Anthropic · Claude')}</option><option value="openai">{t('OpenAI')}</option><option value="openrouter">{t('OpenRouter · free models available')}</option><option value="jev">{t('TypeSafe · Jev reader')}</option></select></label>
            <label className="text-sm text-slate-600 dark:text-slate-300">{t('Model ID')}{provider === 'jev' ? <select aria-label={t('Jev model')} value={model || 'jev-latest'} onChange={event => setModel(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 p-2"><option value="jev-latest">{t('jev-latest')}</option></select> : <input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('Model available to your provider account')} required className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 p-2" />}</label>
          </div>
          {provider === 'openrouter' && <div className="rounded-lg bg-sky-50 dark:bg-sky-950 p-3 text-xs leading-5 text-sky-900 dark:text-sky-300"><p>{t('Nemotron 3.5 Lightning is prefilled. Paste an OpenRouter API key from')}{' '}<a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="underline">{t('OpenRouter Settings')}</a>{t('. Free requests have usage limits; this app never substitutes a paid model automatically. Test checks your key and the model\'s tool support without generating a reply.')}</p><p className="mt-2">{t('NVIDIA\'s free endpoint logs session data for security and product improvement. Use public examples when trying it; avoid confidential drafts.')}{' '}<a href="https://openrouter.ai/nvidia/nemotron-3.5-lightning:free" target="_blank" rel="noreferrer" className="underline">{t('Model and data-use details')}</a></p></div>}
          <label className="block text-sm text-slate-600 dark:text-slate-300">{t('API key')}<input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} required minLength={8} className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 p-2" placeholder={t('Paste your provider API key here')} /></label>
          <button type="submit" disabled={pending || !model.trim() || key.trim().length < 8} className="rounded-md bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm text-white dark:text-slate-950 disabled:opacity-40">{save.isPending ? t('Saving…') : t('Save connection')}</button>
          {save.isSuccess && <span role="status" className="ml-3 text-sm text-emerald-700 dark:text-emerald-300">{t('Connection saved. Test it below.')}</span>}
          {save.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(save.error)}</p>}
        </form>
        <div className="mt-6 space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
          {connections.isPending && <p className="text-sm text-slate-500 dark:text-slate-400">{t('Loading connections…')}</p>}
          {connections.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(connections.error)}</p>}
          {connections.data?.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 dark:bg-slate-950 p-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.provider === 'anthropic' ? t('Claude') : item.provider === 'jev' ? t('Jev reader') : item.provider === 'openrouter' ? t('OpenRouter') : t('OpenAI')} · {item.model}</p><p className="mt-1 text-xs text-slate-400">{t('Key ending {0}', item.key_suffix)}{tested === item.id && <span className="ml-3 text-emerald-700 dark:text-emerald-300">{t('Connection verified')}</span>}</p></div><div className="flex gap-3 text-xs"><button type="button" disabled={test.isPending} onClick={() => { setTested(null); test.mutate(item.id) }} className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 disabled:opacity-40">{test.isPending && test.variables === item.id ? t('Testing…') : t('Test')}</button><button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.id)} className="text-red-600 dark:text-red-300">{t('Disconnect')}</button></div></div>)}
          {test.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(test.error)}</p>}
          {remove.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(remove.error)}</p>}
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{t('Claude, OpenAI, and OpenRouter chat and propose changes. Jev reads scenes and supplies observations. The Jev connection test makes a small API request; authoring requests share story structure and any prose excerpts you select.')}</p>
        </div>
      </section>
        </div>
      </div>
    </main>
  )
}
