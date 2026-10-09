type Ordered = { sort_key?: unknown; number?: unknown; id?: unknown }
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
export const orderChapters = <T extends Ordered>(items: T[]): T[] => [...items].sort((a, b) => numeric(a.sort_key) - numeric(b.sort_key) || numeric(a.number) - numeric(b.number) || String(a.id).localeCompare(String(b.id)))
export const orderScenes = <T extends Ordered>(items: T[]): T[] => [...items].sort((a, b) => numeric(a.sort_key) - numeric(b.sort_key) || String(a.id).localeCompare(String(b.id)))
