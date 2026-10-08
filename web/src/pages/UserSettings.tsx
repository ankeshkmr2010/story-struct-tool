import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type AIConnection } from '../api/client'
import { errorText } from '../api/errors'

export default function UserSettings() {
  const qc = useQueryClient()
  const connections = useQuery({ queryKey: ['ai-connections'], queryFn: api.listAIConnections })
  const stories = useQuery({ queryKey: ['stories'], queryFn: api.listStories })
  const tokens = useQuery({ queryKey: ['agent-tokens'], queryFn: api.listAgentTokens })
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
  const save = useMutation({ mutationFn: () => api.saveAIConnection({ provider, model: model.trim(), api_key: key.trim() }), onSuccess: () => { setKey(''); setModel(''); refresh() } })
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
    <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
      <Link to="/library" className="text-sm text-slate-500 dark:text-slate-400 hover:underline">← Your stories</Link>
      <h1 className="mt-5 text-2xl font-semibold">Your settings</h1>
      <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">AI connections</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Connect your own account to plan stories and improve suggestions. Requests use your provider's API billing. Saved keys are encrypted and belong only to your account.</p>
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); setTested(null); save.mutate() }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">Provider<select aria-label="Provider" value={provider} onChange={(event) => { setProvider(event.target.value as AIConnection['provider']); setModel(event.target.value === 'openrouter' ? 'nvidia/nemotron-3.5-lightning:free' : ''); setKey('') }} className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2"><option value="anthropic">Anthropic · Claude</option><option value="openai">OpenAI</option><option value="openrouter">OpenRouter · free models available</option><option value="jev">TypeSafe · Jev reader</option></select></label>
            <label className="text-sm text-slate-600 dark:text-slate-300">Model ID<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model available to your provider account" required className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 p-2" /></label>
          </div>
          {provider === 'openrouter' && <div className="rounded-lg bg-sky-50 dark:bg-sky-950 p-3 text-xs leading-5 text-sky-900 dark:text-sky-300"><p>Nemotron 3.5 Lightning is prefilled. Paste an OpenRouter API key from <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="underline">OpenRouter Settings</a>. Free requests have usage limits; this app never substitutes a paid model automatically. Test checks your key and the model's tool support without generating a reply.</p><p className="mt-2">NVIDIA's free endpoint logs session data for security and product improvement. Use public examples when trying it; avoid confidential drafts. <a href="https://openrouter.ai/nvidia/nemotron-3.5-lightning:free" target="_blank" rel="noreferrer" className="underline">Model and data-use details</a></p></div>}
          <label className="block text-sm text-slate-600 dark:text-slate-300">API key<input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} required minLength={8} className="mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-600 p-2" placeholder="Paste your provider API key here" /></label>
          <button type="submit" disabled={pending || !model.trim() || key.trim().length < 8} className="rounded-md bg-slate-900 dark:bg-slate-200 px-4 py-2 text-sm text-white dark:text-slate-950 disabled:opacity-40">{save.isPending ? 'Saving…' : 'Save connection'}</button>
          {save.isSuccess && <span role="status" className="ml-3 text-sm text-emerald-700 dark:text-emerald-300">Connection saved. Test it below.</span>}
          {save.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(save.error)}</p>}
        </form>
        <div className="mt-6 space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
          {connections.isPending && <p className="text-sm text-slate-500 dark:text-slate-400">Loading connections…</p>}
          {connections.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(connections.error)}</p>}
          {connections.data?.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 dark:bg-slate-950 p-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.provider === 'anthropic' ? 'Claude' : item.provider === 'jev' ? 'Jev reader' : item.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} · {item.model}</p><p className="mt-1 text-xs text-slate-400">Key ending {item.key_suffix}{tested === item.id && <span className="ml-3 text-emerald-700 dark:text-emerald-300">Connection verified</span>}</p></div><div className="flex gap-3 text-xs"><button type="button" disabled={test.isPending} onClick={() => { setTested(null); test.mutate(item.id) }} className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 disabled:opacity-40">{test.isPending && test.variables === item.id ? 'Testing…' : 'Test'}</button><button type="button" disabled={remove.isPending} onClick={() => remove.mutate(item.id)} className="text-red-600 dark:text-red-300">Disconnect</button></div></div>)}
          {test.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(test.error)}</p>}
          {remove.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(remove.error)}</p>}
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Claude, OpenAI, and OpenRouter chat and propose changes. Jev reads scenes and supplies observations. The Jev connection test makes a small API request; authoring requests share story structure and any prose excerpts you select.</p>
        </div>
      </section>
      <section className="mt-6 rounded-xl border border-slate-200 dark:border-slate-700 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Connect an AI client · MCP</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Connect a client that supports Streamable HTTP with a bearer token. Your client supplies the model; no model key is needed here. Create a seven-day token for one story. It grants access to that story's structure, prose, findings, proposals, and versions, including edits and whole-story restores. Provider keys and other stories stay private.</p>
        <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs leading-5">
          <label className="block font-medium" htmlFor="mcp-endpoint">MCP server URL</label>
          <div className="mt-1 flex flex-wrap gap-2"><input id="mcp-endpoint" readOnly value={`${window.location.origin}/mcp`} className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 font-mono" /><button type="button" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/mcp`).then(() => setEndpointCopied(true)).catch(() => setEndpointCopied(false)) }} className="rounded border border-slate-300 dark:border-slate-600 px-3">{endpointCopied ? 'Copied' : 'Copy URL'}</button></div>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Set the client's Authorization header to Bearer followed by your story token. This is token authentication; OAuth sign-in for MCP clients is not available yet. Clients requiring OAuth need a local bridge. The free server can take a minute to wake after being idle.</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3"><select aria-label="Story for external agent" value={storyId} onChange={(event) => setStoryId(event.target.value)} className="min-w-0 max-w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-sm"><option value="">Choose a story</option>{stories.data?.map((story) => <option key={story.id} value={story.id}>{story.title}</option>)}</select><button type="button" disabled={!storyId || createToken.isPending} onClick={() => createToken.mutate()} className="rounded-md bg-slate-900 dark:bg-slate-200 px-3 py-2 text-sm text-white dark:text-slate-950 disabled:opacity-40">Create agent token</button></div>
        {revealedToken && (
          <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 p-3">
            <p className="text-xs leading-5 text-amber-900 dark:text-amber-300">Available until you leave or refresh this page. Copy it into your agent's local environment as STORYTOOL_AGENT_TOKEN. Keep it out of prompts and source control.</p>
            <input aria-label="New agent token" type={tokenVisible ? 'text' : 'password'} autoComplete="off" spellCheck={false} readOnly value={revealedToken} className="mt-2 w-full rounded border border-amber-200 dark:border-amber-800 p-2 font-mono text-xs" onFocus={(event) => event.target.select()} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void copyToken()} className="rounded-md bg-slate-900 dark:bg-slate-200 px-3 py-1.5 text-xs text-white dark:text-slate-950">{tokenCopied ? 'Copied!' : 'Copy token'}</button>
              <button type="button" aria-pressed={tokenVisible} onClick={() => setTokenVisible(!tokenVisible)} className="rounded-md border border-amber-300 dark:border-amber-800 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-300">{tokenVisible ? 'Mask token' : 'Reveal token'}</button>
              <button type="button" onClick={() => { setRevealedToken(''); setTokenVisible(false); setTokenCopied(false); setCopyError(false) }} className="text-xs text-amber-800 dark:text-amber-300 underline">Dismiss token</button>
            </div>
            {tokenCopied && <p role="status" className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Token copied to your clipboard.</p>}
            {copyError && <p role="alert" className="mt-2 text-xs text-amber-800 dark:text-amber-300">Clipboard access is unavailable. Select and copy the revealed token manually.</p>}
          </div>
        )}
        {createToken.isError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{errorText(createToken.error)}</p>}
        <ul className="mt-4 space-y-2">{tokens.data?.map((token) => <li key={token.id} className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400"><span>{stories.data?.find((story) => story.id === token.story_id)?.title ?? 'Story'} · expires {new Date(token.expires_at).toLocaleDateString()}</span><button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)} className="text-red-600 dark:text-red-300">Revoke</button></li>)}</ul>
        <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">Ask your client to read context, schemas, writing guidelines and findings; stage a connected outline or scene draft; review before applying. Timeline, arc tracing, prose editing and version comparison/recovery use the same story workspace. Setup and example requests are in AI_SETUP.md in the project.</p>
      </section>
    </main>
  )
}
