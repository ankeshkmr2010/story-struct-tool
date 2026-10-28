import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t, tx } from '../i18n'

// A complete public story, linked so visitors can see the result before signing in.
// The token belongs to the Red-Headed League demo's showcase; rotating that link breaks this one.
const SHOWCASE = '/showcase/lkw4Mh-vzZpNfsVV0KDkyPxJ9KZo9H0E'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Fades a block up the first time it scrolls into view; shown at once with reduced motion.
function Reveal({ className = '', children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || reducedMotion() || !('IntersectionObserver' in window)) { setShown(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setShown(true); observer.disconnect() }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return <div ref={ref} className={`lp-reveal${shown ? ' is-in' : ''}${className ? ` ${className}` : ''}`}>{children}</div>
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="lp-frame"><div className="lp-frame-bar" aria-hidden="true"><span /><span /><span /></div>{children}</div>
}

const check = <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
const spark = (size: number, className?: string) => <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5c.5 4.6 2.9 7 9.5 9.5-6.6 2.5-9 4.9-9.5 9.5-.5-4.6-2.9-7-9.5-9.5 6.6-2.5 9-4.9 9.5-9.5z" /></svg>

const steps: [ReactNode, string, string][] = [
  [<><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" /></>, tx('Plan'), tx('Build your cast, world and timeline, as much or as little as you like.')],
  [<><path d="M16.5 3.5l4 4L8 20H4v-4z" /><path d="M14 6l4 4" /></>, tx('Write'), tx('Draft chapter by chapter with your plan open beside the page.')],
  [<><circle cx="12" cy="12" r="8.5" /><path d="M8 12.3l2.8 2.7L16.2 9.5" /></>, tx('Review'), tx('Catch slips, check the craft, and keep only the AI changes you want.')],
]

// Illustrative 15-scene pacing chart; to be replaced by a real app screenshot.
const heights = [50, 72, 40, 64, 58, 80, 96, 98, 95, 97, 44, 70, 52, 82, 60]
const shifts = [1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1]
const povs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1]
function PacingChart() {
  const x0 = 125, step = 30, bw = 18, base = 160
  const bx1 = x0 + 6 * step - 2, bx2 = x0 + 9 * step + bw + 2, by = 46
  return <div className="lp-pacing">
    <p className="lp-pacing-title">{t('Pacing')}</p>
    <p className="lp-pacing-sub">{t('15 scenes · 41,820 words · value shifts in 9 of 15')}</p>
    <svg viewBox="0 0 600 250" role="img" aria-label={t('Pacing chart: scenes 7 to 10 are long, with no value shift. Act 2 sags here.')}>
      <g className="lp-chart-label" fontSize="12"><text x="0" y={base - 30}>{t('Scene length')}</text><text x="0" y="196">{t('Value shift')}</text><text x="0" y="232">{t('Point of view')}</text></g>
      <line x1={x0 - 6} x2={x0 + 14 * step + bw + 6} y1={base + 0.5} y2={base + 0.5} className="lp-chart-axis" />
      {heights.map((h, i) => {
        const x = x0 + i * step
        return <g key={i}>
          <rect x={x} y={base - h} width={bw} height={h} rx="3" className="lp-chart-bar" />
          {shifts[i] ? <circle cx={x + bw / 2} cy="192" r="6" className="lp-chart-bar" /> : <circle cx={x + bw / 2} cy="192" r="5" strokeWidth="2" className="lp-chart-noshift" />}
          <rect x={x - 5} y="224" width={step - 2} height="8" rx="2" className={povs[i] ? 'lp-pov-eli' : 'lp-pov-maya'} />
          <text x={x + bw / 2} y="248" textAnchor="middle" fontSize="10" className="lp-chart-label">{i + 1}</text>
        </g>
      })}
      <path d={`M${bx1} ${by + 8} V${by} H${bx2} V${by + 8}`} fill="none" strokeWidth="2" strokeLinejoin="round" className="lp-chart-sag" />
      <text x={(bx1 + bx2) / 2} y={by - 12} textAnchor="middle" fontSize="12" fontWeight="600" className="lp-chart-sag-text">{t('Act 2 sags here: long scenes, no value shift')}</text>
    </svg>
    <ul className="lp-legend">
      <li><span className="lp-sw lp-chart-bar" />{t('Scene length')}</li>
      <li><span className="lp-sw is-dot lp-chart-bar" />{t('Value shift')}</li>
      <li><span className="lp-sw is-dot is-ring" />{t('No shift')}</li>
      <li><span className="lp-sw lp-pov-maya" />{t('Maya POV')}</li>
      <li><span className="lp-sw lp-pov-eli" />{t('Eli POV')}</li>
    </ul>
  </div>
}

// [tab, description, screenshot, alt]
const tabs = [
  [tx('Write'), tx('One page per chapter. Name scenes later, or never.'), '/landing/tab-write.webp', tx('Write tab')],
  [tx('Read'), tx('Read across chapters by page or by scroll, like a book.'), '/landing/tab-read.webp', tx('Read tab')],
  [tx('Images'), tx('Place illustrations in the prose and keep reference art by your plan.'), '/landing/tab-images.webp', tx('Images tab')],
  [tx('Search'), tx('Find any name, phrase or idea across your story.'), '/landing/tab-search.webp', tx('Search tab')],
  [tx('Beta readers'), tx('Share a frozen draft with invited readers, or open a public showcase.'), '/landing/tab-beta.webp', tx('Beta readers tab')],
  [tx('Import & export'), tx('Bring in Word or Scrivener. Leave as Word, EPUB, PDF or Markdown.'), '/landing/tab-export.webp', tx('Import and export tab')],
] as const

function FeatureTabs() {
  const [tab, setTab] = useState(0)
  const select = (index: number, focus = false) => {
    setTab(index)
    const button = document.getElementById(`lp-tab-${index}`)
    if (focus) button?.focus()
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
  return <div className="lp-tabs">
    <div className="lp-pills" role="tablist" aria-label={t('Features')} onKeyDown={event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      event.preventDefault()
      select((tab + step + tabs.length) % tabs.length, true)
    }}>{tabs.map(([label], index) => <button key={label} id={`lp-tab-${index}`} type="button" role="tab" className="lp-pill" aria-selected={tab === index} aria-controls="lp-panel" tabIndex={tab === index ? 0 : -1} onClick={() => select(index)}>{t(label)}</button>)}</div>
    <div id="lp-panel" role="tabpanel" aria-labelledby={`lp-tab-${tab}`}>
      <p key={tab} className="lp-desc" aria-live="polite">{t(tabs[tab][1])}</p>
      <Frame><div className="lp-stage">{tabs.map(([label, , src, alt], index) => <img key={label} src={src} alt={index === tab ? t(alt) : ''} aria-hidden={index !== tab} className={index === tab ? 'is-active' : undefined} loading="lazy" decoding="async" />)}</div></Frame>
    </div>
  </div>
}

export default function Landing() {
  return <main className="lp">
    <section className="lp-hero">
      <div className="lp-wrap">
        <Reveal>
          <p className="lp-eyebrow">{t('For novelists')}</p>
          <h1 className="lp-h1">{t('Your novel\'s memory,')}<br /><em>{t('for you and your AI.')}</em></h1>
          <p className="lp-sub">{t('Cast, world, timeline and chapters in one place. Write with Claude, ChatGPT, Gemini, or no AI at all.')}</p>
          <div className="lp-ctas">
            <span className="lp-ctaone"><Link to="/try" className="lp-btn">{t('Try the guided tour')}</Link><span className="lp-note">{t('3 min · no account')}</span></span>
            <Link to="/library" className="lp-arrow">{t('Start writing →')}</Link>
          </div>
          <ul className="lp-trust">
            <li>{check}{t('Free during beta')}</li>
            <li>{check}{t('Your manuscript never trains AI')}</li>
            <li>{check}{t('Export any time')}</li>
          </ul>
        </Reveal>
        <Reveal className="lp-shot">
          <Frame><img src="/landing/tab-write.webp" alt={t('StoryTool\'s Write view: a chapter open beside the story plan')} /></Frame>
          <aside className="lp-float" aria-label={t('Consistency finding')}>
            <p className="lp-float-label">{t('Names')}</p>
            <p className="lp-float-text">{t('\'Maia\' is probably Maya')}</p>
            <Link to="/try">{t('Fix all 9 →')}</Link>
          </aside>
        </Reveal>
      </div>
    </section>

    <div className="lp-credit"><div className="lp-wrap"><p>{spark(13)}{t('Built with early readers and writers.')}{' '}<Link to="/thanks">{t('Read the shoutouts →')}</Link></p></div></div>

    <section className="lp-section lp-band" id="how">
      <Reveal className="lp-wrap lp-center">
        <p className="lp-eyebrow">{t('How it works')}</p>
        <h2 className="lp-h2">{t('Plan, write, review.')}</h2>
        <ol className="lp-steps">{steps.map(([icon, title, line], index) => <li key={title} className="lp-step">
          <div className="lp-step-num"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg></div>
          <p className="lp-step-n">{String(index + 1).padStart(2, '0')}</p>
          <h3>{t(title)}</h3>
          <p>{t(line)}</p>
        </li>)}</ol>
      </Reveal>
    </section>

    <section className="lp-section lp-feature">
      <div className="lp-wrap">
        <Reveal>
          <p className="lp-eyebrow">{t('Consistency')}</p>
          <h2 className="lp-h2">{t('Maia or Maya? It notices.')}</h2>
          <p className="lp-body">{t('StoryTool spots misspelt names and fixes every copy at once. A snapshot is saved first, so nothing is lost.')}</p>
          <Link to="/how-to-use#feedback" className="lp-arrow">{t('How consistency checks work →')}</Link>
        </Reveal>
        <Reveal className="lp-media"><div className="lp-soft"><Frame><img src="/landing/consistency.webp" alt={t('A consistency finding: \'Maia\' appears 9 times and is probably Maya')} loading="lazy" decoding="async" /></Frame></div></Reveal>
      </div>
    </section>

    <section className="lp-section lp-feature is-flip">
      <div className="lp-wrap">
        <Reveal>
          <p className="lp-eyebrow">{t('Craft checks')}</p>
          <h2 className="lp-h2">{t('See where your plot sags.')}</h2>
          <p className="lp-body">{t('Scene length, value shifts and point of view across the whole book, at a glance. No AI needed.')}</p>
          <Link to="/how-to-use#feedback" className="lp-arrow">{t('How craft checks work →')}</Link>
        </Reveal>
        <Reveal className="lp-media"><Frame><PacingChart /></Frame></Reveal>
      </div>
    </section>

    <section className="lp-section lp-feature">
      <div className="lp-wrap">
        <Reveal>
          <p className="lp-eyebrow">{t('AI, optional')}</p>
          <h2 className="lp-h2">{t('Your AI proposes. You decide.')}</h2>
          <p className="lp-body">{t('Every AI edit arrives as a proposal. Keep all, some or none, undo anything, and see who wrote what.')}</p>
          <Link to="/how-to-use#write-with-ai" className="lp-arrow">{t('How writing with AI works →')}</Link>
        </Reveal>
        <Reveal className="lp-media"><Frame><img src="/landing/proposal.webp" alt={t('An AI proposal box with options to keep or reject each change')} loading="lazy" decoding="async" /></Frame></Reveal>
      </div>
    </section>

    <section className="lp-section lp-band">
      <Reveal className="lp-wrap">
        <div className="lp-center"><p className="lp-eyebrow">{t('And the rest')}</p><h2 className="lp-h2">{t('Everything a long book needs.')}</h2></div>
        <FeatureTabs />
      </Reveal>
    </section>

    <section className="lp-close">
      <Reveal className="lp-wrap lp-center">
        <h2>{t('Your words can always leave.')}</h2>
        <p className="lp-body">{t('Import from Word, Scrivener or EPUB. Export whenever you like.')}</p>
        <ul className="lp-formats">{['Word', 'Scrivener', 'EPUB', 'PDF', 'Markdown'].map(name => <li key={name}>{name}</li>)}</ul>
        <div className="lp-ctas"><Link to="/try" className="lp-btn">{t('Try the guided tour')}</Link><Link to={SHOWCASE} className="lp-arrow">{t('See a finished story →')}</Link></div>
      </Reveal>
    </section>

    <section className="lp-thanks lp-band" aria-labelledby="lp-thanks-line">
      <Reveal className="lp-wrap lp-center">
        {spark(20, 'lp-thanks-icon')}
        <p className="lp-eyebrow">{t('Thank you')}</p>
        <p className="lp-thanks-line" id="lp-thanks-line">{t('Built with help from early readers and writers.')}</p>
        <div className="lp-thanks-links"><Link to="/thanks" className="lp-arrow">{t('Read the shoutouts →')}</Link><Link to="/roadmap" className="lp-thanks-more">{t('See what\'s next on the roadmap →')}</Link></div>
      </Reveal>
    </section>

    <footer className="lp-foot"><div className="lp-wrap">
      <p>{t('StoryTool · Make room for your story.')}</p>
      <nav aria-label={t('Footer')}><Link to="/roadmap">{t('Roadmap')}</Link><Link to="/thanks">{t('Shoutouts')}</Link><Link to="/privacy">{t('Privacy')}</Link><Link to="/pricing">{t('Pricing')}</Link><Link to="/about">{t('About')}</Link></nav>
    </div></footer>
  </main>
}
