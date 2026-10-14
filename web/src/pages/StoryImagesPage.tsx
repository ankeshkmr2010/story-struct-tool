import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { errorText } from '../api/errors'
import { StoryImagePicker } from '../components/StoryImages'

export default function StoryImagesPage() {
  const { storyId = '' } = useParams()
  const story = useQuery({ queryKey: ['story', storyId], queryFn: () => api.getStory(storyId) })
  return <main className="mx-auto max-w-5xl px-5 py-8 text-[var(--ink)]">
    <Link to={`/stories/${storyId}`} className="underline underline-offset-4">← Back to story</Link>
    {story.isPending ? <p role="status">Loading story…</p> : story.isError ? <p role="alert">{errorText(story.error)} <button type="button" onClick={() => { void story.refetch() }}>Retry</button></p> : <>
      <h1 className="my-6 text-2xl font-semibold">{story.data.title} · Images</h1>
      <StoryImagePicker storyId={storyId} page onClose={() => {}} />
    </>}
  </main>
}
