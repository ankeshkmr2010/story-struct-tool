import { Route, Routes } from 'react-router-dom'
import StoryList from './pages/StoryList'
import StoryWorkspace from './pages/StoryWorkspace'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StoryList />} />
      <Route path="/stories/:storyId" element={<StoryWorkspace />} />
    </Routes>
  )
}
