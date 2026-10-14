import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { StoryImage } from '../api/client'

/** Display illustrations in place while retaining their portable manuscript markers. */
export function writerImages(images: StoryImage[], onPreview: (image: StoryImage) => void) {
  class ImageThumbnail extends WidgetType {
    readonly from: number
    readonly to: number
    readonly image: StoryImage | undefined
    readonly label: string
    constructor(from: number, to: number, image: StoryImage | undefined, label: string) {
      super(); this.from = from; this.to = to; this.image = image; this.label = label
    }
    eq(other: ImageThumbnail) {
      return this.from === other.from && this.to === other.to && this.label === other.label && this.image?.url === other.image?.url && this.image?.name === other.image?.name && this.image?.caption === other.image?.caption && this.image?.alt === other.image?.alt
    }
    toDOM(view: EditorView) {
      const wrapper = document.createElement('span')
      wrapper.className = 'writer-image-thumbnail'; wrapper.contentEditable = 'false'
      const preview = document.createElement('button')
      preview.type = 'button'; preview.className = 'writer-image-preview-button'
      preview.setAttribute('aria-label', `Preview ${this.image?.name || this.label || 'image'}`)
      if (this.image) {
        const img = document.createElement('img')
        img.src = this.image.url; img.alt = this.image.alt || this.label
        img.onload = () => view.requestMeasure()
        img.onerror = () => { img.hidden = true; preview.title = 'Image unavailable. Click to open the preview and retry.'; view.requestMeasure() }
        preview.append(img); preview.onclick = () => onPreview(this.image!)
      } else { preview.disabled = true }
      const name = document.createElement('span')
      name.textContent = this.image?.name || this.label || 'Image unavailable'
      preview.append(name); wrapper.append(preview)
      if (this.image?.caption) {
        const caption = document.createElement('span'); caption.className = 'writer-image-caption'; caption.textContent = this.image.caption; wrapper.append(caption)
      }
      const remove = document.createElement('button')
      remove.type = 'button'; remove.className = 'writer-image-remove'; remove.textContent = 'Remove'
      remove.setAttribute('aria-label', `Remove this placement of ${this.image?.name || this.label || 'image'}`)
      remove.onclick = () => { view.dispatch({ changes: { from: this.from, to: this.to }, selection: { anchor: this.from }, scrollIntoView: true }); view.focus() }
      wrapper.append(remove)
      return wrapper
    }
    ignoreEvent() { return true }
  }
  const decorations = (view: EditorView) => {
    const assets = new Map(images.map(image => [image.id, image]))
    const matches = Array.from(view.state.doc.toString().matchAll(/!\[([^\]\n]*)\]\(storytool-image:([0-9a-fA-F-]{36})\)/g))
    return Decoration.set(matches.map(match => {
      const from = match.index!, to = from + match[0].length
      return Decoration.replace({ widget: new ImageThumbnail(from, to, assets.get(match[2].toLowerCase()), match[1]) }).range(from, to)
    }))
  }
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = decorations(view) }
    update(update: ViewUpdate) { if (update.docChanged) this.decorations = decorations(update.view) }
  }, { decorations: value => value.decorations })
  return [plugin, EditorView.atomicRanges.of(view => view.plugin(plugin)?.decorations ?? Decoration.none)]
}
