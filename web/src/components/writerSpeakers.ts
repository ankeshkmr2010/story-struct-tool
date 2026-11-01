import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { DialogueLine } from '../api/client'
import { t } from '../i18n'

/** A chip before each quoted line naming its stored speaker, or a dim ? while it has none.
 *  Lines come from the saved scene in order, so each is found after the previous one; a quote
 *  typed since the last save gets its chip once the scene is saved. */
export function writerSpeakers(lines: DialogueLine[], names: Record<string, string>, onPick: (line: DialogueLine, x: number, y: number) => void) {
  class Chip extends WidgetType {
    readonly line: DialogueLine
    constructor(line: DialogueLine) { super(); this.line = line }
    eq(other: Chip) { return other.line.line_id === this.line.line_id && other.line.speaker_id === this.line.speaker_id }
    toDOM() {
      const name = this.line.speaker_id ? names[this.line.speaker_id] ?? this.line.speaker : null
      const button = document.createElement('button')
      button.type = 'button'; button.contentEditable = 'false'
      button.className = name ? 'writer-speaker' : 'writer-speaker writer-speaker-empty'
      button.textContent = name ?? '?'
      button.setAttribute('aria-label', name ? t('Spoken by {0}: change speaker', name) : t('No speaker yet: choose one'))
      button.title = button.getAttribute('aria-label')!
      button.onmousedown = event => event.preventDefault()
      button.onclick = () => { const box = button.getBoundingClientRect(); onPick(this.line, box.left, box.bottom) }
      return button
    }
    ignoreEvent() { return true }
  }
  const build = (view: EditorView) => {
    const text = view.state.doc.toString()
    const builder = new RangeSetBuilder<Decoration>()
    let from = 0
    for (const line of lines) {
      const at = line.find ? text.indexOf(line.find, from) : -1
      if (at < 0) continue
      builder.add(at, at, Decoration.widget({ widget: new Chip(line), side: -1 }))
      from = at + line.find.length
    }
    return builder.finish()
  }
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = build(view) }
    update(update: ViewUpdate) { if (update.docChanged) this.decorations = build(update.view) }
  }, { decorations: plugin => plugin.decorations })
}
