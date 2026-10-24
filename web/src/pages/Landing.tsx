import { Link } from 'react-router-dom'
import { MCPSetup } from '../components/MCPSetup'
import { t, tx } from '../i18n'

// A complete public story, linked so visitors can see the result before signing in.
// The token belongs to the Red-Headed League demo's showcase; rotating that link breaks this one.
const SHOWCASE = '/showcase/lkw4Mh-vzZpNfsVV0KDkyPxJ9KZo9H0E'

const plan = [
  ['01', tx('Eight levels, at your pace'), tx('Premise, arc, characters, acts, beats, threads, chapters, scenes. Plan top-down as a plotter, discover as a pantser, or mix both. The plan guides; it never locks.')],
  ['02', tx('One timeline, two orders'), tx('See events in the order they happen and in the order your reader meets them, so flashbacks stay straight. Add an event exactly where it belongs.')],
  ['03', tx('Gaps flagged, never blocked'), tx('Each level shows what it still needs, in plain words, with a link to fix it. You decide when, or whether, to act.')],
  ['04', tx('Pacing at a glance'), tx('Scene length, value shift and point of view for the whole book on one chart. Spot the long middle and the run of scenes from one head, then open the scene.')],
  ['05', tx('Rename once, everywhere'), tx('Rename a character, place or term and every use in the prose follows, with each one shown first so you can keep any as written.')],
  ['06', tx('Merge the duplicate'), tx('When one person became two characters, merge them after a preview of what moves. The old name stays as an alias.')],
] as const

const craft = [
  ['01', tx('Know who wrote what'), tx('Your words and AI changes have a record. See who changed each field in History, review proposed edits, and copy an AI-use disclosure for agents, publishers or contests.')],
  ['02', tx('Keep your threads connected'), tx('MICE thread nesting shows where each storyline opens and closes, and flags threads that resolve out of order. The built-in reader checks your prose, with no AI key needed.')],
  ['03', tx('Find your scene rhythm'), tx('Scene and sequel checks highlight long runs of action or reaction, so you can decide where the story needs room to breathe.')],
  ['04', tx('Misbelief at midpoint'), tx('Check how the midpoint challenges a character’s false belief, using evidence read from your scenes. No AI key needed.')],
  ['05', tx('Value shift versus prose'), tx('Compare a scene’s planned emotional change with what its prose delivers, and consider where to revise.')],
  ['06', tx('Writing checks you can shape'), tx('Set character limits, look for problems or compare actions and intentions. Try a sample and get your own advice beside highlighted sentences, without coding or changing your prose.')],
  ['07', tx('Names and spellings, consistent'), tx('Catch Maia for Maya, colour in a US story and lantern-keeper written three ways. Smart consistency weighs how often each spelling appears and who is in the scene, and explains every finding.')],
  ['08', tx('Fix it everywhere at once'), tx('Open any finding at its exact line, or fix every occurrence in one go after a snapshot. Add a variant as an alias, or keep both and it stops asking.')],
  ['09', tx('Leave a TK, keep writing'), tx('Type [TK: name of the inn] and carry on. Every placeholder waits in its own list to fill or remove, and export asks before one slips through.')],
] as const

