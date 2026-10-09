import { errorText } from '../api/errors'

export type DraftState = { text: string; base: string; status: 'saved' | 'unsaved' | 'saving' | 'error'; error?: string }

// Drafts outlive an editor mount. A slow save or a chapter switch must not discard text.
const drafts = new Map<string, WriterDraft>()
export class WriterDraft {
  state: DraftState
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<boolean> | undefined
  save: (text: string, base: string) => Promise<void> = async () => {}
  configure(save: (text: string, base: string) => Promise<void>) { this.save = save }

  private key: string
  constructor(key: string, text: string) {
    this.key = key
    this.state = { text, base: text, status: 'saved' }
    try {
      const recovered = JSON.parse(sessionStorage.getItem(key) ?? 'null') as DraftState | null
      if (recovered && typeof recovered.text === 'string' && typeof recovered.base === 'string' && recovered.text !== text) {
        this.state = { text: recovered.text, base: recovered.base, status: 'error', error: 'An unsaved draft was recovered from this browser tab. Review it, then retry saving.' }
      }
    } catch { /* Writing still works when browser storage is unavailable. */ }
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.state
  private publish(next: DraftState) {
    this.state = next
    try {
      if (next.text === next.base && next.status === 'saved') sessionStorage.removeItem(this.key)
      else sessionStorage.setItem(this.key, JSON.stringify({ text: next.text, base: next.base }))
    } catch { /* The live buffer remains available if storage is full. */ }
    this.listeners.forEach(listener => listener())
  }
  change = (text: string) => {
    this.publish({ ...this.state, text, status: this.state.status === 'error' ? 'error' : 'unsaved' })
    clearTimeout(this.timer)
    if (this.state.status !== 'error') this.timer = setTimeout(() => { void this.flush() }, 1200)
  }
  observe(text: string) {
    if (this.running || text === this.state.base) return
    if (this.state.text !== this.state.base) {
      clearTimeout(this.timer)
      this.publish({ ...this.state, status: 'error', error: 'This passage changed elsewhere. Your unsaved draft is preserved. Review the latest text before saving.' })
    } else this.publish({ text, base: text, status: 'saved' })
  }
  adopt(key: string) {
    drafts.set(key, this)
    try { sessionStorage.removeItem(this.key) } catch { /* Storage is optional. */ }
    this.key = key
    this.publish(this.state)
  }
  // Called only after the author explicitly chooses which copy to retain.
  useLatest(text: string) { this.publish({ text, base: text, status: 'saved' }) }
  forget() {
    clearTimeout(this.timer)
    this.state = { text: '', base: '', status: 'saved' }
    try { sessionStorage.removeItem(this.key) } catch { /* Storage is optional. */ }
  }
  rebase(text: string) { this.publish({ ...this.state, base: text, status: 'unsaved', error: undefined }) }
  flush = (): Promise<boolean> => {
    clearTimeout(this.timer)
    if (this.running) return this.running
    if (this.state.text === this.state.base) {
      this.publish({ ...this.state, status: 'saved', error: undefined })
      return Promise.resolve(true)
    }
    this.running = this.run().finally(() => { this.running = undefined })
    return this.running
  }
  private async run() {
    try {
      while (this.state.text !== this.state.base) {
        const { text, base } = this.state
        this.publish({ ...this.state, status: 'saving', error: undefined })
        await this.save(text, base)
        this.publish({ ...this.state, base: text, status: this.state.text === text ? 'saved' : 'unsaved' })
      }
      return true
    } catch (error) {
      this.publish({ ...this.state, status: 'error', error: errorText(error) })
      return false
    }
  }
}

export function writerDraft(key: string, initial: string) {
  let draft = drafts.get(key)
  if (!draft) { draft = new WriterDraft(key, initial); drafts.set(key, draft) }
  return draft
}
export function writerHasUnsaved(prefix: string) {
  return [...drafts.entries()].some(([key, draft]) => key.startsWith(prefix) && (draft.state.text !== draft.state.base || draft.state.status === 'saving'))
}
export function forgetWriterDraft(key: string) {
  const draft = drafts.get(key)
  if (!draft) return
  draft.forget()
  for (const [alias, candidate] of drafts) if (candidate === draft) {
    drafts.delete(alias)
    try { sessionStorage.removeItem(alias) } catch { /* Storage is optional. */ }
  }
}
export async function flushWriter(prefix: string) {
  const active = [...new Set([...drafts.entries()].filter(([key]) => key.startsWith(prefix)).map(([, draft]) => draft))]
  return (await Promise.all(active.map(draft => draft.state.status === 'error' ? Promise.resolve(false) : draft.flush()))).every(Boolean)
}
