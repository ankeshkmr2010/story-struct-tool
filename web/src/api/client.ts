import type { components, operations } from './schema'
import { orderChapters, orderScenes } from './ordering'
import { getVisitorId } from './visitor'

// Types come from the backend's OpenAPI schema, so Pydantic stays the single source of
// truth. Never hand-write these -- run `npm run gen:api`.
type S = components['schemas']

export type Story = S['StoryOut']
export type StoryCreate = S['StoryCreate']
export type StoryUpdate = S['StoryUpdate']
export type GlossaryEntry = S['GlossaryOut']
export type GlossaryUpdate = S['GlossaryUpdate']
export type StoryShare = S['ShareOut']
export type SharedStory = S['SharedStoryOut']
export type SharedDocument = S['SharedDocumentOut']
export type Showcase = S['ShowcaseOut']
export type ShowcaseDocument = S['ShowcaseDocumentOut']
export type Authorship = S['AuthorshipOut']
export type StoryActivity = S['StoryActivityOut']
export type AuthUser = S['UserOut']
export type AuthConfig = S['AuthConfigOut']
export type ProductFeedback = S['ProductFeedbackOut']
export type ProductFeedbackInput = S['ProductFeedbackIn']
export type Funnel = S['FunnelOut']
export type DocxImport = S['DocxImportOut']
export type BetaRound = S['RoundOut']
export type BetaDocument = S['BetaDocumentOut']
export type BetaThread = S['BetaThreadOut']
export type BetaPoll = S['PollOut']
export type BetaPollInput = S['PollIn']
export type SearchHit = S['SearchHit']
export type SearchPage = S['SearchPage']
export type SearchContext = operations['ApiStoriesStoryIdSearchSearch']['parameters']['query']['context']
export type LibrarySearchContext = NonNullable<operations['ApiSearchSearch']['parameters']['query']['context']>

export type Ladder = S['LadderOut']
export type Readiness = S['ReadinessOut']
export type Health = S['HealthOut']
export type Scaffold = S['ScaffoldOut']

export type StoryEvent = S['EventOut']
export type Act = S['ActOut']
export type Beat = S['BeatOut']
export type Thread = S['ThreadOut']
export type Evaluator = S['EvaluatorOut']
export type Evaluation = S['EvaluationOut']
export type EvaluationReport = S['ReportOut']
export type Character = S['CharacterOut']
export type Relationship = S['RelationshipOut']
export type Arc = S['ArcOut']
export type ArcStage = S['ArcStageOut']

export type Chapter = S['ChapterOut']
export type Scene = S['SceneOut']
export type ChapterBrief = S['ChapterBriefOut']
export type Links = S['LinksOut']
export type MoveResult = { sort_key: number; rebalanced: boolean; chapter_id?: string | null }

export type SceneContent = S['SceneContentOut']
export type SaveResult = S['SaveResultOut']
export type SceneRevision = S['SceneRevisionOut']
export type Annotation = S['AnnotationOut']
export type Progress = S['StoryProgressOut']

export type Suggestion = S['SuggestionOut']
export type PassResult = S['PassResultOut']
export type NoticerInfo = S['NoticerInfoOut']

