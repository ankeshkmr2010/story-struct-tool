import { Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import Landing from './pages/Landing'
import { ThemeProvider, ThemeToggle } from './components/Theme'
import { AccountMenu, AuthGate } from './components/AuthGate'
import StoryList from './pages/StoryList'
import StoryWorkspace from './pages/StoryWorkspace'
const SharedStoryReader = lazy(() => import('./pages/SharedStoryReader'))
import HowToUse from './pages/HowToUse'
import UserSettings from './pages/UserSettings'
import OAuthConsent from './pages/OAuthConsent'

export default function App() {
  const location = useLocation()
  useEffect(() => {
    if (location.hash) window.setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 0)
  }, [location.pathname, location.hash])
  return (
    <ThemeProvider>
      <header className="site-header">
        <Link to="/" className="site-brand"><img src="/branding/storytool.svg" alt="" width="32" height="32" />StoryTool</Link>
        <nav aria-label="Main navigation">
          <NavLink to="/library" className={`site-nav-link ${location.pathname.startsWith('/stories/') ? 'is-active' : ''}`}>Your stories</NavLink>
          <NavLink to="/how-to-use" className="site-nav-link">How to use</NavLink>
          <Link to="/#mcp" className={`site-nav-link ${location.hash === '#mcp' ? 'is-active' : ''}`}>Connect AI</Link>
        </nav>
        <div className="site-header-actions"><ThemeToggle /><AccountMenu /></div>
      </header>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/how-to-use" element={<HowToUse />} />
      <Route element={<AuthGate><Outlet /></AuthGate>}>
        <Route path="/library" element={<StoryList />} />
        <Route path="/settings" element={<UserSettings />} />
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="/stories/:storyId" element={<StoryWorkspace />} />
        <Route path="/shared/:storyId" element={<Suspense fallback={<p className="p-8">Loading reader…</p>}><SharedStoryReader /></Suspense>} />
      </Route>
    </Routes>
    </ThemeProvider>
  )
}
