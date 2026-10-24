import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { DeleteButton, InlineText } from './fields'
import { offerRename } from './rename'

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
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.updateLocation(storyId, id, body),
    onSuccess: invalidate,
  })

  const usageFor = (id: string) => usage.data?.find((u) => u.location_id === id)

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('Places')}</h2>
      <p className="mb-3 text-xs text-slate-400">
        {t('Reference data — a place never gates a level. Linking scenes to places is what makes continuity checking possible.')}
      </p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <input
          className="flex-1 rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm"
          placeholder={t('Place name…')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded bg-slate-900 dark:bg-slate-200 px-3 py-1.5 text-sm text-white dark:text-slate-950 disabled:opacity-40"
        >
          {t('Add')}
        </button>
      </form>

      {create.isError && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-300">
          {/* The 409 from a duplicate name, which would otherwise break continuity checks. */}
          {t('A place with that name already exists in this story.')}
        </p>
      )}

      <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
        {locations.data?.map((location) => {
          const used = usageFor(location.id)
          return (
            <li key={location.id} id={`search-location-${location.id}`} className="py-2.5 scroll-mt-4">
              <div className="flex items-baseline gap-2">
                <div className="min-w-0 flex-1"><InlineText value={location.name} placeholder={t('Place name')} onSave={async (name) => { await update.mutateAsync({ id: location.id, body: { name } }); offerRename({ kind: 'location', id: location.id, from: location.name, to: name ?? '' }) }} className="font-medium" /></div>
                {used && used.scene_count > 0 ? (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t('{0} scene{1}', used.scene_count, used.scene_count === 1 ? '' : t('s'))}
                    {used.chapter_numbers.length > 0 &&
                      t(' · ch {0}', used.chapter_numbers.join(', '))}
                    {used.first_story_time !== null &&
                      t(' · story-time {0}{1}', used.first_story_time, used.last_story_time !== used.first_story_time
                          ? `–${used.last_story_time}`
                          : '')}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 italic">{t('no scenes yet')}</span>
                )}
                <DeleteButton onConfirm={() => remove.mutate(location.id)} what="place" />
              </div>
              <label className="mt-1 block text-[10px] uppercase text-slate-400">{t('Description')}<InlineText value={location.description} placeholder={t('Describe the place')} onSave={(description) => update.mutateAsync({ id: location.id, body: { description } })} multiline /></label>
              <ReferenceImages storyId={storyId} entity="location" entityId={location.id} />
              <label className="mt-1 block text-[10px] uppercase text-slate-400">{t('Atmosphere')}<InlineText value={location.atmosphere_notes} placeholder={t('What does it feel like?')} onSave={(atmosphere_notes) => update.mutateAsync({ id: location.id, body: { atmosphere_notes } })} multiline /></label>
            </li>
          )
        })}
      </ul>

      {locations.data?.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">{t('No places yet.')}</p>
      )}
    </div>
  )
}
import { ReferenceImages } from './StoryImages'
import { t } from '../i18n'
