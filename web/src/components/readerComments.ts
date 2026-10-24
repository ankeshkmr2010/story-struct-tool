import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { t } from '../i18n'

export type ReaderComment = { id: string; quote: string }
export const OPEN_FEEDBACK_EVENT = 'storytool:open-feedback'

/** First non-blank line of a reader's quote: enough to find the paragraph in current prose. */
export const quoteNeedle = (quote: string | null | undefined) => quote?.split('\n').map(line => line.trim()).find(Boolean) ?? ''

/** A small marker beside each line holding text a beta reader commented on. */
export function readerComments(comments: ReaderComment[]) {
  class Marker extends WidgetType {
    readonly ids: string[]
    constructor(ids: string[]) { super(); this.ids = ids }
    eq(other: Marker) { return other.ids.join() === this.ids.join() }
    toDOM() {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'writer-reader-comment'; button.contentEditable = 'false'
      button.textContent = this.ids.length > 1 ? String(this.ids.length) : ''
      button.title = this.ids.length > 1 ? t('{0} reader comments', this.ids.length) : t('Reader comment')
      button.setAttribute('aria-label', t('Open {0} in the Feedback panel', button.title.toLowerCase()))
      button.onmousedown = event => event.preventDefault()
      button.onclick = () => window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT, { detail: this.ids[0] }))
      return button
    }
    ignoreEvent() { return true }
  }
  const build = (view: EditorView) => {
    const text = view.state.doc.toString()
    const lines = new Map<number, string[]>()
    for (const comment of comments) {
      const needle = quoteNeedle(comment.quote).slice(0, 60)
      const at = needle ? text.indexOf(needle) : -1
      if (at < 0) continue
      const line = view.state.doc.lineAt(at).from
      lines.set(line, [...(lines.get(line) ?? []), comment.id])
    }
    const builder = new RangeSetBuilder<Decoration>()
    for (const line of [...lines.keys()].sort((a, b) => a - b)) {
      builder.add(line, line, Decoration.widget({ widget: new Marker(lines.get(line)!), side: -1 }))
    }
    return builder.finish()
  }
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = build(view) }
    update(update: ViewUpdate) { if (update.docChanged) this.decorations = build(update.view) }
  }, { decorations: plugin => plugin.decorations })
}
