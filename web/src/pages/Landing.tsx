import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t, tx } from '../i18n'

// A complete public story, linked so visitors can see the result before signing in.
// The token belongs to the Red-Headed League demo's showcase; rotating that link breaks this one.
const SHOWCASE = '/showcase/lkw4Mh-vzZpNfsVV0KDkyPxJ9KZo9H0E'

// Screenshots come from the /try sandbox (The Last Lantern), light theme, at 2x.
const proof: [ReactNode, string][] = [
  [<><path d="M12 8v4l3 2" /><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>, tx('Know who wrote what')],
  [<><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>, tx('Names stay consistent')],
  [<><path d="M20 6 9 17l-5-5" /></>, tx('Craft checks, no AI key needed')],
]

const showcase = [
  { id: 'consistency', title: tx('Catches Maia for Maya.'), line: tx('Spot every slip and fix them all in one go, with a snapshot first.'), image: '/landing/consistency.webp', alt: tx('Smart consistency finding: Maia is probably Maya, with fix options'), guide: '/how-to-use#feedback' },
  { id: 'craft', title: tx('See the shape of your book.'), line: tx('Pacing, scene rhythm, MICE threads and midpoint checks, all in one Run all.'), image: '/landing/pacing.webp', alt: tx('Pacing view: scene length, value shift and point of view for every scene'), guide: '/how-to-use#feedback' },
  { id: 'ai', title: tx('Your AI proposes. You choose.'), line: tx('Every edit is a proposal, and History shows who wrote what, ready to disclose.'), image: '/landing/proposal.webp', alt: tx('An AI proposal for a scene summary, cast and plan links, waiting for review'), guide: '/how-to-use#write-with-ai' },
]

// [tab, one line, screenshot, alt, guide]
const tabs = [
  [tx('Write'), tx('One page per chapter. Name scenes later, or never.'), '/landing/tab-write.webp', tx('The Write view with a chapter open and story context beside it'), '/how-to-use#writing'],
  [tx('Read'), tx('Read across chapters by page or by scroll, like a book.'), '/landing/tab-read.webp', tx('The Read view showing a chapter as pages'), '/how-to-use#writing'],
  [tx('Images'), tx('Place illustrations in the prose and keep reference art beside your plan.'), '/landing/tab-images.webp', tx('Inserting an illustration of a lantern into a scene'), '/how-to-use#images'],
  [tx('Search'), tx('Find any name, phrase or idea across your story.'), '/landing/tab-search.webp', tx('Search results for lantern across two scenes'), '/how-to-use#search'],
  [tx('Beta readers'), tx('Share a frozen draft with invited readers, or open a public showcase.'), '/landing/tab-beta.webp', tx('Sharing options: private readers or a public showcase'), '/how-to-use#beta-readers'],
  [tx('Import and export'), tx('Bring in Word or Scrivener, and leave as Word, EPUB, PDF or Markdown.'), '/landing/tab-export.webp', tx('A Word export preview with the illustration in place'), '/how-to-use#writing'],
] as const

function Shot({ src, alt }: { src: string; alt: string }) {
  return <figure className="shot-frame"><div className="shot-bar" aria-hidden="true"><i /><i /><i /></div><img src={src} alt={alt} loading="lazy" decoding="async" /></figure>
}

