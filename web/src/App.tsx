import { Outlet, Route, Routes } from 'react-router-dom'
import { AuthGate } from './components/AuthGate'
import StoryList from './pages/StoryList'
import StoryWorkspace from './pages/StoryWorkspace'
import HowToUse from './pages/HowToUse'
import UserSettings from './pages/UserSettings'

export default function App() {
  return (
    <Routes>
      <Route path="/how-to-use" element={<HowToUse />} />
      <Route element={<AuthGate><Outlet /></AuthGate>}>
        <Route path="/" element={<StoryList />} />
        <Route path="/settings" element={<UserSettings />} />
        <Route path="/stories/:storyId" element={<StoryWorkspace />} />
      </Route>
    </Routes>
  )
}
