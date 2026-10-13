import { Link } from 'react-router-dom'
import { MCPSetup } from '../components/MCPSetup'

// A complete public story, linked so visitors can see the result before signing in.
// The token belongs to the Red-Headed League demo's showcase; rotating that link breaks this one.
const SHOWCASE = '/showcase/lkw4Mh-vzZpNfsVV0KDkyPxJ9KZo9H0E'

const plan = [
  ['01', 'Eight levels, at your pace', 'Premise, arc, characters, acts, beats, threads, chapters, scenes. Plan top-down as a plotter, discover as a pantser, or mix both. The plan guides; it never locks.'],
  ['02', 'One timeline, two orders', 'See events in the order they happen and in the order your reader meets them, so flashbacks stay straight. Add an event exactly where it belongs.'],
  ['03', 'Gaps flagged, never blocked', 'Each level shows what it still needs, in plain words, with a link to fix it. You decide when, or whether, to act.'],
] as const

const craft = [
  ['01', 'Know who wrote what', 'Your words and AI changes have a record. See who changed each field in History, review proposed edits, and choose what to keep.'],
  ['02', 'Keep your threads connected', 'MICE thread nesting shows where each storyline opens and closes, and flags threads that resolve out of order. Ask an AI to review the promises and payoffs.'],
  ['03', 'Find your scene rhythm', 'Scene and sequel checks highlight long runs of action or reaction, so you can decide where the story needs room to breathe.'],
  ['04', 'Misbelief at midpoint', 'Ask an AI to review how the midpoint challenges a character’s false belief, using evidence from your story.'],
  ['05', 'Value shift versus prose', 'Compare a scene’s planned emotional change with what its prose delivers, and consider where to revise.'],
] as const

