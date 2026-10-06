import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * Locations, and where they are actually used.
 *
 * Reference data rather than a rung on the ladder — defining a place never unlocks anything,
 * and not defining one never blocks anything. The usage figures are all derived from scenes,
 * so a location stores nothing about its own use and cannot go stale.
 */
export function PlacesPanel({ storyId }: { storyId: string }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')

  const locations = useQuery({
    queryKey: ['locations', storyId],
    queryFn: () => api.listLocations(storyId),
  })
  const usage = useQuery({
    queryKey: ['location-usage', storyId],
    queryFn: () => api.getLocationUsage(storyId),
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['locations', storyId] })
    void qc.invalidateQueries({ queryKey: ['location-usage', storyId] })
    void qc.invalidateQueries({ queryKey: ['continuity', storyId] })
  }

  const create = useMutation({
    mutationFn: () => api.createLocation(storyId, { name: name.trim() }),
    onSuccess: () => {
      setName('')
      invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteLocation(storyId, id),
    onSuccess: invalidate,
  })

  const usageFor = (id: string) => usage.data?.find((u) => u.location_id === id)

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900">Places</h2>
      <p className="mb-3 text-xs text-slate-400">
        Reference data — a place never gates a level. Linking scenes to places is what makes
        continuity checking possible.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <input
          className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Place name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {create.isError && (
        <p className="mt-1.5 text-xs text-red-600">
          {/* The 409 from a duplicate name, which would otherwise break continuity checks. */}
          A place with that name already exists in this story.
        </p>
      )}

      <ul className="mt-4 divide-y divide-slate-100">
        {locations.data?.map((location) => {
          const used = usageFor(location.id)
          return (
            <li key={location.id} className="py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-slate-900">{location.name}</span>
                {used && used.scene_count > 0 ? (
                  <span className="text-xs text-slate-500">
                    {used.scene_count} scene{used.scene_count === 1 ? '' : 's'}
                    {used.chapter_numbers.length > 0 &&
                      ` · ch ${used.chapter_numbers.join(', ')}`}
                    {used.first_story_time !== null &&
                      ` · story-time ${used.first_story_time}${
                        used.last_story_time !== used.first_story_time
                          ? `–${used.last_story_time}`
                          : ''
                      }`}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 italic">no scenes yet</span>
                )}
                <button
                  onClick={() => remove.mutate(location.id)}
                  className="ml-auto text-xs text-slate-400 hover:text-red-600"
                >
                  delete
                </button>
              </div>
              {location.description && (
                <p className="mt-0.5 text-xs text-slate-500">{location.description}</p>
              )}
            </li>
          )
        })}
      </ul>

      {locations.data?.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">No places yet.</p>
      )}
    </div>
  )
}
