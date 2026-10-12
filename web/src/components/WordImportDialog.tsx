import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type DocxImport, type Story } from '../api/client'
import { errorText } from '../api/errors'
import { importedStoryPrompt } from './importPrompts'

export function WordImportDialog({ open, story, defaultTitle, onClose, onImported }: {
  open: boolean
  story: Story | null
  defaultTitle: string
  onClose: () => void
  onImported: (result: DocxImport) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [selectedStory, setSelectedStory] = useState<Story | null>(null)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const upload = useMutation({
    mutationFn: ({ file, title }: { file: File; title: string }) => {
      if (!file.name.toLowerCase().endsWith('.docx')) throw new Error('Choose a .docx document.')
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a Word document up to 10 MB.')
      return api.importDocx(file, title.trim())
    },
    onSuccess: (result) => {
      setSelectedStory({ ...result.story, word_count: result.word_count })
      onImported(result)
    },
  })
  const resetUpload = upload.reset
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (!open) { element.close(); return }
    if (element.open) return
    setFile(null); setTitle(defaultTitle); setSelectedStory(story)
    if (fileInput.current) fileInput.current.value = ''
    setPrompt(null); setCopied(false); setCopyError(false); resetUpload()
    element.showModal()
  }, [open, story, defaultTitle, resetUpload])

  return <dialog ref={dialog} aria-labelledby="word-import-title" onCancel={(event) => {
    event.preventDefault(); if (!upload.isPending) onClose()
  }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--page)] p-6 text-[var(--ink)] shadow-xl backdrop:bg-black/60">
    <div className="flex items-start justify-between gap-4">
      <h2 id="word-import-title" className="break-words text-2xl font-semibold">{selectedStory ? selectedStory.title : 'Import a Word manuscript'}</h2>
      <button type="button" disabled={upload.isPending} onClick={onClose} aria-label="Close import dialog" className="rounded border border-[var(--line)] px-3 py-1.5 disabled:opacity-40">Close</button>
    </div>
    {!selectedStory ? <form className="mt-5 space-y-4" onSubmit={(event) => {
      event.preventDefault(); if (file) upload.mutate({ file, title })
    }}>
      <p className="text-sm leading-6 text-[var(--muted)]">Import your prose into a new story, then choose prompts to organize it or build its story components.</p>
      <label className="block text-sm">Word document<input ref={fileInput} type="file" required disabled={upload.isPending} accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => {
        const chosen = event.target.files?.[0] ?? null
        setFile(chosen); resetUpload()
        if (chosen && !title.trim()) setTitle(chosen.name.replace(/\.docx$/i, '').slice(0, 200))
      }} className="mt-2 block w-full text-sm" /></label>
      <label className="block text-sm">Story title<input required maxLength={200} disabled={upload.isPending} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 block w-full rounded border border-[var(--line)] bg-[var(--surface)] p-3" /></label>
      <p className="text-xs leading-5 text-[var(--muted)]">Up to 10 MB. Heading 1 starts each chapter, with one prose scene per chapter. Body text uses simplified formatting; images, comments, headers and footers are excluded.</p>
      <button type="submit" disabled={!file || !title.trim() || upload.isPending} className="landing-primary disabled:opacity-40">{upload.isPending ? 'Importing manuscript…' : 'Import prose'}</button>
      {upload.isPending && <p role="status" className="text-sm">Keep this window open. Your story and prompt options will appear here when import finishes.</p>}
      {upload.error && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{errorText(upload.error)}</p>}
    </form> : <div className="mt-5 space-y-4">
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
    </div>}
  </dialog>
}