export type Location = S['LocationOut']
export type LocationUsage = S['LocationUsageOut']
export type Continuity = S['ContinuityOut']
export type StoryTimeline = S['TimelineOut']
export type TimelineEntry = S['TimelineEntryOut']
export type AIConnection = S['ConnectionOut']
export type AIRun = S['RunOut']
export type CatchupScene = { id: string; title: string | null; chapter: { id: string; title: string | null } | null; reasons: string[]; summary: string | null }
export type OutlineCatchup = { drafted_scenes: number; pending_scenes: number; scenes: CatchupScene[] }
export type StoryVersion = S['VersionOut']
export type StoryVersionPreview = S['VersionPreview']
export type AIObservation = S['ObservationOut']
export type AgentToken = { id: string; story_id: string; label: string; expires_at: string }
export type OAuthGrant = { id: string; client_name: string; story_title: string; scopes: string[]; expires_at: string; revoked_at: string | null }
export type Shoutout = { id: string; name: string; thanks: string; colour: string; mark: string; sort_key: number }
export type ShoutoutInput = { name: string; thanks: string; colour: string; mark: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const visitorId = getVisitorId()
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (visitorId) headers.set('X-StoryTool-Visitor', visitorId)
  const res = await fetch(path, {
    ...init,
    headers,
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
  searchCapabilities: (id: string) => request<S['SearchCapabilities']>(`/api/stories/${id}/search/capabilities`),
  librarySearchCapabilities: () => request<S['SearchCapabilities']>('/api/search/capabilities'),
  searchLibrary: (context: LibrarySearchContext, q: string, field: string, entity: string, mode: 'text' | 'semantic', offset: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ context, q, mode, offset: String(offset) })
    if (field) params.set('field', field)
    if (entity) params.set('entity', entity)
    return request<SearchPage>(`/api/search?${params}`, { signal })
  },
  searchTarget: (storyId: string, hit: SearchHit) => request<SearchHit>(`/api/stories/${storyId}/search/target?${new URLSearchParams({ entity: hit.entity, id: hit.id })}`),
  searchStory: (id: string, context: SearchContext, q: string, field: string, entity: string, mode: 'text' | 'semantic', offset: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ context, q, mode, offset: String(offset) })
    if (field) params.set('field', field)
    if (entity) params.set('entity', entity)
    return request<SearchPage>(`/api/stories/${id}/search?${params}`, { signal })
  },
  getAuthorship: (id: string) => request<Authorship[]>(`/api/stories/${id}/authorship`),
  listShares: (id: string) => request<StoryShare[]>(`/api/stories/${id}/shares`),
  shareStory: (id: string, recipient_email: string, allow_import: boolean) =>
    request<StoryShare>(`/api/stories/${id}/shares`, { method: 'PUT', body: JSON.stringify({ recipient_email, allow_import }) }),
  revokeShare: (id: string, shareId: string) => request<void>(`/api/stories/${id}/shares/${shareId}`, { method: 'DELETE' }),
  listSharedStories: () => request<SharedStory[]>('/api/shared-stories'),
  readSharedStory: (id: string) => request<SharedDocument>(`/api/shared-stories/${id}`),
  getShowcase: (id: string) => request<Showcase>(`/api/stories/${id}/showcase`),
  setShowcase: (id: string, enabled: boolean) => request<Showcase>(`/api/stories/${id}/showcase`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  rotateShowcase: (id: string) => request<Showcase>(`/api/stories/${id}/showcase/rotate`, { method: 'POST' }),
  readShowcase: (token: string) => request<ShowcaseDocument>(`/api/showcase/${encodeURIComponent(token)}`),
  readOwnedStory: (id: string) => request<SharedDocument>(`/api/stories/${id}/reader`),
  storyActivity: (id: string, shared = false) => request<StoryActivity>(shared ? `/api/shared-stories/${id}/activity` : `/api/stories/${id}/activity`),
  importSharedStory: (id: string, expected_fingerprint: string) => post<Story>(`/api/shared-stories/${id}/import`, { expected_fingerprint }),
  getOAuthConsent: (id: string) => request<{ client_name: string; redirect_host: string; requested_scopes: string[]; expires_at: string }>(`/api/mcp/consent/${encodeURIComponent(id)}`),
  decideOAuthConsent: (id: string, data: { story_id: string | null; scopes: string[]; deny: boolean }) => post<{ redirect_url: string }>(`/api/mcp/consent/${encodeURIComponent(id)}`, data),
  listOAuthGrants: () => request<OAuthGrant[]>('/api/mcp/grants'),
  revokeOAuthGrant: (id: string) => request<void>(`/api/mcp/grants/${id}`, { method: 'DELETE' }),
  listStoryVersions: (id: string) => request<StoryVersion[]>(`/api/stories/${id}/versions`),
  saveStoryVersion: (id: string, label: string) => post<StoryVersion>(`/api/stories/${id}/versions`, { label }),
  previewStoryVersion: (id: string, versionId: string) => request<StoryVersionPreview>(`/api/stories/${id}/versions/${versionId}/preview`),
  restoreStoryVersion: (id: string, versionId: string, fingerprint: string) => post<S['VersionRestoreOut']>(`/api/stories/${id}/versions/${versionId}/restore`, { expected_fingerprint: fingerprint }),
  listAIConnections: () => request<AIConnection[]>('/api/ai/connections'),
  saveAIConnection: (body: { provider: AIConnection['provider']; model: string; api_key: string }) => request<AIConnection>('/api/ai/connections', { method: 'PUT', body: JSON.stringify(body) }),
  testAIConnection: (id: string) => post<{ connected: boolean }>(`/api/ai/connections/${id}/test`),
  deleteAIConnection: (id: string) => request<void>(`/api/ai/connections/${id}`, { method: 'DELETE' }),
  listAIRuns: (id: string, status?: string, limit = 30) =>
    request<AIRun[]>(`/api/stories/${id}/ai/runs?limit=${limit}${status ? `&status=${status}` : ''}`),
  getOutlineCatchup: (id: string) => request<OutlineCatchup>(`/api/stories/${id}/ai/catchup?limit=20`),
  getAIContext: (id: string) => request<{ entities: Record<string, Record<string, unknown>[]> }>(`/api/stories/${id}/ai/context`),
  proposeAIChanges: (id: string, body: S['PromptRequest']) => post<AIRun>(`/api/stories/${id}/ai/propose`, body),
  applyAIRun: (id: string, runId: string, operations?: number[]) => post<AIRun>(`/api/stories/${id}/ai/runs/${runId}/apply`, operations ? { operations } : undefined),
  undoAIRun: (id: string, runId: string) => post<AIRun>(`/api/stories/${id}/ai/runs/${runId}/undo`),
  dismissAIRun: (id: string, runId: string) => post<AIRun>(`/api/stories/${id}/ai/runs/${runId}/dismiss`),
  listAgentTokens: () => request<AgentToken[]>('/api/ai/agent-tokens'),
  createAgentToken: (storyId: string, label: string) => post<{ id: string; token: string; expires_at: string }>('/api/ai/agent-tokens', { story_id: storyId, label }),
  revokeAgentToken: (id: string) => request<void>(`/api/ai/agent-tokens/${id}`, { method: 'DELETE' }),
  // Google sign-in and current account
  authConfig: () => request<AuthConfig>('/api/auth/config'),
  currentUser: () => request<AuthUser>('/api/auth/me'),
  saveAuthorName: (body: S['AuthorNameIn']) => patch<AuthUser>('/api/auth/profile', body),
  listShoutouts: () => request<Shoutout[]>('/api/shoutouts'),
  adminStatus: () => request<{ is_admin: boolean }>('/api/admin/status'),
  betaRounds: (storyId: string) => request<BetaRound[]>(`/api/beta/manage/${storyId}/rounds`),
  createBetaRound: (storyId: string, body: S['RoundIn']) => post<BetaRound>(`/api/beta/manage/${storyId}/rounds`, body),
  updateBetaRound: (storyId: string, id: string, body: S['RoundUpdate']) => patch<BetaRound>(`/api/beta/manage/${storyId}/rounds/${id}`, body),
  rotateBetaLink: (storyId: string, id: string) => post<BetaRound>(`/api/beta/manage/${storyId}/rounds/${id}/rotate`),
  betaMembers: (storyId: string, id: string) => request<S['MemberOut'][]>(`/api/beta/manage/${storyId}/rounds/${id}/members`),
  updateBetaMember: (storyId: string, roundId: string, id: string, status: S['MemberUpdate']['status']) => patch<void>(`/api/beta/manage/${storyId}/rounds/${roundId}/members/${id}`, { status }),
  betaInvite: (token: string) => request<S['InviteOut']>(`/api/beta/invite/${encodeURIComponent(token)}`),
  joinBeta: (token: string) => post<S['InviteOut']>(`/api/beta/invite/${encodeURIComponent(token)}`),
  readBetaRound: (id: string) => request<BetaDocument>(`/api/beta/rounds/${id}`),
  betaProgress: (id: string, body: S['ProgressIn']) => patch<void>(`/api/beta/rounds/${id}/progress`, body),
  betaThreads: (id: string) => request<BetaThread[]>(`/api/beta/rounds/${id}/threads`),
  createBetaThread: (id: string, body: S['ThreadIn']) => post<BetaThread>(`/api/beta/rounds/${id}/threads`, body),
  betaThread: (id: string) => request<BetaThread>(`/api/beta/threads/${id}`),
  updateBetaThread: (id: string, body: S['BetaThreadUpdate']) => patch<BetaThread>(`/api/beta/threads/${id}`, body),
  replyBetaThread: (id: string, body: S['MessageIn']) => post<BetaThread>(`/api/beta/threads/${id}/messages`, body),
  editBetaMessage: (id: string, body: S['MessageIn']) => patch<BetaThread>(`/api/beta/messages/${id}`, body),
  deleteBetaMessage: (id: string) => request<void>(`/api/beta/messages/${id}`, { method: 'DELETE' }),
  betaPolls: (storyId: string) => request<BetaPoll[]>(`/api/beta/manage/${storyId}/polls`),
  createBetaPoll: (storyId: string, body: BetaPollInput) => post<BetaPoll>(`/api/beta/manage/${storyId}/polls`, body),
  updateBetaPoll: (storyId: string, id: string, body: BetaPollInput) => patch<BetaPoll>(`/api/beta/manage/${storyId}/polls/${id}`, body),
  deleteBetaPoll: (storyId: string, id: string, confirm: boolean) => request<void>(`/api/beta/manage/${storyId}/polls/${id}?confirm=${confirm}`, { method: 'DELETE' }),
  readerBetaPolls: (id: string) => request<BetaPoll[]>(`/api/beta/rounds/${id}/polls`),
  voteBetaPoll: (id: string, body: S['VoteIn']) => post<BetaPoll>(`/api/beta/polls/${id}/vote`, body),
  sendProductFeedback: (body: ProductFeedbackInput) => post<ProductFeedback>('/api/product-feedback', body),
  listProductFeedback: () => request<ProductFeedback[]>('/api/admin/product-feedback'),
  funnelCounts: () => request<Funnel>('/api/admin/funnel'),
  recordVisit: () => {
    const visitorId = getVisitorId()
    return visitorId ? post<void>('/api/site/visit', { visitor_id: visitorId }) : Promise.resolve()
  },
  createShoutout: (body: ShoutoutInput) => post<Shoutout>('/api/admin/shoutouts', body),
  updateShoutout: (id: string, body: Partial<ShoutoutInput> & { sort_key?: number }) => patch<Shoutout>(`/api/admin/shoutouts/${id}`, body),
  deleteShoutout: (id: string) => request<void>(`/api/admin/shoutouts/${id}`, { method: 'DELETE' }),
  googleLogin: (credential: string) => post<AuthUser>('/api/auth/google', { credential }),
  logout: () => post<{ signed_out: boolean }>('/api/auth/logout'),

  // Stories
  listStories: () => request<Story[]>('/api/stories'),
  getStory: (id: string) => request<Story>(`/api/stories/${id}`),
  createStory: (data: StoryCreate) => post<Story>('/api/stories', data),
  updateStory: (id: string, data: StoryUpdate) => patch<Story>(`/api/stories/${id}`, data),
  deleteStory: (id: string) => request<void>(`/api/stories/${id}`, { method: 'DELETE' }),
  listTrashedStories: () => request<Story[]>('/api/stories?trashed=true'),
  restoreStory: (id: string) => post<Story>(`/api/stories/${id}/restore`),
  purgeStory: (data: { id: string; expected_title: string; confirmation: 'DELETE' }) => request<void>(`/api/stories/${data.id}/purge`, { method: 'POST', body: JSON.stringify({ expected_title: data.expected_title, confirmation: data.confirmation }) }),

  // Computed layer
  getTimeline: (id: string) => request<StoryTimeline>(`/api/stories/${id}/timeline`),
  setScenePresence: (storyId: string, sceneId: string, characterId: string, isPresent: boolean) =>
    request<S['MentionOut']>(`/api/stories/${storyId}/scenes/${sceneId}/presence/${characterId}`, {
      method: 'PUT', body: JSON.stringify({ is_present: isPresent }),
    }),
  setEventPresence: (storyId: string, eventId: string, characterId: string, isPresent: boolean) =>
    request<{ is_present: boolean }>(`/api/stories/${storyId}/events/${eventId}/presence/${characterId}`, {
      method: 'PUT', body: JSON.stringify({ is_present: isPresent }),
    }),
  getLadder: (id: string) => request<Ladder>(`/api/stories/${id}/ladder`),
  getHealth: (id: string, maxLevel = 8) =>
    request<Health>(`/api/stories/${id}/health?max_level=${maxLevel}`),
  scaffold: (id: string, framework?: string) =>
    post<Scaffold>(
      `/api/stories/${id}/scaffold${framework ? `?framework=${framework}` : ''}`,
    ),

  // Levels 2-6
  listEvents: (id: string) => request<StoryEvent[]>(`/api/stories/${id}/events`),
  createEvent: (id: string, body: Pick<S['EventCreate'], 'label'> & Partial<Omit<S['EventCreate'], 'label'>>) =>
    post<StoryEvent>(`/api/stories/${id}/events`, body),
  updateEvent: (storyId: string, eventId: string, body: Record<string, unknown>) =>
    patch<StoryEvent>(`/api/stories/${storyId}/events/${eventId}`, body),
  deleteEvent: (storyId: string, eventId: string) =>
    request<void>(`/api/stories/${storyId}/events/${eventId}`, { method: 'DELETE' }),

  listCharacters: (id: string) => request<Character[]>(`/api/stories/${id}/characters`),
  createCharacter: (id: string, body: { name: string; role?: string }) =>
    post<Character>(`/api/stories/${id}/characters`, body),
  updateCharacter: (storyId: string, characterId: string, body: Record<string, unknown>) =>
    patch<Character>(`/api/stories/${storyId}/characters/${characterId}`, body),
  deleteCharacter: (storyId: string, characterId: string) =>
    request<void>(`/api/stories/${storyId}/characters/${characterId}`, { method: 'DELETE' }),
  listRelationships: (id: string) => request<Relationship[]>(`/api/stories/${id}/relationships`),
  createRelationship: (id: string, body: { character_a_id: string; character_b_id: string }) =>
    post<Relationship>(`/api/stories/${id}/relationships`, body),
  updateRelationship: (storyId: string, relationshipId: string, body: Record<string, unknown>) =>
    patch<Relationship>(`/api/stories/${storyId}/relationships/${relationshipId}`, body),
  deleteRelationship: (storyId: string, relationshipId: string) =>
    request<void>(`/api/stories/${storyId}/relationships/${relationshipId}`, { method: 'DELETE' }),

  listArcs: (id: string) => request<Arc[]>(`/api/stories/${id}/arcs`),
  createArc: (id: string, body: { character_id: string; resolution?: string | null }) =>
    post<Arc>(`/api/stories/${id}/arcs`, body),
  updateArc: (storyId: string, arcId: string, body: Record<string, unknown>) =>
    patch<Arc>(`/api/stories/${storyId}/arcs/${arcId}`, body),
  deleteArc: (storyId: string, arcId: string) =>
    request<void>(`/api/stories/${storyId}/arcs/${arcId}`, { method: 'DELETE' }),
  listArcStages: (arcId: string) => request<ArcStage[]>(`/api/arcs/${arcId}/stages`).then(orderScenes),
  createArcStage: (arcId: string, body: { label: string; sort_key?: number }) =>
    post<ArcStage>(`/api/arcs/${arcId}/stages`, body),
  updateArcStage: (arcId: string, stageId: string, body: Record<string, unknown>) =>
    patch<ArcStage>(`/api/arcs/${arcId}/stages/${stageId}`, body),
  deleteArcStage: (arcId: string, stageId: string) =>
    request<void>(`/api/arcs/${arcId}/stages/${stageId}`, { method: 'DELETE' }),

  listActs: (id: string) => request<Act[]>(`/api/stories/${id}/acts`).then(orderChapters),
  createAct: (id: string, body: { number: number; title?: string; sort_key?: number }) =>
    post<Act>(`/api/stories/${id}/acts`, body),
  updateAct: (storyId: string, actId: string, body: Record<string, unknown>) =>
    patch<Act>(`/api/stories/${storyId}/acts/${actId}`, body),
  deleteAct: (storyId: string, actId: string) =>
    request<void>(`/api/stories/${storyId}/acts/${actId}`, { method: 'DELETE' }),
  listBeats: (id: string) => request<Beat[]>(`/api/stories/${id}/beats`).then(orderScenes),
  createBeat: (id: string, body: { label: string; act_id?: string | null; sort_key?: number }) =>
    post<Beat>(`/api/stories/${id}/beats`, body),
  updateBeat: (storyId: string, beatId: string, body: Record<string, unknown>) =>
    patch<Beat>(`/api/stories/${storyId}/beats/${beatId}`, body),
  deleteBeat: (storyId: string, beatId: string) =>
    request<void>(`/api/stories/${storyId}/beats/${beatId}`, { method: 'DELETE' }),

  listThreads: (id: string) => request<Thread[]>(`/api/stories/${id}/threads`).then(orderScenes),
  listEvaluators: (id: string) => request<Evaluator[]>(`/api/stories/${id}/evaluations`),
  runEvaluator: (id: string, evaluatorId: string) => request<Evaluation>(`/api/stories/${id}/evaluations/${evaluatorId}`),
  listEvaluationReports: (id: string, evaluatorId: string) => request<EvaluationReport[]>(`/api/stories/${id}/evaluations/${evaluatorId}/reports`),
  runAIReview: (id: string, evaluatorId: string, connectionId: string) => post<EvaluationReport>(`/api/stories/${id}/evaluations/${evaluatorId}/ai-review`, { connection_id: connectionId }),
  createThread: (id: string, body: { type: string; title?: string; sort_key?: number }) =>
    post<Thread>(`/api/stories/${id}/threads`, body),
  updateThread: (storyId: string, threadId: string, body: Record<string, unknown>) =>
    patch<Thread>(`/api/stories/${storyId}/threads/${threadId}`, body),
  deleteThread: (storyId: string, threadId: string) =>
    request<void>(`/api/stories/${storyId}/threads/${threadId}`, { method: 'DELETE' }),

  // Levels 7-8
  listChapters: (id: string) => request<Chapter[]>(`/api/stories/${id}/chapters`).then(orderChapters),
  createChapter: (id: string, body: { number: number; title?: string; act_id?: string; sort_key?: number }) =>
    post<Chapter>(`/api/stories/${id}/chapters`, body),
  updateChapter: (storyId: string, chapterId: string, body: Record<string, unknown>) =>
    patch<Chapter>(`/api/stories/${storyId}/chapters/${chapterId}`, body),
  deleteChapter: (storyId: string, chapterId: string) =>
    request<void>(`/api/stories/${storyId}/chapters/${chapterId}`, { method: 'DELETE' }),
  moveChapter: (storyId: string, chapterId: string, body: { before_chapter_id?: string; after_chapter_id?: string }) =>
    post<MoveResult>(`/api/stories/${storyId}/chapters/${chapterId}/move`, body),

  // The flagship: derived entirely from the levels above the chapter.
  getBrief: (storyId: string, chapterId: string) =>
    request<ChapterBrief>(`/api/stories/${storyId}/chapters/${chapterId}/brief`),

  linkChapterBeat: (storyId: string, chapterId: string, beatId: string) =>
    post<Links>(`/api/stories/${storyId}/chapters/${chapterId}/beats`, { beat_id: beatId }),
  unlinkChapterBeat: (storyId: string, chapterId: string, beatId: string) =>
    request<void>(`/api/stories/${storyId}/chapters/${chapterId}/beats/${beatId}`, {
      method: 'DELETE',
    }),

  listScenes: (id: string) => request<Scene[]>(`/api/stories/${id}/scenes`),
  createScene: (id: string, body: { title?: string; chapter_id?: string; sort_key?: number }) =>
    post<Scene>(`/api/stories/${id}/scenes`, body),
  updateScene: (storyId: string, sceneId: string, body: Record<string, unknown>) =>
    patch<Scene>(`/api/stories/${storyId}/scenes/${sceneId}`, body),
  deleteScene: (storyId: string, sceneId: string) =>
    request<void>(`/api/stories/${storyId}/scenes/${sceneId}`, { method: 'DELETE' }),
  moveScene: (storyId: string, sceneId: string, body: { chapter_id?: string | null; before_scene_id?: string; after_scene_id?: string }) =>
    post<MoveResult>(`/api/stories/${storyId}/scenes/${sceneId}/move`, body),
  getSceneLinks: (storyId: string, sceneId: string) =>
    request<Links>(`/api/stories/${storyId}/scenes/${sceneId}/links`),
  linkSceneBeat: (storyId: string, sceneId: string, beatId: string) =>
    post<Links>(`/api/stories/${storyId}/scenes/${sceneId}/beats`, { beat_id: beatId }),
  unlinkSceneBeat: (storyId: string, sceneId: string, beatId: string) =>
    request<void>(`/api/stories/${storyId}/scenes/${sceneId}/beats/${beatId}`, { method: 'DELETE' }),
  linkSceneThread: (storyId: string, sceneId: string, threadId: string) =>
    post<Links>(`/api/stories/${storyId}/scenes/${sceneId}/threads`, { thread_id: threadId }),
  unlinkSceneThread: (storyId: string, sceneId: string, threadId: string) =>
    request<void>(`/api/stories/${storyId}/scenes/${sceneId}/threads/${threadId}`, { method: 'DELETE' }),
  linkSceneArcStage: (storyId: string, sceneId: string, stageId: string) =>
    post<Links>(`/api/stories/${storyId}/scenes/${sceneId}/arc-stages`, { arc_stage_id: stageId }),
  unlinkSceneArcStage: (storyId: string, sceneId: string, stageId: string) =>
    request<void>(`/api/stories/${storyId}/scenes/${sceneId}/arc-stages/${stageId}`, { method: 'DELETE' }),

  // Prose. Note there is no way to send a word_count -- the server owns it.
  getContent: (storyId: string, sceneId: string) =>
    request<SceneContent>(`/api/stories/${storyId}/scenes/${sceneId}/content`),
  saveContent: (
    storyId: string,
    sceneId: string,
    body: { content: string | null; snapshot?: boolean; snapshot_label?: string; expected_content?: string | null },
  ) =>
    request<SaveResult>(`/api/stories/${storyId}/scenes/${sceneId}/content`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  listRevisions: (storyId: string, sceneId: string) =>
    request<SceneRevision[]>(`/api/stories/${storyId}/scenes/${sceneId}/revisions`),
  snapshot: (storyId: string, sceneId: string, label?: string) =>
    post<SceneRevision>(
      `/api/stories/${storyId}/scenes/${sceneId}/revisions${label ? `?label=${encodeURIComponent(label)}` : ''}`,
    ),
  restoreRevision: (storyId: string, sceneId: string, revisionId: string) =>
    post<SaveResult>(
      `/api/stories/${storyId}/scenes/${sceneId}/revisions/${revisionId}/restore`,
    ),

  listAnnotations: (storyId: string, sceneId: string) =>
    request<Annotation[]>(`/api/stories/${storyId}/scenes/${sceneId}/annotations`),
  createAnnotation: (
    storyId: string,
    sceneId: string,
    body: { start_offset: number; end_offset: number; quoted_text: string; note?: string },
  ) => post<Annotation>(`/api/stories/${storyId}/scenes/${sceneId}/annotations`, body),
  deleteAnnotation: (storyId: string, sceneId: string, annotationId: string) =>
    request<void>(`/api/stories/${storyId}/scenes/${sceneId}/annotations/${annotationId}`, {
      method: 'DELETE',
    }),

  getProgress: (storyId: string) => request<Progress>(`/api/stories/${storyId}/progress`),
  manuscriptUrl: (storyId: string) => `/api/stories/${storyId}/manuscript`,
  manuscriptDocxUrl: (storyId: string) => `/api/stories/${storyId}/manuscript.docx`,
  manuscriptPdfUrl: (storyId: string, appendices = { glossary: false, timeline: false, places: false }) =>
    `/api/stories/${storyId}/manuscript.pdf?${new URLSearchParams(Object.entries(appendices).map(([key, value]) => [key, String(value)]))}`,
  manuscriptEpubUrl: (storyId: string) => `/api/stories/${storyId}/manuscript.epub`,
  manuscriptHtmlUrl: (storyId: string) => `/api/stories/${storyId}/manuscript.html`,
  manuscriptTextUrl: (storyId: string) => `/api/stories/${storyId}/manuscript.txt`,
  backupUrl: (storyId: string) => `/api/stories/${storyId}/backup`,
  importBackup: (backup: unknown) => post<Story>('/api/backups/import', backup),
  importDocx: (file: File, title: string) => request<DocxImport>(`/api/imports/docx?title=${encodeURIComponent(title)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, body: file,
  }),

  // Noticing. A pass only ever records observations -- it never alters structure or prose.
  noticerInfo: () => request<NoticerInfo>('/api/noticing'),
  runNoticingPass: (storyId: string) => post<PassResult>(`/api/stories/${storyId}/notice`),
  listSuggestions: (storyId: string) =>
    request<Suggestion[]>(`/api/stories/${storyId}/suggestions`),
  dismissSuggestion: (storyId: string, suggestionId: string) =>
    patch<Suggestion>(`/api/stories/${storyId}/suggestions/${suggestionId}`, {
      is_dismissed: true,
    }),

  // Places. Reference data, outside the ladder -- they never gate a level.
  listLocations: (storyId: string) =>
    request<Location[]>(`/api/stories/${storyId}/locations`),
  listGlossary: (storyId: string) => request<GlossaryEntry[]>(`/api/stories/${storyId}/glossary`),
  createGlossaryEntry: (storyId: string, body: S['GlossaryCreate']) => post<GlossaryEntry>(`/api/stories/${storyId}/glossary`, body),
  updateGlossaryEntry: (storyId: string, id: string, body: GlossaryUpdate) => patch<GlossaryEntry>(`/api/stories/${storyId}/glossary/${id}`, body),
  deleteGlossaryEntry: (storyId: string, id: string) => request<void>(`/api/stories/${storyId}/glossary/${id}`, { method: 'DELETE' }),
  createLocation: (storyId: string, body: { name: string; description?: string }) =>
    post<Location>(`/api/stories/${storyId}/locations`, body),
  updateLocation: (storyId: string, locationId: string, body: Record<string, unknown>) =>
    patch<Location>(`/api/stories/${storyId}/locations/${locationId}`, body),
  deleteLocation: (storyId: string, locationId: string) =>
    request<void>(`/api/stories/${storyId}/locations/${locationId}`, { method: 'DELETE' }),
  getLocationUsage: (storyId: string) =>
    request<LocationUsage[]>(`/api/stories/${storyId}/locations/usage`),

  // Contradictions are facts; possible anomalies are questions.
  getContinuity: (storyId: string) =>
    request<Continuity>(`/api/stories/${storyId}/continuity`),
}