export default function Landing() {
  return <main className="landing">
    <section className="landing-hero" aria-labelledby="landing-title">
      <div className="hero-copy">
        <p className="eyebrow"><span />{' '}{t('A workspace for novel writers')}</p>
        <h1 id="landing-title">{t('Plan, write, and keep')}<br /><em>{t('your novel consistent.')}</em></h1>
        <p className="hero-description">{t('With the AI you already use or none at all. Your manuscript, its structure and its timeline in one place; every change is yours to keep or undo.')}</p>
        <div className="hero-actions"><Link to="/try" className="landing-primary">{t('Try the guided tour')}{' '}<span aria-hidden="true">→</span></Link><Link to="/library" className="landing-secondary">{t('Start your story')}{' '}<span aria-hidden="true">→</span></Link></div>
        <p className="hero-footnote">{t('Explore a real story in three minutes. No account needed.')}</p>
        <div className="hero-assurances">
          <Link to="/pricing"><strong>{t('Free during beta')}</strong><span>{t('No StoryTool subscription charge. Pricing details →')}</span></Link>
          <Link to="/privacy"><strong>{t('StoryTool doesn\'t train AI on your manuscript.')}</strong><span>{t('Connected AI services have their own policies. Privacy details →')}</span></Link>
        </div>
        <p className="hero-footnote">{t('New here?')}{' '}<Link to="/how-to-use">{t('See how it works →')}</Link> · <Link to={SHOWCASE}>{t('See a finished story →')}</Link></p>
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

    <div className="landing-banners">
      <Link to="/thanks" className="landing-banner is-filled"><span aria-hidden="true">🎉</span><span>{t('Shoutouts to the people who made this happen')}</span><span aria-hidden="true">→</span></Link>
      <Link to="/roadmap" className="landing-banner"><span aria-hidden="true">🧭</span><span>{t('On the horizon: what we\'re building next')}</span><span aria-hidden="true">→</span></Link>
    </div>

    <section className="landing-features" aria-labelledby="craft-title">
      <div className="section-intro"><p className="eyebrow">{t('SEE YOUR STORY CLEARLY')}</p><h2 id="craft-title">{t('See the changes.')}<br />{t('Check the craft.')}</h2><p>{t('On-demand suggestions, every craft check in one Run all, and a record of authorship, with you in control.')}</p></div>
      <div className="feature-grid">{craft.map(([number, title, description]) => <article key={number}><span className="feature-number">{number}</span><h3>{t(title)}</h3><p>{t(description)}</p></article>)}</div>
    </section>

    <section className="landing-writing" aria-labelledby="write-title">
      <div className="section-intro"><p className="eyebrow">{t('WRITE')}</p><h2 id="write-title">{t('Start with the words.')}</h2><p>{t('Open a story and type. Chapters, scenes and structure can come later, or never.')}</p></div>
      <div className="writing-workspaces">
        <article><span className="writing-tab-label">{t('Write')}</span><h3>{t('One page per chapter.')}</h3><p>{t('A single scrolling manuscript for each chapter. Name scenes if it helps, or just keep typing into the next one. Select text for editing actions, check a scene, character or place open beside the page, and reopen on any device where you stopped.')}</p></article>
        <article><span className="writing-tab-label">{t('Read')}</span><h3>{t('Read it like a book.')}</h3><p>{t('Read across chapters by page or by scroll, set your own type, and pick up where you left off. Click an illustration for a larger preview and its caption.')}</p></article>
        <article><span className="writing-tab-label">{t('Focus')}</span><h3>{t('Nothing but the words.')}</h3><p>{t('Hide everything around the manuscript. Autosave shows when your words are safe, and a failed save keeps your draft for a retry.')}</p></article>
      </div>
    </section>

    <section className="landing-features" aria-labelledby="plan-title"><div className="section-intro"><p className="eyebrow">{t('PLAN')}</p><h2 id="plan-title">{t('Structure when you want it.')}<br />{t('Never in the way.')}</h2></div><div className="feature-grid">{plan.map(([number, title, description]) => <article key={number}><span className="feature-number">{number}</span><h3>{t(title)}</h3><p>{t(description)}</p></article>)}</div></section>

    <section className="landing-writing" aria-labelledby="images-title"><div className="section-intro"><p className="eyebrow">{t('IMAGES')}</p><h2 id="images-title">{t('Make room for illustrations.')}</h2><p>{t('Insert images where they belong in your manuscript, or keep maps and character art beside your planning details. Add captions, preview them while reading, and manage current uses from Images in the story header.')}</p><Link to="/how-to-use#images" className="landing-secondary">{t('How images work →')}</Link></div></section>

    <section className="landing-writing" aria-labelledby="ai-title">
      <div className="section-intro"><p className="eyebrow">{t('SOLO OR WITH AI')}</p><h2 id="ai-title">{t('Your AI writes with you.')}<br />{t('You decide.')}</h2><p>{t('Everything above works on your own. If you write with Claude, ChatGPT or Gemini, connect it and it works on the same story you do. Already have prose? It can plan the import of your Word or Scrivener manuscript, then draft the outline from what you\'ve written.')}</p></div>
      <div className="writing-workspaces">
        <article><span className="writing-tab-label">{t('Context')}</span><h3>{t('It knows the whole story.')}</h3><p>{t('Characters, arcs, timeline, places and glossary, not just the page in front of it.')}</p></article>
        <article><span className="writing-tab-label">{t('Agent changes')}</span><h3>{t('It proposes. You choose.')}</h3><p>{t('Every edit arrives as a proposal. Keep all of it, some of it or none, and undo what you applied.')}</p></article>
        <article><span className="writing-tab-label">{t('History')}</span><h3>{t('Every change on record.')}</h3><p>{t('Compare any draft with today’s word by word and take back only the changes you want. Restore any version, and see who wrote what: you, the assistant or a connected AI.')}</p></article>
      </div>
    </section>
    <section className="landing-writing" aria-labelledby="search-title">
      <div className="section-intro"><p className="eyebrow">{t('FIND YOUR WORDS')}</p><h2 id="search-title">{t('Find any line, or any idea,')}<br />{t('across your library.')}</h2><p>{t('Search prose and story details, narrow results by type or field, and jump to the matching passage. Text search finds names and phrases; meaning search finds related ideas when enabled.')}</p><Link to="/how-to-use#search" className="landing-secondary">{t('How search works →')}</Link></div>
    </section>
    <MCPSetup />

    <section id="sharing" className="landing-sharing" aria-labelledby="sharing-title">
      <div className="section-intro sharing-intro">
        <p className="eyebrow">{t('SHARE')}</p>
        <h2 id="sharing-title">{t('Ready for readers.')}</h2>
        <p>{t('Collect private beta feedback on a fixed draft, share your latest manuscript, or give your story a public page anyone can open. If you allow it, beta readers can bring their own AI to a round, read-only.')}</p>
        <div className="sharing-actions"><Link to={SHOWCASE} className="landing-primary">{t('See a showcase')}{' '}<span aria-hidden="true">→</span></Link><Link to="/how-to-use#beta-readers" className="landing-secondary">{t('How beta reading works →')}</Link></div>
      </div>
      <div className="sharing-permissions">
        <article><span className="writing-tab-label">{t('Beta readers')}</span><h3>{t('Feedback you can talk through.')}</h3><p>{t('Publish a frozen manuscript round, send a signed-in invitation and approve readers. Readers comment from a small icon beside selected text. Each comment becomes a private conversation that lands in your story’s Feedback panel, marked beside the quoted line in Write; your AI can draft replies for you to send.')}</p></article>
        <article><span className="writing-tab-label">{t('Beta polls')}</span><h3>{t('Ask your readers directly.')}</h3><p>{t('Put questions to a beta round and see the results below reader management. Choose named or anonymous answers, let readers update their response while a poll is open, and keep past results when a question changes.')}</p></article>
        <article><span className="writing-tab-label">{t('Reader link')}</span><h3>{t('For the readers you pick.')}</h3><p>{t('Invite someone by their sign-in email. They read your latest draft with characters and timeline close at hand, and can import their own copy if you allow it.')}</p></article>
        <article><span className="writing-tab-label">{t('Public showcase')}</span><h3>{t('For anyone with the link.')}</h3><p>{t('Turn on a page with your premise, cast and timeline. Visitors need no account, and you can change or switch off the link at any time.')}</p></article>
      </div>
      <ol className="sharing-steps"><li><span>01</span><p>{t('Open')}{' '}<strong>{t('Beta readers')}</strong>{' '}{t('or')}{' '}<strong>{t('Share')}</strong>{' '}{t('beside it.')}</p></li><li><span>02</span><p>{t('Publish a beta round, invite a reader by email, or turn on the showcase.')}</p></li><li><span>03</span><p>{t('Send the link.')}</p></li></ol>
      <p className="sharing-footnote">{t('Your private notes, version history and AI conversations stay private. You can revoke access later; copies already imported remain independent.')}</p>
    </section>

    <section className="landing-modes" aria-labelledby="keep-title"><div><p className="eyebrow">{t('YOURS TO KEEP')}</p><h2 id="keep-title">{t('Your words can')}<br />{t('always leave.')}</h2></div><div className="mode-list"><p><strong>{t('Manuscript')}</strong><span>{t('Export to Word, Markdown, PDF, EPUB or HTML with illustrations in place; plain text keeps descriptions and captions.')}</span></p><p><strong>{t('Import')}</strong><span>{t('Start from Word, Scrivener, Markdown, plain text or a DRM-free EPUB. Preview how chapters and scenes split, or let your AI plan it.')}</span></p><p><strong>{t('Full backup')}</strong><span>{t('Everything in one file, restorable as a new story.')}</span></p><p><strong>{t('Versions')}</strong><span>{t('Restore any saved version; your current draft is kept as a recovery copy.')}</span></p></div></section>

    <footer className="landing-footer"><span>{t('StoryTool · Make room for your story.')}</span><Link to="/privacy">{t('Privacy')}</Link><Link to="/pricing">{t('Pricing')}</Link><Link to="/about">{t('About the developer')}</Link><Link to="/library">{t('Start your story →')}</Link></footer>
  </main>
}