export default function Landing() {
  return <main className="landing">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="hero-copy">
        <p className="eyebrow"><span /> A workspace for novel writers</p>
        <h1 id="landing-title">Plan, write, and keep<br /><em>your novel consistent.</em></h1>
        <p className="hero-description">With the AI you already use or none at all. Your manuscript, its structure and its timeline in one place; every change is yours to keep or undo.</p>
        <div className="hero-actions"><Link to="/library" className="landing-primary">Start your story <span aria-hidden="true">↗</span></Link><Link to={SHOWCASE} className="landing-secondary">See a finished story <span aria-hidden="true">→</span></Link></div>
        <div className="hero-assurances">
          <Link to="/pricing"><strong>Free during beta</strong><span>No StoryTool subscription charge. Pricing details →</span></Link>
          <Link to="/privacy"><strong>StoryTool doesn't train AI on your manuscript.</strong><span>Connected AI services have their own policies. Privacy details →</span></Link>
        </div>
        <p className="hero-footnote">New here? <Link to="/how-to-use">See how it works →</Link> · <Link to="/roadmap">On the horizon →</Link></p>
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

    <div className="landing-banners">
      <Link to="/thanks" className="landing-banner is-filled"><span aria-hidden="true">🎉</span><span>Shoutouts to the people who made this happen</span><span aria-hidden="true">→</span></Link>
      <Link to="/roadmap" className="landing-banner"><span aria-hidden="true">🧭</span><span>On the horizon: what we're building next</span><span aria-hidden="true">→</span></Link>
    </div>

    <section className="landing-features" aria-labelledby="craft-title">
      <div className="section-intro"><p className="eyebrow">SEE YOUR STORY CLEARLY</p><h2 id="craft-title">See the changes.<br />Check the craft.</h2><p>On-demand suggestions and a record of authorship, with you in control.</p></div>
      <div className="feature-grid">{craft.map(([number, title, description]) => <article key={number}><span className="feature-number">{number}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
    </section>

    <section className="landing-writing" aria-labelledby="write-title">
      <div className="section-intro"><p className="eyebrow">WRITE</p><h2 id="write-title">Start with the words.</h2><p>Open a story and type. Chapters, scenes and structure can come later, or never.</p></div>
      <div className="writing-workspaces">
        <article><span className="writing-tab-label">Write</span><h3>One page per chapter.</h3><p>A single scrolling manuscript for each chapter. Name scenes if it helps, or just keep typing into the next one.</p></article>
        <article><span className="writing-tab-label">Read</span><h3>Read it like a book.</h3><p>Read across chapters by page or by scroll, set your own type, and pick up where you left off.</p></article>
        <article><span className="writing-tab-label">Focus</span><h3>Nothing but the words.</h3><p>Hide everything around the manuscript. Autosave shows when your words are safe, and a failed save keeps your draft for a retry.</p></article>
      </div>
    </section>

    <section className="landing-features" aria-labelledby="plan-title"><div className="section-intro"><p className="eyebrow">PLAN</p><h2 id="plan-title">Structure when you want it.<br />Never in the way.</h2></div><div className="feature-grid">{plan.map(([number, title, description]) => <article key={number}><span className="feature-number">{number}</span><h3>{title}</h3><p>{description}</p></article>)}</div></section>

    <section className="landing-writing" aria-labelledby="ai-title">
      <div className="section-intro"><p className="eyebrow">SOLO OR WITH AI</p><h2 id="ai-title">Your AI writes with you.<br />You decide.</h2><p>Everything above works on your own. If you write with Claude or ChatGPT, connect it and it works on the same story you do. Already have prose? It can draft the outline from what you've written.</p></div>
      <div className="writing-workspaces">
        <article><span className="writing-tab-label">Context</span><h3>It knows the whole story.</h3><p>Characters, arcs, timeline, places and glossary, not just the page in front of it.</p></article>
        <article><span className="writing-tab-label">Agent changes</span><h3>It proposes. You choose.</h3><p>Every edit arrives as a proposal. Keep all of it, some of it or none, and undo what you applied.</p></article>
        <article><span className="writing-tab-label">History</span><h3>Every change on record.</h3><p>Restore any saved version, and see who wrote what: you, the assistant or a connected AI.</p></article>
      </div>
    </section>
    <section className="landing-writing" aria-labelledby="search-title">
      <article className="section-intro rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 sm:p-8"><p className="eyebrow">FIND YOUR WORDS</p><h2 id="search-title">Find any line, or any idea,<br />across your library.</h2><p>Search prose and story details, narrow results by type or field, and jump to the matching passage. Text search finds names and phrases; meaning search finds related ideas when enabled.</p><Link to="/how-to-use#search" className="landing-secondary">How search works →</Link></article>
    </section>
    <MCPSetup />

    <section id="sharing" className="landing-sharing" aria-labelledby="sharing-title">
      <div className="section-intro sharing-intro">
        <p className="eyebrow">SHARE</p>
        <h2 id="sharing-title">Ready for readers.</h2>
        <p>Collect private beta feedback on a fixed draft, share your latest manuscript, or give your story a public page anyone can open.</p>
        <div className="sharing-actions"><Link to={SHOWCASE} className="landing-primary">See a showcase <span aria-hidden="true">→</span></Link><Link to="/how-to-use#beta-readers" className="landing-secondary">How beta reading works →</Link></div>
      </div>
      <div className="sharing-permissions">
        <article><span className="writing-tab-label">Beta readers</span><h3>Feedback you can talk through.</h3><p>Publish a frozen manuscript round, send a signed-in invitation and approve readers. Each passage comment becomes a private conversation with you, with replies, an open or resolved state and a link you can return to.</p></article>
        <article><span className="writing-tab-label">Beta polls</span><h3>Ask your readers directly.</h3><p>Put questions to a beta round and see the results below reader management. Choose named or anonymous answers, let readers update their response while a poll is open, and keep past results when a question changes.</p></article>
        <article><span className="writing-tab-label">Reader link</span><h3>For the readers you pick.</h3><p>Invite someone by their sign-in email. They read your latest draft with characters and timeline close at hand, and can import their own copy if you allow it.</p></article>
        <article><span className="writing-tab-label">Public showcase</span><h3>For anyone with the link.</h3><p>Turn on a page with your premise, cast and timeline. Visitors need no account, and you can change or switch off the link at any time.</p></article>
      </div>
      <ol className="sharing-steps"><li><span>01</span><p>Open <strong>Beta readers</strong> or <strong>Share</strong> beside it.</p></li><li><span>02</span><p>Publish a beta round, invite a reader by email, or turn on the showcase.</p></li><li><span>03</span><p>Send the link.</p></li></ol>
      <p className="sharing-footnote">Your private notes, version history and AI conversations stay private. You can revoke access later; copies already imported remain independent.</p>
    </section>

    <section className="landing-modes" aria-labelledby="keep-title"><div><p className="eyebrow">YOURS TO KEEP</p><h2 id="keep-title">Your words can<br />always leave.</h2></div><div className="mode-list"><p><strong>Manuscript</strong><span>Export to Word, Markdown, PDF, EPUB, HTML or plain text.</span></p><p><strong>Word import</strong><span>Start with prose from a .docx manuscript.</span></p><p><strong>Full backup</strong><span>Everything in one file, restorable as a new story.</span></p><p><strong>Versions</strong><span>Restore any saved version; your current draft is kept as a recovery copy.</span></p></div></section>

    <footer className="landing-footer"><span>StoryTool · Make room for your story.</span><Link to="/privacy">Privacy</Link><Link to="/pricing">Pricing</Link><Link to="/library">Start your story →</Link></footer>
  </main>
}
