import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'

// The same markers the TK placeholders check finds (prose_scan.markers): bracketed, any case.
const PLACEHOLDER = /\[tk(?:[ \t]*:[ \t]*[^\]\n]*)?\]/gi

const mark = Decoration.mark({
  class: 'writer-tk',
  attributes: { title: 'Placeholder: fill it in place, or from the TKs tab or Design → Placeholders' },
})

/** Highlights [TK] and [TK: note] in the prose so unfinished details stand out while writing. */
export const writerPlaceholders = ViewPlugin.fromClass(class {
  decorator = new MatchDecorator({ regexp: PLACEHOLDER, decoration: () => mark })
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = this.decorator.createDeco(view) }
  update(update: ViewUpdate) { this.decorations = this.decorator.updateDeco(update, this.decorations) }
}, { decorations: plugin => plugin.decorations })
