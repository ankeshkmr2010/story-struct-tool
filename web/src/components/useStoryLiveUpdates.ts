import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

const storyKeys = new Set(['story', 'chapters', 'scenes', 'acts', 'beats', 'threads', 'characters', 'relationships', 'arcs', 'locations', 'glossary', 'events', 'progress', 'health', 'ladder', 'brief', 'timeline', 'content', 'annotations', 'scene-links', 'suggestions', 'observations', 'mentions', 'continuity', 'location-usage', 'ai-runs', 'ai-observations', 'ai-context', 'versions', 'reading-document', 'shared-document', 'story-shares', 'authorship'])

export function useStoryLiveUpdates(storyId: string, shared = false, enabled = true) {
  const qc = useQueryClient()
  const lastToken = useRef<string | undefined>(undefined)
  const activity = useQuery({ queryKey: ['story-activity', storyId, shared], queryFn: () => api.storyActivity(storyId, shared), enabled, refetchInterval: 5000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, staleTime: 0, retry: false })
  useEffect(() => {
    const token = activity.data?.change_token
    if (!enabled || !token || token === lastToken.current) return
    lastToken.current = token
    void qc.invalidateQueries({ predicate: query => storyKeys.has(String(query.queryKey[0])) && query.queryKey[1] === storyId || query.queryKey[0] === 'arc-stages' })
    void qc.invalidateQueries({ queryKey: ['stories'] })
    void qc.invalidateQueries({ queryKey: ['shared-stories'] })
  }, [activity.data, storyId, enabled, qc])
  useEffect(() => {
    if (enabled && activity.isError) void qc.invalidateQueries({ queryKey: [shared ? 'shared-document' : 'story', storyId] })
  }, [activity.isError, activity.errorUpdatedAt, enabled, shared, storyId, qc])
  return activity
}