export default function Landing() {
  const [tab, setTab] = useState(0)
  return <main className="landing">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="hero-copy">
        <h1 id="landing-title">{t('Plan, write, and keep')}<br /><em>{t('your novel consistent.')}</em></h1>
        <p className="hero-description">{t('Use the AI you already have, or none at all.')}</p>
        <div className="hero-actions"><Link to="/try" className="landing-primary">{t('Try the guided tour')}{' '}<small>{t('3 min, no account')}</small></Link><Link to="/library" className="landing-secondary">{t('Start writing')}{' '}<span aria-hidden="true">→</span></Link></div>
        <p className="hero-trust"><Link to="/pricing">{t('Free during beta')}</Link><span aria-hidden="true">·</span><Link to="/privacy">{t('Never trains AI on your manuscript')}</Link></p>
      </div>
      <div className="story-preview" aria-label={t('Illustrative story outline showing linked beats, timeline events, and a character arc')}>
        <div className="preview-top"><img src="/branding/storytool.svg" width="32" height="32" alt="" /><span>{t('The Last Lantern')}{' '}<small>{t('A glimpse of your workspace')}</small></span><span className="preview-draft">{t('Draft')}</span></div>
        <div className="preview-body">
          <p className="preview-label">{t('THE PREMISE')}</p><p className="preview-premise">{t('When the island\'s last lantern goes dark, a reluctant keeper must choose who to trust.')}</p>
          <div className="preview-section"><span>{t('Story timeline')}</span><small>{t('What happens in the world')}</small></div>
          <ol className="preview-timeline">
            <li><span className="timeline-dot" /><div><small>{t('THE SPARK · INCITING INCIDENT')}</small><strong>{t('The lantern goes out')}</strong><p>{t('Maya · Lighthouse')}</p></div></li>
            <li><span className="timeline-dot" /><div><small>{t('THE TURN · MIDPOINT')}</small><strong>{t('A secret beneath the harbor')}</strong><p>{t('Maya & Eli · Harbor')}</p></div></li>
            <li><span className="timeline-dot" /><div><small>{t('THE CHOICE · CLIMAX')}</small><strong>{t('Keep the light together')}</strong><p>{t('Maya & Eli · Lighthouse')}</p></div></li>
          </ol>
          <div className="preview-arc"><span>{t('Maya\'s arc')}</span><p>{t('Isolation')}{' '}<span aria-hidden="true">→</span>{' '}{t('Trust')}{' '}<span aria-hidden="true">→</span>{' '}{t('Belonging')}</p></div>
        </div>
        <div className="preview-bottom"><span className="saved-dot" />{' '}{t('Structure and scenes, connected.')}</div>
      </div>
    </section>

    <section className="proof-strip" aria-label={t('What StoryTool does')}>
      {proof.map(([icon, label]) => <p key={label}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>{t(label)}</p>)}
    </section>

    {showcase.map(({ id, title, line, image, alt, guide }, index) => <section key={id} className={`landing-showcase${index % 2 ? ' is-reversed' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="showcase-copy"><h2 id={`${id}-title`}>{t(title)}</h2><p>{t(line)}</p><Link to={guide} className="landing-secondary">{t('How it works →')}</Link></div>
      <Shot src={image} alt={t(alt)} />
    </section>)}

    <section className="landing-tour" aria-labelledby="more-title">
      <h2 id="more-title">{t('Everything else')}</h2>
      <div className="tour-tabs" role="tablist" aria-label={t('Everything else')} onKeyDown={event => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        const next = (tab + step + tabs.length) % tabs.length
        setTab(next); document.getElementById(`tour-tab-${next}`)?.focus()
      }}>{tabs.map(([label], index) => <button key={label} id={`tour-tab-${index}`} type="button" role="tab" aria-selected={tab === index} aria-controls="tour-panel" tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)}>{t(label)}</button>)}</div>
      <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${tab}`} className="tour-panel"><p>{t(tabs[tab][1])} <Link to={tabs[tab][4]} className="landing-secondary">{t('How it works →')}</Link></p><Shot src={tabs[tab][2]} alt={t(tabs[tab][3])} /></div>
    </section>

    <section className="landing-closing" aria-labelledby="keep-title">
      <h2 id="keep-title">{t('Your words can always leave.')}</h2>
      <ul className="format-row" aria-label={t('Import and export formats')}>{['Word', 'Scrivener', 'EPUB', 'PDF', 'Markdown'].map(name => <li key={name}>{name}</li>)}</ul>
      <div className="hero-actions"><Link to="/try" className="landing-primary">{t('Try the guided tour')}{' '}<span aria-hidden="true">→</span></Link><Link to={SHOWCASE} className="landing-secondary">{t('See a finished story →')}</Link></div>
    </section>

    <div className="landing-banners">
      <Link to="/thanks" className="landing-banner is-filled"><span aria-hidden="true">🎉</span><span>{t('Shoutouts to the people who made this happen')}</span><span aria-hidden="true">→</span></Link>
      <Link to="/roadmap" className="landing-banner"><span aria-hidden="true">🧭</span><span>{t('On the horizon: what we\'re building next')}</span><span aria-hidden="true">→</span></Link>
    </div>
    <footer className="landing-footer"><span>{t('StoryTool · Make room for your story.')}</span><Link to="/roadmap">{t('Roadmap')}</Link><Link to="/thanks">{t('Shoutouts')}</Link><Link to="/privacy">{t('Privacy')}</Link><Link to="/pricing">{t('Pricing')}</Link><Link to="/about">{t('About')}</Link><Link to="/library">{t('Start writing →')}</Link></footer>
  </main>
}
