import { Link, Outlet, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import { ThemeProvider, ThemeToggle } from './components/Theme'
import { AccountMenu, AuthGate } from './components/AuthGate'
import StoryList from './pages/StoryList'
import StoryWorkspace from './pages/StoryWorkspace'
import HowToUse from './pages/HowToUse'
import UserSettings from './pages/UserSettings'
import OAuthConsent from './pages/OAuthConsent'

export default function App() {
  return (
    <ThemeProvider>
      <header className="site-header">
        <Link to="/" className="site-brand"><img src="/branding/storytool.svg" alt="" width="32" height="32" />StoryTool</Link>
        <nav aria-label="Main navigation">
          <Link to="/how-to-use" className="site-guide">How to use</Link>
          <Link to="/library">Your stories</Link>
          <AccountMenu />
        </nav>
        <ThemeToggle />
      </header>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/how-to-use" element={<HowToUse />} />
      <Route element={<AuthGate><Outlet /></AuthGate>}>
        <Route path="/library" element={<StoryList />} />
        <Route path="/settings" element={<UserSettings />} />
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="/stories/:storyId" element={<StoryWorkspace />} />
      </Route>
    </Routes>
    </ThemeProvider>
  )
}
