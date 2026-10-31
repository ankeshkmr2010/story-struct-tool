import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { t, tx } from '../i18n'

/** The address an AI client connects to; the same one Settings and the full guide show. */
export const connectLink = () => `${window.location.origin}/mcp`

const CLIENTS = {
  claude: { name: tx('Claude'), steps: [
    tx('In Claude’s web app, open Customize → Connectors and add a custom connector named StoryTool.'),
    tx('Paste the link as its address. If asked, choose OAuth sign-in and Register automatically.'),
    tx('Sign in to StoryTool when asked and choose the stories Claude can use.'),
    tx('Turn StoryTool on in a chat, then check the connection below.'),
  ] },
  chatgpt: { name: tx('ChatGPT'), steps: [
    tx('In ChatGPT on the web, open Plugins and add a custom server named StoryTool.'),
    tx('Paste the link as its address and choose OAuth sign-in with automatic registration.'),
    tx('Sign in to StoryTool when asked and choose the stories ChatGPT can use.'),
    tx('Turn StoryTool on in your chat, then check the connection below.'),
  ] },
} as const

/**
 * Usability phase 3, item 12: connect an AI in three steps (pick, copy one link, check). The technical
 * guide for every other client sits under Advanced wherever this is shown.
 */
export function ConnectWizard() {
  const [client, setClient] = useState<keyof typeof CLIENTS | null>(null)
  const [copied, setCopied] = useState<boolean | 'failed'>(false)
  const [checking, setChecking] = useState(false)
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false })
  const grants = useQuery({
    queryKey: ['oauth-grants'], queryFn: api.listOAuthGrants, enabled: checking && me.isSuccess,
    // While waiting for the writer to finish in their AI, look again every few seconds.
    refetchInterval: query => (query.state.data ?? []).some(grant => !grant.revoked_at) ? false : 5000,
  })
  const connected = (grants.data ?? []).filter(grant => !grant.revoked_at)
  const copy = async () => { try { await navigator.clipboard.writeText(connectLink()); setCopied(true) } catch { setCopied('failed') } }
  return <section className="connect-wizard" aria-labelledby="connect-title">
    <h2 id="connect-title">{t('Connect your AI')}</h2>
    <p className="connect-lead">{t('Let the AI you already use read your story and suggest edits you review.')}</p>
    <ol className="connect-steps">
      <li>
        <h3><span aria-hidden="true">1</span>{t('Which AI do you use?')}</h3>
        <div className="connect-choices" role="radiogroup" aria-label={t('Your AI')}>
          {(Object.keys(CLIENTS) as (keyof typeof CLIENTS)[]).map(id => <button key={id} type="button" role="radio" aria-checked={client === id} onClick={() => setClient(id)}>{t(CLIENTS[id].name)}</button>)}
        </div>
      </li>
      {client && <li>
        <h3><span aria-hidden="true">2</span>{t('Copy this link into {0}', t(CLIENTS[client].name))}</h3>
        <div className="connect-link"><code>{connectLink()}</code><button type="button" className="ui-btn ui-btn-primary" onClick={() => void copy()}>{copied === true ? t('Copied') : t('Copy link')}</button></div>
        {copied === 'failed' && <p role="alert" className="connect-note">{t('Clipboard access is unavailable. Select and copy the link manually.')}</p>}
        <ol className="connect-howto">{CLIENTS[client].steps.map(step => <li key={step}>{t(step)}</li>)}</ol>
      </li>}
      {client && <li>
        <h3><span aria-hidden="true">3</span>{t('Check the connection')}</h3>
        {me.isSuccess ? <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setChecking(true); void grants.refetch() }}>{t('Check connection')}</button>
          <p role="status" className="connect-result">
            {connected.length > 0
              ? <span className="connect-ok"><span aria-hidden="true">✓</span>{t('Connected: {0}', connected.map(grant => grant.client_name).join(', '))}</span>
              : checking && !grants.isFetching ? t('Not connected yet. Finish signing in from {0}; this checks again every few seconds.', t(CLIENTS[client].name))
              : checking ? t('Checking…') : ''}
          </p>
        </> : <p className="connect-note">{t('Sign in to StoryTool to check your connection.')}</p>}
      </li>}
    </ol>
  </section>
}
