import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/** Every [TK] in reading order, from the TK placeholders check; shared by the Write panel and Design. */
export function usePlaceholders(storyId: string, enabled = true) {
  return useQuery({ queryKey: ['placeholders', storyId], queryFn: () => api.runEvaluator(storyId, 'tk_placeholders'), enabled })
}
