import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import type { SetupMark } from '../api/client'
import { t } from '../i18n'

/** A chip before each marked setup or payoff in this scene, and a quiet underline on its text.
 *  Marks are found by their text and occurrence in the saved scene, as the server stores them;
 *  a mark whose text was reworded has no chip here (Checks lists it). Suggested marks are dashed. */
export function writerSetups(marks: SetupMark[], onPick: (mark: SetupMark, x: number, y: number) => void) {
  class Chip extends WidgetType {
    readonly mark: SetupMark
    constructor(mark: SetupMark) { super(); this.mark = mark }
    eq(other: Chip) { return other.mark.id === this.mark.id && other.mark.kind === this.mark.kind && other.mark.label === this.mark.label && other.mark.status === this.mark.status }
    toDOM() {
      const kind = this.mark.kind === 'setup' ? t('Setup') : t('Payoff')
      const button = document.createElement('button')
      button.type = 'button'; button.contentEditable = 'false'
      button.className = `writer-setup writer-setup-${this.mark.kind}${this.mark.status === 'suggested' ? ' writer-setup-suggested' : ''}`
      button.textContent = this.mark.status === 'suggested' ? `${kind}?` : kind
      const name = this.mark.label || this.mark.text
      button.setAttribute('aria-label', this.mark.status === 'suggested' ? t('Suggested {0}: {1}. Review it', kind, name) : t('{0}: {1}. Open its links', kind, name))
      button.title = button.getAttribute('aria-label')!
      button.onmousedown = event => event.preventDefault()
      button.onclick = () => { const box = button.getBoundingClientRect(); onPick(this.mark, box.left, box.bottom) }
      return button
    }
    ignoreEvent() { return true }
  }
  const underline = Decoration.mark({ class: 'writer-setup-text' })
  const build = (view: EditorView) => {
    const text = view.state.doc.toString()
    const ranges: Range<Decoration>[] = []
    for (const mark of marks) {
      if (!mark.found) continue
      // The stored occurrence is counted over the whole scene, like the server's `locate`.
      let at = -1
      for (let seen = 0; seen < mark.occurrence; seen++) { at = text.indexOf(mark.text, at + 1); if (at < 0) break }
      if (at < 0) continue
      ranges.push(Decoration.widget({ widget: new Chip(mark), side: -1 }).range(at), underline.range(at, at + mark.text.length))
    }
    return Decoration.set(ranges, true)
  }
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = build(view) }
    update(update: ViewUpdate) { if (update.docChanged) this.decorations = build(update.view) }
  }, { decorations: plugin => plugin.decorations })
}

