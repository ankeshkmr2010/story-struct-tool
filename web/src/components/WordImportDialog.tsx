import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type DocxImport, type ImportFormat, type ImportUpload, type Story } from '../api/client'
import { errorText } from '../api/errors'
import { importedStoryPrompt } from './importPrompts'

type Plan = Record<string, unknown>
type Option = { value: string | number; count?: number; chapters?: number }

// Each format is a server-side adapter; the dialog only needs its file rules and wording.
const FORMATS: Record<ImportFormat, { heading: string; fileLabel: string; accept: string; extension: RegExp; maxMb: number; help: string }> = {
  docx: {
    heading: 'Import a Word manuscript', fileLabel: 'Word document', extension: /\.docx$/i, maxMb: 10,
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    help: 'Up to 10 MB. StoryTool reads the document first, then you choose how chapters and scenes are split before anything is created. Images, comments, headers and footers are left out.',
  },
  scrivener: {
    heading: 'Import a Scrivener project', fileLabel: 'Zipped Scrivener project (.zip)', extension: /\.zip$/i, maxMb: 40,
    accept: '.zip,application/zip',
    help: 'Up to 40 MB. Zip your whole .scriv project folder first (on a Mac, right-click it and choose Compress). StoryTool reads the Draft or Manuscript folder, then you choose which folders are chapters before anything is created. Research is left out.',
  },
  text: {
    heading: 'Import Markdown or plain text', fileLabel: 'Markdown or text file (.md or .txt)', extension: /\.(md|markdown|txt)$/i, maxMb: 10,
    accept: '.md,.markdown,.txt,text/markdown,text/plain',
    help: 'Up to 10 MB, saved as UTF-8. Blank lines separate paragraphs; # headings or “Chapter” lines can start chapters, and ***, --- or # lines can start scenes. You choose before anything is created.',
  },
  epub: {
    heading: 'Import an EPUB book', fileLabel: 'EPUB file (.epub)', extension: /\.epub$/i, maxMb: 40,
    accept: '.epub,application/epub+zip',
    help: 'Up to 40 MB, DRM-free only. StoryTool reads the book in reading order, skipping the contents page; each section starts on a new page, so headings or section starts can become chapters. You choose before anything is created.',
  },
}

const SPLIT_LABELS: Record<string, string> = {
  heading1: 'Heading 1', heading2: 'Heading 2', heading3: 'Heading 3', page_break: 'Page breaks',
  chapter_lines: '“Chapter …” lines', separators: 'Separator lines (*** or #)', explicit: 'Your AI’s plan', none: 'No split',
}

function optionLabel(option: Option, scenes = false) {
  if (scenes && option.value === 'none') return 'One scene per chapter'
  if (!scenes && option.value === 'none') return 'Everything in one chapter'
  const label = SPLIT_LABELS[String(option.value)] ?? String(option.value)
  return option.count ? `${label} (${option.count})` : label
}

function aiPrompt(upload: ImportUpload, title: string) {
  return [
    `In StoryTool, plan the import of my manuscript "${upload.filename}" (upload_id ${upload.id}).`,
    'Call get_manuscript_import with that upload_id and read the whole outline, paging with offset and limit until you have covered outline_total.',
    'Work out the best plan: front and back matter to skip, where chapters and scenes really start, clear titles where the source has none, and one-sentence scene summaries only where you are sure.',
    'Check it with preview_manuscript_import, then show me the chapter and scene outline.',
    `When I approve, call import_manuscript with title "${title.trim() || upload.filename}" and that plan. Do not change any prose.`,
  ].join('\n')
}

