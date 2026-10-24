import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { StoryImagePicker } from '../components/StoryImages'
import { t } from '../i18n'

export default function StoryImagesPage() {
  const { storyId = '' } = useParams()
  const [params] = useSearchParams()
  const sceneId = params.get('scene')
  const scenes = useQuery({ queryKey: ['scenes', storyId], queryFn: () => api.listScenes(storyId), enabled: Boolean(sceneId) })
  const scene = scenes.data?.find(scene => scene.id === sceneId)
  const story = useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) })
  return <main className="mx-auto max-w-[1200px] px-5 py-8 text-[var(--ink)]">
    <Link to={`/stories/${storyId}`} className="underline underline-offset-4">{t('← Back to story')}</Link>
    {story.isPending ? <p role="status">{t('Loading story…')}</p> : story.isError ? <p role="alert">{errorText(story.error)} <button type="button" onClick={() => { void story.refetch() }}>{t('Retry')}</button></p> : <>
      <h1 className="my-6 text-2xl font-semibold">{t('{0} · Images', story.data.title)}</h1>
      {sceneId && <h2 className="mb-4 text-lg">{scene?.title || t('Selected scene')}</h2>}
      <StoryImagePicker storyId={storyId} page onClose={() => {}} />
    </>}
  </main>
}
