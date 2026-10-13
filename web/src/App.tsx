import { Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useLayoutEffect } from 'react'
import Landing from './pages/Landing'
import { ThemeProvider, ThemeToggle } from './components/Theme'
import { AccountMenu, AuthGate } from './components/AuthGate'
import StoryList from './pages/StoryList'
import StoryWorkspace from './pages/StoryWorkspace'
const SharedStoryReader = lazy(() => import('./pages/SharedStoryReader'))
const StoryShowcase = lazy(() => import('./pages/StoryShowcase'))
import HowToUse from './pages/HowToUse'
import Roadmap from './pages/Roadmap'
import Shoutouts from './pages/Shoutouts'
import Pricing from './pages/Pricing'
import Privacy from './pages/Privacy'
import Feedback from './pages/Feedback'
import { api } from './api/client'
import UserSettings from './pages/UserSettings'
import OAuthConsent from './pages/OAuthConsent'
import BetaOwner from './pages/BetaOwner'
import BetaPolls from './pages/BetaPolls'
import BetaReaderPage, { BetaInvitePage } from './pages/BetaReader'
import BetaThreadPage from './pages/BetaThread'
const TryStory = lazy(() => import('./pages/TryStory'))
const TryKeep = lazy(() => import('./pages/TryStory').then(m => ({ default: m.TryKeep })))
const TryLocked = lazy(() => import('./pages/TryStory').then(m => ({ default: m.TryLocked })))

export default function App() {
  const location = useLocation()
  const sandbox = location.pathname === '/try' || location.pathname.startsWith('/try/')
  useEffect(() => { void api.recordVisit().catch(() => {}) }, [])
  useLayoutEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [location.pathname, location.hash])
  return (
    <ThemeProvider>
      <header className="site-header">
        <Link to="/" className="site-brand"><img src="/branding/storytool.svg" alt="" width="32" height="32" />StoryTool</Link>
        {!sandbox && <nav aria-label="Main navigation">
          <NavLink to="/library" className={`site-nav-link ${location.pathname.startsWith('/stories/') ? 'is-active' : ''}`}>Your stories</NavLink>
          <NavLink to="/how-to-use" className="site-nav-link">How to use</NavLink>
          <NavLink to="/roadmap" className="site-nav-link">Roadmap</NavLink>
          <a href="/#mcp" className={`site-nav-link ${location.hash === '#mcp' ? 'is-active' : ''}`}>Connect AI</a>
          <NavLink to="/feedback" className="site-nav-link site-feedback-link">Feedback</NavLink>
        </nav>}
        <div className="site-header-actions"><ThemeToggle />{!sandbox && <AccountMenu />}</div>
      </header>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/try" element={<Suspense fallback={<p className="p-8">Opening sandbox…</p>}><TryStory /></Suspense>} />
      <Route path="/try/keep" element={<Suspense fallback={<p className="p-8">Preparing sign-in…</p>}><TryKeep /></Suspense>} />
      <Route path="/try/*" element={<Suspense fallback={<p className="p-8">Opening…</p>}><TryLocked /></Suspense>} />
      <Route path="/how-to-use" element={<HowToUse />} />
      <Route path="/roadmap" element={<Roadmap />} />
      <Route path="/thanks" element={<Shoutouts />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/showcase/:token" element={<Suspense fallback={<p className="p-8">Loading showcase…</p>}><StoryShowcase /></Suspense>} />
      <Route element={<AuthGate><Outlet /></AuthGate>}>
        <Route path="/library" element={<StoryList />} />
        <Route path="/settings" element={<UserSettings />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="/stories/:storyId" element={<StoryWorkspace />} />
        <Route path="/stories/:storyId/beta" element={<BetaOwner />} />
        <Route path="/stories/:storyId/polls" element={<BetaPolls />} />
        <Route path="/shared/:storyId" element={<Suspense fallback={<p className="p-8">Loading reader…</p>}><SharedStoryReader /></Suspense>} />
      </Route>
      <Route element={<AuthGate prompt="Sign in with Google to read and discuss this beta manuscript."><Outlet /></AuthGate>}>
        <Route path="/beta/join/:token" element={<BetaInvitePage />} />
        <Route path="/beta/rounds/:roundId" element={<BetaReaderPage />} />
        <Route path="/beta/rounds/:roundId/threads/:threadId" element={<BetaThreadPage />} />
      </Route>
    </Routes>
    </ThemeProvider>
  )
}