export function WordImportDialog({ open, format = 'docx', story, defaultTitle, onClose, onImported }: {
  open: boolean
  format?: ImportFormat
  story: Story | null
  defaultTitle: string
  onClose: () => void
  onImported: (result: DocxImport) => void
}) {
  const rules = FORMATS[format]
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [selectedStory, setSelectedStory] = useState<Story | null>(null)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [uploaded, setUploaded] = useState<ImportUpload | null>(null)
  const [plan, setPlan] = useState<Plan>({})
  const [previewPlan, setPreviewPlan] = useState<Plan>({})
  const [aiCopied, setAiCopied] = useState(false)

  const analyse = useMutation({
    mutationFn: (chosen: File) => {
      if (!rules.extension.test(chosen.name)) throw new Error(`Choose a ${rules.fileLabel.toLowerCase()}.`)
      if (chosen.size > rules.maxMb * 1024 * 1024) throw new Error(`Choose a file up to ${rules.maxMb} MB.`)
      return api.uploadImport(format, chosen)
    },
    onSuccess: (result) => {
      const recommended = (result.inspection?.recommended ?? {}) as Plan
      setUploaded(result); setPlan(recommended); setPreviewPlan(recommended)
    },
  })
  const upload = useMutation({
    mutationFn: () => api.importUpload(uploaded!.id, title.trim(), plan),
    onSuccess: (result) => {
      setSelectedStory({ ...result.story, word_count: result.word_count })
      onImported(result)
    },
  })
  // Debounce previews so each option change is not a separate request.
  useEffect(() => {
    const timer = setTimeout(() => setPreviewPlan(plan), 350)
    return () => clearTimeout(timer)
  }, [plan])
  const preview = useQuery({
    queryKey: ['import-preview', uploaded?.id, JSON.stringify(previewPlan)],
    queryFn: () => api.previewImport(uploaded!.id, previewPlan),
    enabled: Boolean(uploaded) && !selectedStory,
    retry: false,
  })
  // If the author asked their AI to import, notice when it has done so.
  const status = useQuery({
    queryKey: ['import-upload', uploaded?.id],
    queryFn: () => api.getImportUpload(uploaded!.id),
    enabled: Boolean(uploaded) && !selectedStory,
    refetchInterval: 5000,
  })
  const importedByAi = status.data?.story_id && !selectedStory ? status.data.story_id : null

  const resetAnalyse = analyse.reset
  const resetUpload = upload.reset
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (!open) { element.close(); return }
    if (element.open) return
    setFile(null); setTitle(defaultTitle); setSelectedStory(story); setUploaded(null); setPlan({}); setAiCopied(false)
    if (fileInput.current) fileInput.current.value = ''
    setPrompt(null); setCopied(false); setCopyError(false); resetUpload(); resetAnalyse()
    element.showModal()
  }, [open, story, defaultTitle, resetUpload, resetAnalyse])

  const busy = analyse.isPending || upload.isPending
  const inspection = uploaded?.inspection as { stats: Record<string, number>; options: Record<string, Option[]>; recommended: Plan } | null | undefined
  const stats = inspection?.stats ?? {}
  const set = (key: string, value: unknown) => setPlan(current => ({ ...current, [key]: value }))
  const recommendedSkip = inspection?.recommended.skip as [number, number][] | undefined

  return <dialog ref={dialog} aria-labelledby="word-import-title" onCancel={(event) => {
    event.preventDefault(); if (!busy) onClose()
  }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--page)] p-6 text-[var(--ink)] shadow-xl backdrop:bg-black/60">
    <div className="flex items-start justify-between gap-4">
      <h2 id="word-import-title" className="break-words text-2xl font-semibold">{selectedStory ? selectedStory.title : rules.heading}</h2>
      <button type="button" disabled={busy} onClick={onClose} aria-label="Close import dialog" className="rounded border border-[var(--line)] px-3 py-1.5 disabled:opacity-40">Close</button>
    </div>
    {selectedStory ? <div className="mt-5 space-y-4">
      <p role="status" className="text-sm text-[var(--muted)]">{upload.isSuccess ? 'Import complete. ' : ''}{selectedStory.word_count.toLocaleString()} words. Choose your next step.</p>
      <div className="flex flex-wrap gap-3">
        <Link to={`/stories/${selectedStory.id}`} onClick={onClose} className="landing-primary">Open this story →</Link>
        {(['structure', 'components'] as const).map((mode) => <button key={mode} type="button" className="rounded border border-[var(--line)] px-3 py-2 text-sm" onClick={() => {
          setPrompt(importedStoryPrompt(selectedStory, mode)); setCopied(false); setCopyError(false)
        }}>{mode === 'structure' ? 'Organize chapters/scenes' : 'Populate story components'}</button>)}
      </div>
      <p className="text-sm leading-6 text-[var(--muted)]">Both prompts preserve your prose. Your connected AI stages suggestions for you to review in Agent changes.</p>
      {prompt && <div>
        <label className="block text-sm">Prompt for {selectedStory.title}<textarea readOnly value={prompt} rows={8} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-sm leading-6" /></label>
        <button type="button" className="mt-3 rounded border border-[var(--line)] px-4 py-2 text-sm" onClick={() => {
          void navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setCopyError(false) }).catch(() => { setCopied(false); setCopyError(true) })
        }}>{copied ? 'Copied' : 'Copy prompt'}</button>
        {copyError && <p role="alert" className="mt-2 text-sm">Select and copy the prompt manually; clipboard access is unavailable.</p>}
      </div>}
      <p className="text-xs text-[var(--muted)]">You can return to these actions from this story's Import prompts button in your library.</p>
    </div> : !uploaded ? <form className="mt-5 space-y-4" onSubmit={(event) => {
      event.preventDefault(); if (file) analyse.mutate(file)
    }}>
      <p className="text-sm leading-6 text-[var(--muted)]">Import your prose into a new story, then choose prompts to organize it or build its story components.</p>
      <label className="block text-sm">{rules.fileLabel}<input ref={fileInput} type="file" required disabled={busy} accept={rules.accept} onChange={(event) => {
        const chosen = event.target.files?.[0] ?? null
        setFile(chosen); resetAnalyse()
        if (chosen && !title.trim()) setTitle(chosen.name.replace(rules.extension, '').replace(/\.scriv$/i, '').slice(0, 200))
      }} className="mt-2 block w-full text-sm" /></label>
      <label className="block text-sm">Story title<input required maxLength={200} disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3" /></label>
      <p className="text-xs leading-5 text-[var(--muted)]">{rules.help}</p>
      <button type="submit" disabled={!file || !title.trim() || busy} className="landing-primary disabled:opacity-40">{analyse.isPending ? 'Reading manuscript…' : 'Read manuscript'}</button>
      {analyse.error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(analyse.error)}</p>}
    </form> : <div className="mt-5 space-y-4">
      <p className="text-sm text-[var(--muted)]">
        {format !== 'scrivener'
          ? `Found ${stats.words?.toLocaleString() ?? 0} words in ${stats.blocks ?? 0} paragraphs: ${stats.heading1 ?? 0} Heading 1, ${stats.heading2 ?? 0} Heading 2, ${stats.chapter_lines ?? 0} “Chapter” lines, ${stats.separators ?? 0} separators and ${stats.page_break ?? 0} page breaks.`
          : `Found ${stats.words?.toLocaleString() ?? 0} words in ${stats.documents ?? 0} documents and ${stats.folders ?? 0} folders, with ${stats.synopses ?? 0} synopses and ${stats.notes ?? 0} notes. ${stats.excluded_from_compile ?? 0} items are excluded from compile.`}
      </p>
      <label className="block text-sm">Story title<input required maxLength={200} disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3" /></label>
      {format !== 'scrivener' ? <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Chapters start at<select value={String(plan.chapter_split ?? 'none')} disabled={busy} onChange={(event) => set('chapter_split', event.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2">
          {(inspection?.options.chapter_split ?? []).filter(option => option.value !== 'explicit' || plan.chapter_split === 'explicit').map(option => <option key={option.value} value={option.value}>{optionLabel(option)}</option>)}
        </select></label>
        <label className="block text-sm">Scenes start at<select value={String(plan.scene_split ?? 'none')} disabled={busy} onChange={(event) => set('scene_split', event.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2">
          {(inspection?.options.scene_split ?? []).filter(option => option.value !== 'explicit' || plan.scene_split === 'explicit').map(option => <option key={option.value} value={option.value}>{optionLabel(option, true)}</option>)}
        </select></label>
        {recommendedSkip && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" disabled={busy} checked={Boolean(plan.skip)} onChange={(event) => set('skip', event.target.checked ? recommendedSkip : undefined)} />Leave out the opening {recommendedSkip[0][1] + 1} paragraphs (title page, dedication)</label>}
        {(stats.italic_blocks ?? 0) > 0 && <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" disabled={busy} checked={Boolean(plan.italic_synopsis)} onChange={(event) => set('italic_synopsis', event.target.checked)} />Use a short italic paragraph that opens a scene as its summary</label>}
      </div> : <div className="grid gap-3">
        <label className="block text-sm">Chapters are<select value={String(plan.chapter_level ?? 1)} disabled={busy || Boolean((plan.chapter_items as string[] | undefined)?.length)} onChange={(event) => set('chapter_level', Number(event.target.value))} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-2">
          {(inspection?.options.chapter_level ?? []).map(option => <option key={option.value} value={option.value}>{option.value === 1 ? 'Top-level folders in Draft' : `Folders ${Number(option.value) - 1} level${Number(option.value) > 2 ? 's' : ''} deeper (parts or acts above)`} ({option.chapters} chapters)</option>)}
        </select></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={plan.synopsis_as_summary !== false} onChange={(event) => set('synopsis_as_summary', event.target.checked)} />Use synopses as scene summaries</label>
        {(stats.notes ?? 0) > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={Boolean(plan.include_notes)} onChange={(event) => set('include_notes', event.target.checked)} />Keep document notes as scene notes</label>}
        {(stats.excluded_from_compile ?? 0) > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={Boolean(plan.include_excluded)} onChange={(event) => set('include_excluded', event.target.checked)} />Also import documents excluded from compile</label>}
      </div>}
      <section aria-label="Import preview" className="rounded border border-[var(--line)] p-3">
        {preview.isPending && <p className="text-sm text-[var(--muted)]">Previewing…</p>}
        {preview.error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(preview.error)}</p>}
        {preview.data && <>
          <p className="text-sm font-medium">{preview.data.chapter_count} chapters · {preview.data.scene_count} scenes · {preview.data.word_count.toLocaleString()} words</p>
          <ol className="mt-2 max-h-60 space-y-1 overflow-y-auto text-sm">
            {preview.data.chapters.slice(0, 80).map((chapter, index) => <li key={index}>
              <span className="font-medium">{index + 1}. {chapter.title || 'Untitled chapter'}</span>
              <span className="text-[var(--muted)]"> — {chapter.scenes.length} scene{chapter.scenes.length === 1 ? '' : 's'}, {chapter.scenes.reduce((sum, scene) => sum + scene.words, 0).toLocaleString()} words{chapter.scenes.some(scene => scene.title) ? `: ${chapter.scenes.map(scene => scene.title || 'untitled').slice(0, 4).join(', ')}${chapter.scenes.length > 4 ? '…' : ''}` : ''}</span>
            </li>)}
          </ol>
          {(preview.data.truncated || preview.data.chapters.length > 80) && <p className="mt-1 text-xs text-[var(--muted)]">Showing the first 80 chapters.</p>}
        </>}
      </section>
      <details className="rounded border border-[var(--line)] p-3 text-sm">
        <summary className="cursor-pointer font-medium">Let your AI plan the import</summary>
        <p className="mt-2 text-[var(--muted)]">Your connected AI can read this manuscript’s outline, skip front matter, find chapter and scene breaks, add titles and summaries, preview the result and import it once you approve. It needs a connection to all your stories with permission to create stories. This upload is kept for 24 hours.</p>
        <textarea readOnly value={aiPrompt(uploaded, title)} rows={6} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3 text-sm leading-6" />
        <button type="button" className="mt-2 rounded border border-[var(--line)] px-4 py-2 text-sm" onClick={() => {
          void navigator.clipboard.writeText(aiPrompt(uploaded, title)).then(() => setAiCopied(true)).catch(() => setAiCopied(false))
        }}>{aiCopied ? 'Copied' : 'Copy prompt'}</button>
      </details>
      {importedByAi && <p role="status" className="text-sm">Your AI imported this manuscript. <Link to={`/stories/${importedByAi}`} onClick={onClose} className="underline">Open the story →</Link></p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!title.trim() || busy || !preview.data || Boolean(importedByAi)} onClick={() => upload.mutate()} className="landing-primary disabled:opacity-40">{upload.isPending ? 'Importing manuscript…' : 'Import with this plan'}</button>
        <button type="button" disabled={busy} onClick={() => { setUploaded(null); resetAnalyse() }} className="rounded border border-[var(--line)] px-4 py-2 text-sm">Choose another file</button>
      </div>
      {upload.isPending && <p role="status" className="text-sm">Keep this window open. Your story and prompt options will appear here when import finishes.</p>}
      {upload.error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(upload.error)}</p>}
    </div>}
  </dialog>
}
