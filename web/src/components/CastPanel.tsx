import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { plural, t } from '../i18n'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase() || '?'

/** Write's Cast tab: every character with their role and POV scene count; a name opens the character in Design. */
export function CastPanel({ storyId, onOpen }: { storyId: string; onOpen: (id: string) => void }) {
  const characters = useQuery({ queryKey: ['characters', storyId], queryFn: () => api.listCharacters(storyId) })
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId) })
  if (characters.isPending) return <p className="writer-help">{t('Loading…')}</p>
  if (!characters.data?.length) return <p className="writer-help">{t('No characters yet. Add them in Design.')}</p>
  return <ul className="ws-cast">
    {characters.data.map(character => {
      const pov = (scenes.data ?? []).filter(scene => scene.pov_character_id === character.id).length
      return <li key={character.id}>
        <button type="button" onClick={() => onOpen(character.id)}>
          <span className="ws-cast-avatar" aria-hidden="true">{initials(character.name)}</span>
          <span><strong>{character.name}</strong><small>{[character.role, pov > 0 ? plural(pov, 'POV · {0} scene', 'POV · {0} scenes', pov) : null].filter(Boolean).join(' · ')}</small></span>
        </button>
      </li>
    })}
  </ul>
}
