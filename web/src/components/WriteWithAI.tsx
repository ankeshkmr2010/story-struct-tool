import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MCPSetup } from './MCPSetup'
import { t, tx } from '../i18n'

const prompts = [
  [tx('Get a useful critique'), 'Read my StoryTool story “[title]”. Tell me the three strongest revision opportunities, with specific scene evidence. Discuss your suggestions with me before changing anything.'],
  [tx('Catch up the outline'), 'Read the prose in my StoryTool story “[title]” and propose missing scene summaries, cast, places, beats and thread links. Preserve every word of the manuscript. Stage one proposal for my review; do not apply it.'],
  [tx('Revise one scene'), 'In my StoryTool story “[title]”, revise “[scene]” to [your goal]. Keep the viewpoint, voice and established facts consistent. Propose focused prose edits and stage them for review. Do not apply them until I approve.'],
  [tx('Review the craft'), 'Run the Value shift versus prose review for my StoryTool story “[title]”. Read the relevant scenes, cite evidence and save the review in Evaluate. Do not change my story.'],
  [tx('Work through beta feedback'), 'Read the open beta feedback and round progress on my StoryTool story “[title]”. Group the comments by issue, tell me which to address first with scene evidence, and draft replies to readers for me to review. Do not send anything or change my story until I approve.'],
  [tx('Plan a manuscript import'), 'I uploaded a manuscript in StoryTool’s import window (upload_id [id]). Read its whole outline, plan where chapters and scenes start, what to skip and any titles, preview the result and show me the outline. Import it only after I approve.'],
] as const

export function WriteWithAI() {
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState('')
  return <div className="mt-8 space-y-10">
    <section aria-labelledby="ai-quickstart"><p className="eyebrow">{t('QUICKSTART')}</p><h2 id="ai-quickstart" className="text-2xl font-semibold">{t('Connect, ask, review.')}</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{t('Use the AI you already talk to. It reads your story through StoryTool and can propose edits for you to review.')}</p><ol className="mt-5 space-y-3 text-sm leading-6">{[
      <>{t('Sign in to StoryTool and create, import or open a story in')}{' '}<Link to="/library" className="underline">{t('Your stories')}</Link>.</>,
      <>{t('Follow the connection guide below for Claude, ChatGPT, Gemini or another client. Authorize your story; choose library access if you also want your AI to create or import stories.')}</>,
      <>{t('Enable StoryTool in your AI conversation. Replace “[title]” in a prompt below with your story’s title and ask it to read the story first.')}</>,
      <>{t('Discuss the suggestions. Ask for one focused proposal and tell your AI to stage it without applying it.')}</>,
      <>{t('Return to')}{' '}<strong>{t('Design → Agent changes')}</strong>{t('. Review the proposed edits and accept all, some or none. Read saved craft reviews in')}{' '}<strong>{t('Design → Check my story')}</strong>.</>,
    ].map((step, index) => <li key={index} className="flex gap-3"><strong className="shrink-0 text-[var(--accent)]">{t('Step {0}', index + 1)}</strong><span>{step}</span></li>)}</ol></section>
    <MCPSetup />
    <section aria-labelledby="ai-prompts"><p className="eyebrow">{t('COPY A STARTER PROMPT')}</p><h2 id="ai-prompts" className="text-2xl font-semibold">{t('Give your AI a clear job.')}</h2><p className="mt-3 text-sm text-[var(--muted)]">{t('Replace the bracketed parts. Start small, check the result, then ask for the next change.')}</p><div className="mt-5 grid gap-4 md:grid-cols-2">{prompts.map(([title, prompt]) => <article key={title} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5"><h3 className="font-semibold">{t(title)}</h3><p className="my-3 text-sm leading-6">{prompt}</p><button type="button" className="share-story-button" onClick={async () => { try { await navigator.clipboard.writeText(prompt); setCopied(title); setError('') } catch { setError(t('Could not copy. Select the prompt above and copy it manually.')) } }}>{copied === title ? t('Copied') : t('Copy prompt')}</button></article>)}</div>{error && <p role="alert" className="writer-error mt-3">{error}</p>}</section>
    <section className="rounded-xl border border-[var(--line)] p-5"><h2 className="text-lg font-semibold">{t('Prefer the assistant inside StoryTool?')}</h2><p className="mt-2 text-sm leading-6">{t('Save your provider connection in')}{' '}<Link to="/settings" className="underline">{t('Settings')}</Link>{t(', then open Assistant in your story. The same principle applies: ask for a focused proposal, review it in Agent changes, and choose what to keep. Catch up and AI reviews also work through a connected provider.')}</p></section>
  </div>
}
