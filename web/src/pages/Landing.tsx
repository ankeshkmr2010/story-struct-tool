import { Link } from 'react-router-dom'

const features = [
  ['01', 'Give your idea a shape', 'Connect your premise, characters, acts, and beats. Plan from the top down or discover your structure as you write.'],
  ['02', 'See the whole story', 'Track events, people, and places on one timeline. Keep what happened separate from when your reader learns about it.'],
  ['03', 'Write with context', 'Draft scenes with their purpose in view. Follow character arcs, spot gaps, and save whole-story versions before a rewrite.'],
] as const

export default function Landing() {
  return <main className="landing">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="hero-copy">
        <p className="eyebrow"><span /> A workspace for fiction writers</p>
        <h1 id="landing-title">A spark of an idea.<br /><em>A story that holds together.</em></h1>
        <p className="hero-description">Bring your characters, plot, timeline, and prose into one place. StoryTool helps you build the bigger picture while leaving room for the story to surprise you.</p>
        <div className="hero-actions"><Link to="/library" className="landing-primary">Start your story <span aria-hidden="true">↗</span></Link><Link to="/how-to-use" className="landing-secondary">See how it works <span aria-hidden="true">→</span></Link></div>
        <p className="hero-footnote">For first drafts, ambitious rewrites, and everything between.</p>
      </div>
      <div className="story-preview" aria-label="Illustrative story outline showing linked beats, timeline events, and a character arc">
        <div className="preview-top"><span className="preview-mark">S</span><span>The Last Lantern <small>A glimpse of your workspace</small></span><span className="preview-draft">Draft</span></div>
        <div className="preview-body">
          <p className="preview-label">THE PREMISE</p><p className="preview-premise">When the island's last lantern goes dark, a reluctant keeper must choose who to trust.</p>
          <div className="preview-section"><span>Story timeline</span><small>What happens in the world</small></div>
          <ol className="preview-timeline">
            <li><span className="timeline-dot" /><div><small>THE SPARK · INCITING INCIDENT</small><strong>The lantern goes out</strong><p>Maya · Lighthouse</p></div></li>
            <li><span className="timeline-dot" /><div><small>THE TURN · MIDPOINT</small><strong>A secret beneath the harbor</strong><p>Maya & Eli · Harbor</p></div></li>
            <li><span className="timeline-dot" /><div><small>THE CHOICE · CLIMAX</small><strong>Keep the light together</strong><p>Maya & Eli · Lighthouse</p></div></li>
          </ol>
          <div className="preview-arc"><span>Maya's arc</span><p>Isolation <span aria-hidden="true">→</span> Trust <span aria-hidden="true">→</span> Belonging</p></div>
        </div>
        <div className="preview-bottom"><span className="saved-dot" /> Structure and scenes, connected.</div>
      </div>
    </section>
    <section className="landing-features" aria-labelledby="features-title"><div className="section-intro"><p className="eyebrow">FROM FIRST IDEA TO FINAL SCENE</p><h2 id="features-title">Keep the threads in your hands.</h2></div><div className="feature-grid">{features.map(([number, title, description]) => <article key={number}><span className="feature-number">{number}</span><h3>{title}</h3><p>{description}</p></article>)}</div></section>
    <section className="landing-modes" aria-labelledby="modes-title"><div><p className="eyebrow">YOUR PROCESS, YOUR PACE</p><h2 id="modes-title">There’s more than one way<br />to find your story.</h2><Link to="/how-to-use#modes" className="landing-secondary">Explore the writing modes →</Link></div><div className="mode-list"><p><strong>Plotter</strong><span>Build your structure step by step.</span></p><p><strong>Pantser</strong><span>Start with scenes. Discover as you go.</span></p><p><strong>Hybrid</strong><span>A little planning. A little possibility.</span></p></div></section>
    <footer className="landing-footer"><span>StoryTool · Make room for your story.</span><Link to="/library">Open your writing workspace →</Link></footer>
  </main>
}
