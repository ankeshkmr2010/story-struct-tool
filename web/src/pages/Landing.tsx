import { Link } from 'react-router-dom'
import { MCPSetup } from '../components/MCPSetup'

const features = [
  ['01', 'Give your idea a shape', 'Connect your premise, characters, acts, and beats. Plan from the top down or discover your structure as you write.'],
  ['02', 'See the whole story', 'Track events, people, and places on one timeline. Keep what happened separate from when your reader learns about it.'],
  ['03', 'Find your writing flow', 'Write a chapter on one scrolling manuscript. Add scene breaks when useful, open Context for structure, or enter Focus to make room for the words.'],
] as const

export default function Landing() {
  return <main className="landing">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="hero-copy">
        <p className="eyebrow"><span /> A workspace for fiction writers</p>
        <h1 id="landing-title">A spark of an idea.<br /><em>A story that holds together.</em></h1>
        <p className="hero-description">Bring your characters, plot, timeline, and prose into one place. Shape the bigger picture in Design, or open Write and begin a chapter. Your story has room to grow either way.</p>
        <div className="hero-actions"><Link to="/library" className="landing-primary">Start your story <span aria-hidden="true">↗</span></Link><Link to="/how-to-use" className="landing-secondary">See how it works <span aria-hidden="true">→</span></Link><a href="#mcp" className="landing-secondary">Connect your AI ↗</a></div>
        <p className="hero-footnote">For first drafts, ambitious rewrites, and everything between.</p>
      </div>
      <div className="story-preview" aria-label="Illustrative story outline showing linked beats, timeline events, and a character arc">
        <div className="preview-top"><img src="/branding/storytool.svg" width="32" height="32" alt="" /><span>The Last Lantern <small>A glimpse of your workspace</small></span><span className="preview-draft">Draft</span></div>
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
    <section className="landing-writing" aria-labelledby="writing-title">
      <div className="section-intro"><p className="eyebrow">WRITE, READ, AND DESIGN</p><h2 id="writing-title">Plan when you need to.<br />Write when you’re ready.</h2><p>Write, Read, and Design are tabs inside every story. All three work with the same chapters, scenes, and structure.</p></div>
      <div className="writing-workspaces">
        <article><span className="writing-tab-label">Write</span><h3>Stay with the manuscript.</h3><p>Name a chapter if you like, then start typing. Its scenes appear together on one scrolling page. Scene names are optional; add a scene break at the end or continue straight into the next chapter.</p></article>
        <article><span className="writing-tab-label">Read</span><h3>Experience the whole story.</h3><p>Read continuously across chapters without editing. Adjust the font and spacing, choose scrolling or pages, and enter Focus. Your reading place is remembered on this device.</p></article>
        <article><span className="writing-tab-label">Design</span><h3>Keep the bigger picture close.</h3><p>Develop your premise, characters, arcs, acts, beats, and threads. Explore the timeline and work with your assistant. Everything stays connected to the words in Write.</p></article>
      </div>
      <div className="writing-controls"><p><strong>Focus</strong><span>A full-screen manuscript with the surrounding panels hidden. Escape brings you back.</span></p><p><strong>Context</strong><span>Open the current scene’s details and chapter brief when you need them.</span></p><p><strong>Autosave</strong><span>See when your text has saved. If a save fails, your draft stays available for retry and recovery in that browser tab.</span></p></div>
      <Link to="/how-to-use#writing" className="landing-secondary">Explore the writing workspace →</Link>
    </section>
    <section className="landing-modes" aria-labelledby="modes-title"><div><p className="eyebrow">YOUR PROCESS, YOUR PACE</p><h2 id="modes-title">There’s more than one way<br />to find your story.</h2><Link to="/how-to-use#modes" className="landing-secondary">Explore the writing modes →</Link></div><div className="mode-list"><p><strong>Plotter</strong><span>Build your structure step by step.</span></p><p><strong>Pantser</strong><span>Start with scenes. Discover as you go.</span></p><p><strong>Hybrid</strong><span>A little planning. A little possibility.</span></p></div></section>
    <MCPSetup />
    <footer className="landing-footer"><span>StoryTool · Make room for your story.</span><Link to="/library">Open your writing workspace →</Link></footer>
  </main>
}
