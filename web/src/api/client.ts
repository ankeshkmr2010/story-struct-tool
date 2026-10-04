import type { components } from './schema'

// Types come from the backend's OpenAPI schema, so Pydantic stays the single source of
// truth. Never hand-write these -- run `npm run gen:api`.
type S = components['schemas']

export type Story = S['StoryOut']
export type StoryCreate = S['StoryCreate']
export type StoryUpdate = S['StoryUpdate']
export type Completeness = S['CompletenessOut']

export type Ladder = S['LadderOut']
export type Readiness = S['ReadinessOut']
export type Health = S['HealthOut']
export type Finding = S['FindingOut']
export type Scaffold = S['ScaffoldOut']

export type StoryEvent = S['EventOut']
export type Act = S['ActOut']
export type Beat = S['BeatOut']
export type Thread = S['ThreadOut']
export type Character = S['CharacterOut']

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

export const api = {
  // Stories
  listStories: () => request<Story[]>('/api/stories'),
  getStory: (id: string) => request<Story>(`/api/stories/${id}`),
  createStory: (data: StoryCreate) => post<Story>('/api/stories', data),
  updateStory: (id: string, data: StoryUpdate) => patch<Story>(`/api/stories/${id}`, data),
  deleteStory: (id: string) => request<void>(`/api/stories/${id}`, { method: 'DELETE' }),

  // Computed layer
  getLadder: (id: string) => request<Ladder>(`/api/stories/${id}/ladder`),
  getHealth: (id: string, maxLevel = 8) =>
    request<Health>(`/api/stories/${id}/health?max_level=${maxLevel}`),
  scaffold: (id: string, framework?: string) =>
    post<Scaffold>(
      `/api/stories/${id}/scaffold${framework ? `?framework=${framework}` : ''}`,
    ),

  // Levels 2-6
  listEvents: (id: string) => request<StoryEvent[]>(`/api/stories/${id}/events`),
  createEvent: (id: string, body: { label: string; is_turning_point?: boolean }) =>
    post<StoryEvent>(`/api/stories/${id}/events`, body),
  deleteEvent: (storyId: string, eventId: string) =>
    request<void>(`/api/stories/${storyId}/events/${eventId}`, { method: 'DELETE' }),

  listCharacters: (id: string) => request<Character[]>(`/api/stories/${id}/characters`),
  createCharacter: (id: string, body: { name: string; role?: string }) =>
    post<Character>(`/api/stories/${id}/characters`, body),
  updateCharacter: (storyId: string, characterId: string, body: Record<string, unknown>) =>
    patch<Character>(`/api/stories/${storyId}/characters/${characterId}`, body),

  listActs: (id: string) => request<Act[]>(`/api/stories/${id}/acts`),
  listBeats: (id: string) => request<Beat[]>(`/api/stories/${id}/beats`),

  listThreads: (id: string) => request<Thread[]>(`/api/stories/${id}/threads`),
  createThread: (id: string, body: { type: string; title?: string }) =>
    post<Thread>(`/api/stories/${id}/threads`, body),
}
