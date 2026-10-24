import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { t, tx } from '../i18n'

type Guide = { id: string; name: string; kind: string; title: string; steps: string[]; note?: string; code?: string; source: string }
const endpoint = 'https://storytool.onrender.com/mcp'
const clientGuides: Guide[] = [
  { id: 'gemini', name: tx('Gemini'), kind: tx('Web + phone · OAuth'), title: tx('Bring StoryTool into Gemini on your phone'), steps: [tx('Open gemini.google.com in your browser and find Connected Apps in Settings or Personal Intelligence.'), tx('Add a custom app using the server URL above, then continue through Google’s connection flow.'), tx('Sign in to StoryTool, choose one story or your whole library, and approve the permissions you want.'), tx('Return to Gemini. Use @ to select StoryTool in a chat; the linked app is also available on mobile.')], note: tx('Google currently lists custom apps as English-only, for eligible personal accounts in the US with Keep Activity enabled. If Custom apps is missing, check Google’s availability requirements.'), source: 'https://support.google.com/gemini/answer/17209137?hl=en-12' },
  { id: 'claude', name: tx('Claude'), kind: tx('Web + mobile · OAuth'), title: tx('Connect your writing workspace to Claude'), steps: [tx('In Claude’s web app, open Customize → Connectors and add a custom web connector named StoryTool.'), tx('Use the server URL above. Choose OAuth sign-in and Register automatically rather than the published-identity option.'), tx('Complete StoryTool’s consent screen, then enable the connector for your conversation.'), tx('Ask Claude to read your story, discuss alternatives, and stage focused changes for review.')], note: tx('StoryTool supports dynamic registration (DCR), so choose Register automatically if offered. Connector availability and organization permissions depend on your account.'), source: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp' },
  { id: 'chatgpt', name: tx('ChatGPT'), kind: tx('Web · OAuth / DCR'), title: tx('Add StoryTool as a custom ChatGPT plugin'), steps: [tx('In ChatGPT on the web, open Plugins and choose + → Add custom MCP server. Older layouts may show custom apps under Apps or Connectors.'), tx('Name it StoryTool, paste the server URL, and select OAuth with dynamic client registration (DCR).'), tx('Finish creation, install the plugin, and authorize your StoryTool account and stories.'), tx('Enable StoryTool in your conversation. Refresh the plugin’s tools if new capabilities are missing.')], note: tx('Custom MCP access depends on your account and workspace policy. StoryTool supports DCR, not published client identity (CIMD). If custom MCP is unavailable, use another client tab.'), source: 'https://developers.openai.com/api/docs/guides/custom-mcp-server' },
  { id: 'codex', name: tx('Codex'), kind: tx('CLI + desktop · OAuth'), title: tx('Use StoryTool tools from Codex'), steps: [tx('With Codex CLI installed, register the hosted server using the commands below.'), tx('Approve access in the browser. Select your library if you want to create stories.'), tx('Start or restart Codex. Run /mcp in its terminal interface to inspect the connection.'), tx('Request story work through StoryTool’s tools; review proposed edits before applying.')], code: `codex mcp add storytool --url ${endpoint}\ncodex mcp login storytool --oauth-client-registration dcr`, note: tx('Compatible Codex surfaces share CLI configuration. Update Codex if the explicit DCR flag is unavailable, or use automatic OAuth login.'), source: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli' },
  { id: 'claude-code', name: tx('Claude Code'), kind: tx('Terminal · OAuth'), title: tx('Connect Claude Code to the hosted tools'), steps: [tx('Register the HTTP endpoint with the command below.'), tx('Launch Claude Code, enter /mcp, and authenticate StoryTool when prompted.'), tx('Approve a story or library access in the browser, including creation and edits when needed.'), tx('Ask the agent to read guidelines and findings before outlining or revising.')], code: `claude mcp add --transport http storytool ${endpoint}`, source: 'https://code.claude.com/docs/en/mcp' },
  { id: 'gemini-cli', name: tx('Gemini CLI'), kind: tx('Terminal · OAuth'), title: tx('Connect the Gemini terminal client'), steps: [tx('Register StoryTool with the terminal commands below.'), tx('Inside Gemini, enter /mcp auth storytool to open browser authorization.'), tx('Choose stories and permissions in StoryTool’s consent screen.'), tx('Use /mcp to inspect the tools, then give Gemini your writing request.')], code: `gemini mcp add --transport http storytool ${endpoint}\ngemini`, note: tx('Gemini CLI is separate from the phone app. OAuth needs a local browser and callback. Use the Gemini tab for phone setup.'), source: 'https://geminicli.com/docs/tools/mcp-server/' },
  { id: 'cursor', name: tx('Cursor'), kind: tx('Editor · OAuth'), title: tx('Connect your story workspace in Cursor'), steps: [tx('Merge the JSON below into .cursor/mcp.json in your project, or global ~/.cursor/mcp.json.'), tx('Open Cursor’s MCP tools settings and authenticate StoryTool.'), tx('Approve story or library permissions in your browser.'), tx('Ask Cursor’s agent to use StoryTool tools; the server stores your draft.')], code: JSON.stringify({ mcpServers: { storytool: { url: endpoint } } }, null, 2), source: 'https://cursor.com/docs/mcp' },
  { id: 'other', name: tx('Other clients'), kind: tx('Any compatible MCP host'), title: tx('Use your preferred MCP-enabled AI client'), steps: [tx('Find your client’s MCP or integration settings. A model API or ordinary chat alone cannot execute MCP tools.'), tx('Add the server URL and select Streamable HTTP with OAuth and dynamic registration (DCR).'), tx('Authorize your StoryTool account and desired access. An external client supplies its own model.'), tx('For a client supporting only bearer tokens, create a story token in StoryTool Settings and configure Authorization: Bearer <token> locally.')], note: tx('Manual tokens remain limited to one story. Stdio-only clients can use the local story_mcp_remote.py adapter in the full setup guide.'), source: 'https://github.com/ankeshkmr2010/story-struct-tool/blob/main/AI_SETUP.md#hosted-mcp-server' },
]
const guides = [
  ...clientGuides.filter((guide) => guide.id === 'claude'),
  ...clientGuides.filter((guide) => guide.id === 'chatgpt'),
  ...clientGuides.filter((guide) => guide.id !== 'claude' && guide.id !== 'chatgpt'),
]
const starterPrompt = tx('Read my story and tell me what\'s weakest in Act 2.')

export function MCPSetup() {
  const [selected, setSelected] = useState(0)
  const [showOtherClients, setShowOtherClients] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState(false)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const current = guides[selected]
  const visibleGuides = showOtherClients ? guides : guides.slice(0, 2)
  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(label); setCopyError(false) }
    catch { setCopied(null); setCopyError(true) }
  }
  return <section id="mcp" className="mcp-setup" aria-labelledby="mcp-title">
    <div className="mcp-intro"><div><p className="eyebrow">{t('YOUR AI, YOUR STORY WORKSPACE')}</p><h2 id="mcp-title">{t('Write with the assistant you already use.')}</h2><p>{t('Connect an AI client through MCP. It can read your story, follow its arcs and timeline, spot gaps, and propose connected edits you can review.')}</p></div><img src="/branding/storytool.svg" width="64" height="64" alt="" /></div>
    <div className="mcp-endpoint"><div><span>{t('StoryTool MCP server · Streamable HTTP + OAuth')}</span><code>{endpoint}</code></div><button type="button" onClick={() => void copy(endpoint, 'url')}>{copied === 'url' ? t('Copied URL') : t('Copy server URL')}</button></div>
    <div className="mcp-window">
      <div id="mcp-client-tabs" role="tablist" aria-label={t('AI client setup')} className="mcp-tabs">{visibleGuides.map((guide, index) => <button key={guide.id} ref={element => { tabs.current[index] = element }} type="button" role="tab" id={`agent-tab-${guide.id}`} aria-selected={selected === index} aria-controls={`agent-panel-${guide.id}`} tabIndex={selected === index ? 0 : -1} onClick={() => { setSelected(index); setCopied(null); setCopyError(false) }} onKeyDown={event => {
        let next = index
        if (event.key === 'ArrowRight') next = (index + 1) % visibleGuides.length
        else if (event.key === 'ArrowLeft') next = (index - 1 + visibleGuides.length) % visibleGuides.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = visibleGuides.length - 1
        else return
        event.preventDefault(); setSelected(next); setCopied(null); setCopyError(false); tabs.current[next]?.focus()
      }}>{t(guide.name)}</button>)}</div>
      <div className="px-4 py-3"><button type="button" aria-expanded={showOtherClients} aria-controls="mcp-client-tabs" onClick={() => {
        if (showOtherClients && selected >= 2) setSelected(0)
        setShowOtherClients(!showOtherClients); setCopied(null); setCopyError(false)
      }}>{showOtherClients ? t('Hide other clients') : t('Other clients: Gemini, Codex, Cursor and more')}</button></div>
      <div key={current.id} role="tabpanel" id={`agent-panel-${current.id}`} aria-labelledby={`agent-tab-${current.id}`} tabIndex={0} className="mcp-panel">
        <p className="mcp-kind">{t(current.kind)}</p><h3>{t(current.title)}</h3>
        <ol className="mcp-steps">{current.steps.map((step, index) => <li key={index}><span aria-hidden="true">{index + 1}</span><p>{t(step)}</p></li>)}</ol>
        {current.code && <div className="mcp-code"><div><span>{current.id === 'cursor' ? t('MCP configuration') : t('Run in your terminal')}</span><button type="button" onClick={() => void copy(current.code!, 'code')}>{copied === 'code' ? t('Copied') : t('Copy')}</button></div><pre><code>{current.code}</code></pre></div>}
        {current.note && <p className="mcp-note">{t(current.note)}</p>}
        <a href={current.source} target="_blank" rel="noreferrer" className="mcp-source">{current.id === 'other' ? t('Full setup guide') : t('Official client instructions')} ↗</a>
      </div>
      {visibleGuides.filter(guide => guide.id !== current.id).map(guide => <div key={guide.id} hidden role="tabpanel" id={`agent-panel-${guide.id}`} aria-labelledby={`agent-tab-${guide.id}`} />)}
    </div>
    <div className="mcp-next"><article><p className="eyebrow">{t('CHOOSE WHAT YOUR CLIENT CAN DO')}</p><h3>{t('One story, or your whole library.')}</h3><p>{t('Choose')}{' '}<strong>{t('All my stories, including new stories')}</strong>{' '}{t('during consent to work across your library. Enable')}{' '}<strong>{t('Create new stories')}</strong>{' '}{t('and')}{' '}<strong>{t('Propose and apply edits')}</strong>{' '}{t('for authoring. Prose sharing and version restores have separate controls.')}</p><p>{t('Existing connections keep their permissions. Reconnect to grant new capabilities. Revoke access anytime in')}{' '}<Link to="/settings">{t('Settings')}</Link>.</p></article><article><div className="mcp-prompt-heading"><p className="eyebrow">{t('TRY YOUR FIRST REQUEST')}</p><button type="button" onClick={() => void copy(t(starterPrompt), 'prompt')}>{copied === 'prompt' ? t('Copied prompt') : t('Copy prompt')}</button></div><blockquote>{t(starterPrompt)}</blockquote></article></div>
    <p className="mcp-footnote">{t('Connected Claude or ChatGPT can use StoryTool\'s')}{' '}<strong>{t('search_story')}</strong>{' '}{t('tool to find exact names/phrases or related ideas, then read the relevant passages instead of the whole book. Meaning search needs to be enabled; prose access follows the permissions you grant.')}</p>
    <p role="status" className="mcp-copy-status">{copyError ? t('Clipboard access is unavailable. Select and copy the text manually.') : copied ? t('Copied to clipboard.') : ''}</p>
    <p className="mcp-footnote">{t('Your client supplies the model. Keep credentials out of chat. Client menus and availability can change—use the official guides. MCP icons appear in clients that display server branding.')}</p>
  </section>
}
