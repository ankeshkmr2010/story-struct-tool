/** Write's top-bar buttons act on the passage the writer was last in (usability phase 2, item 7). */
export type WriterAction = 'tk' | 'image'

export const WRITER_ACTION_EVENT = 'storytool:writer-action'

export const writerAction = (action: WriterAction) => window.dispatchEvent(new CustomEvent<WriterAction>(WRITER_ACTION_EVENT, { detail: action }))
