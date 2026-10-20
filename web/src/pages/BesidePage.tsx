import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BesidePanel } from '../components/BesidePanel'
import { besideUrl, isBesideItem, type BesideItem } from '../components/beside'

/** The Beside panel on its own page, for a second window or screen. */
export default function BesidePage() {
  const { storyId = '', kind, id } = useParams()
  const navigate = useNavigate()
  const [picking, setPicking] = useState(false)
  const candidate = { kind, id }
  const item: BesideItem | null = isBesideItem(candidate) ? candidate : null
  return <main className="beside-page">
    <BesidePanel
      storyId={storyId}
      target={picking || !item ? { kind: 'pick' } : item}
      onChange={next => { if (isBesideItem(next)) { setPicking(false); navigate(besideUrl(storyId, next)) } else setPicking(true) }}
    />
  </main>
}
