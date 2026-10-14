import { Link } from 'react-router-dom'

export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-[var(--ink)] sm:px-8">
      <header>
        <p className="eyebrow">PRIVACY</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your manuscript, images and AI.</h1>
        <p className="mt-5 text-lg leading-8 text-[var(--muted)]">StoryTool does not use your manuscript to train AI. Connected AI services have their own data policies.</p>
      </header>
      <section className="mt-10 space-y-3" aria-labelledby="stored-data-title">
        <h2 id="stored-data-title" className="text-xl font-semibold">What StoryTool stores</h2>
        <p className="leading-7 text-[var(--muted)]">Google sign-in supplies your email and basic profile to identify your account. StoryTool stores your manuscript, story structure, notes, revisions, versions and authorship history so you can write, recover drafts and see what changed.</p>
        <p className="leading-7 text-[var(--muted)]">AI prompts, replies, proposed changes, review reports and usage details are stored to support conversations, review and history. Operational logs can include AI response summaries and error details. StoryTool is hosted on Render and uses Neon for its database and private image storage.</p>
      </section>
      <section className="mt-10 space-y-3" aria-labelledby="image-data-title">
        <h2 id="image-data-title" className="text-xl font-semibold">Images and their history</h2>
        <p className="leading-7 text-[var(--muted)]">Uploaded illustrations and reference images are stored in private Neon object storage. StoryTool stores their names, descriptions, captions and links to your manuscript or planning entries. Image access follows the story’s permissions: authorized private readers can view shared images, and images used in a public showcase can be viewed through its public link. Admitted beta readers can view the images in their frozen reading round.</p>
        <p className="leading-7 text-[var(--muted)]">Deleting an image removes its current manuscript placements and reference attachments. Its file remains available to saved revisions, story versions and existing frozen beta rounds, and still counts toward upload limits. Trash also retains image files. Permanently deleting the story queues its retained image files for removal from storage; failed removals are retried, so cleanup may not be immediate.</p>
        <p className="leading-7 text-[var(--muted)]">Manuscript downloads and full backups can contain images. Copies downloaded or imported by readers are independent; revoking access or deleting the original cannot recall them. Hosting backups may retain copies separately.</p>
      </section>
      <section className="mt-10 space-y-3" aria-labelledby="ai-data-title">
        <h2 id="ai-data-title" className="text-xl font-semibold">When you choose to use AI</h2>
        <p className="leading-7 text-[var(--muted)]">Writing without AI does not require an AI connection. If you enable AI features, relevant story information is shared with the service you choose. In-app authoring can include prose excerpts when you select that option; prose-based readers and reviews need scene text.</p>
        <p className="leading-7 text-[var(--muted)]">When the site-provided Jev reader is available, choosing read prose in Noticed or Run in Evaluate sends scene text and relevant beat/place, thread and protagonist-belief information to TypeSafe for advisory observations. You do not need your own key. Verifying an uncertain finding sends only its selected scene text and implicated thread/protagonist-belief context to your chosen AI connection; its report is stored with the story. This runs when you request a reading pass; it does not write prose or apply story changes. StoryTool caches typed answers privately and records token counts and request timing to avoid repeat calls and control shared usage. The answer cache and usage records contain no raw scene text or API keys. TypeSafe’s <a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noreferrer" className="underline">privacy policy</a> says inputs are not used for model training. Its direct API does not promise zero retention for ordinary accounts; enterprise zero retention requires separate setup.</p>
        <p className="leading-7 text-[var(--muted)]">An external AI client can read the stories and prose you authorize through the connection's permissions. API use and chat-client use can have different retention and training settings. StoryTool's no-training statement does not override your provider's or client's policies.</p>
        <p className="leading-7 text-[var(--muted)]">Saved provider API keys are encrypted. You can disconnect a provider or revoke an external client's access in <Link to="/settings" className="underline underline-offset-4">Settings</Link>. Revoking access prevents future requests; it does not erase data already sent to another service.</p>
      </section>
      <p className="mt-6 leading-7 text-[var(--muted)]">In Plotter and Hybrid modes, planning readiness uses the shared reader for premise, character goals and outline summaries (turning points, acts, beats, threads, chapters and scenes). It includes your writing mode, but no manuscript prose or private notes. Unchanged context reuses cached answers. Pantser mode makes no ladder-scoring requests.</p>
      <p className="mt-3 leading-7 text-[var(--muted)]">Choosing Group feedback in a beta round sends submitted reader-comment text to the shared reader for category and severity scores. Reader names, emails, private drafts, deleted comments and manuscript text are excluded. StoryTool builds chapter counts from the typed answers; Jev does not generate written summaries.</p>
      <section className="mt-10 space-y-3" aria-labelledby="live-hints-title">
        <h2 id="live-hints-title" className="text-xl font-semibold">Optional live writing hints</h2>
        <p className="leading-7 text-[var(--muted)]">Live hints start off. If you enable them in Write or /try, the current scene draft and known cast/glossary names are sent to StoryTool's shared reader after you pause typing. This includes unsaved edits. No other scenes are included, and hints never edit prose. The provider's data policy described above applies.</p>
        <p className="leading-7 text-[var(--muted)]">Dismissed notes stay in your browser. The sandbox uses a server-issued cookie and temporary hashed connection identifiers to limit abuse; raw addresses are not stored in the hint database. Cached answers and usage limits follow the shared-reader policy above.</p>
      </section>
      <section className="mt-10 space-y-3" aria-labelledby="meaning-search-title">
        <h2 id="meaning-search-title" className="text-xl font-semibold">Meaning search and Cloudflare</h2>
        <p className="leading-7 text-[var(--muted)]">When the shared reader is available, Related search also sends your query, result titles and short matching excerpts to it for relevance scores. It refines the current result page without sending full manuscripts. Exact search does not make these scoring calls.</p>
        <p className="leading-7 text-[var(--muted)]">When meaning search is enabled for StoryTool, scene prose and searchable story details are sent in chunks to Cloudflare to create embeddings—numeric representations used to find related ideas. Indexing runs in the background and updates as stories change, even when you are not actively searching. Meaning-search queries are also sent to Cloudflare for an embedding.</p>
        <p className="leading-7 text-[var(--muted)]">When meaning search is disabled, StoryTool makes no embedding requests. Text search runs in StoryTool's database and does not itself send text to Cloudflare. Cloudflare's own data policies apply to embedding requests; StoryTool's no-training statement does not override them.</p>
      </section>
      <section className="mt-10 space-y-3" aria-labelledby="sharing-data-title">
        <h2 id="sharing-data-title" className="text-xl font-semibold">Sharing is your choice</h2>
        <p className="leading-7 text-[var(--muted)]">Stories are private to your account unless you share them or authorize an AI connection. Private reader access is tied to the email you invite. A public showcase can be read by anyone with its link. If you allow a reader to import a copy, that copy is independent and remains after you revoke sharing.</p>
      </section>
      <section className="mt-10 space-y-3" aria-labelledby="deleting-data-title">
        <h2 id="deleting-data-title" className="text-xl font-semibold">Keeping and deleting drafts</h2>
        <p className="leading-7 text-[var(--muted)]">Moving a story to Trash keeps it recoverable, with its versions. Permanently deleting it removes it from the application database. This does not recall shared imports, data sent to AI services or copies retained in hosting backups and operational logs.</p>
        <p className="leading-7 text-[var(--muted)]">Download a manuscript or full story backup from your workspace whenever you want your own copy.</p>
      </section>
      <section className="mt-10 space-y-3" aria-labelledby="product-data-title">
        <h2 id="product-data-title" className="text-xl font-semibold">Product feedback and usage counts</h2>
        <p className="leading-7 text-[var(--muted)]">Product feedback is stored with your account and is visible only to site admins. It is separate from manuscript reviews.</p>
        <p className="leading-7 text-[var(--muted)]">To understand where people get started or stop, StoryTool records visits, new accounts, first author-created scenes and AI connections. A random identifier is kept in your browser's local storage; account milestones use your account identifier. These analytics records contain no manuscript text, prompts or IP addresses, and are not sent to an external analytics service. Clearing browser storage resets the browser identifier.</p>
      </section>
      <p className="mt-12 text-sm text-[var(--muted)]"><Link to="/" className="underline underline-offset-4">← Back to StoryTool</Link></p>
    </main>
  )
}
