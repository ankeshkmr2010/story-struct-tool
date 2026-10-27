import { Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react'
import Landing from './pages/Landing'
import { ThemeProvider, ThemeToggle } from './components/Theme'
import { LanguageToggle } from './components/LanguageToggle'
import { AccountMenu, AuthGate } from './components/AuthGate'
import StoryList from './pages/StoryList'
import StoryWorkspace from './pages/StoryWorkspace'
import StoryImagesPage from './pages/StoryImagesPage'
import BesidePage from './pages/BesidePage'
const SharedStoryReader = lazy(() => import('./pages/SharedStoryReader'))
const StoryShowcase = lazy(() => import('./pages/StoryShowcase'))
import HowToUse from './pages/HowToUse'
import Roadmap from './pages/Roadmap'
import Shoutouts from './pages/Shoutouts'
import About from './pages/About'
import Pricing from './pages/Pricing'
import Privacy from './pages/Privacy'
import Feedback from './pages/Feedback'
import { api } from './api/client'
import UserSettings from './pages/UserSettings'
import WritingChecks from './pages/WritingChecks'
import OAuthConsent from './pages/OAuthConsent'
import BetaOwner from './pages/BetaOwner'
import BetaPolls from './pages/BetaPolls'
import BetaReaderPage, { BetaInvitePage } from './pages/BetaReader'
import BetaThreadPage from './pages/BetaThread'
import { t, tx, useUiLanguage } from './i18n'
const TryStory = lazy(() => import('./pages/TryStory'))
const TryKeep = lazy(() => import('./pages/TryStory').then(m => ({ default: m.TryKeep })))
const TryLocked = lazy(() => import('./pages/TryStory').then(m => ({ default: m.TryLocked })))

// Browser tab titles by route; story pages refine theirs once the story's title loads.
const PAGE_TITLES: [RegExp, string][] = [
  [/^\/$/, tx('StoryTool — Your novel’s memory, for you and your AI')], [/^\/try/, tx('Try StoryTool')], [/^\/how-to-use/, tx('How to use · StoryTool')],
  [/^\/roadmap/, tx('Roadmap · StoryTool')], [/^\/thanks/, tx('Shoutouts · StoryTool')], [/^\/about/, tx('About the developer · StoryTool')], [/^\/pricing/, tx('Pricing · StoryTool')],
  [/^\/privacy/, tx('Privacy · StoryTool')], [/^\/library/, tx('Your stories · StoryTool')], [/^\/settings/, tx('Settings · StoryTool')],
  [/^\/checks/, tx('Writing checks · StoryTool')], [/^\/feedback/, tx('Feedback · StoryTool')], [/^\/oauth/, tx('Connect AI · StoryTool')],
  [/^\/stories\/[^/]+\/images/, tx('Images · StoryTool')], [/^\/stories\/[^/]+\/beside/, tx('Beside · StoryTool')], [/^\/stories\/[^/]+\/beta/, tx('Beta readers · StoryTool')],
  [/^\/stories\/[^/]+\/polls/, tx('Reader polls · StoryTool')], [/^\/stories\//, tx('Story · StoryTool')], [/^\/shared\//, tx('Shared story · StoryTool')],
  [/^\/beta\//, tx('Beta manuscript · StoryTool')], [/^\/showcase\//, tx('Showcase · StoryTool')],
]

export default function App() {
  const location = useLocation()
  const language = useUiLanguage()
  useLayoutEffect(() => { document.title = t(PAGE_TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] ?? 'StoryTool') }, [location.pathname, language])
  const header = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const element = header.current
    if (!element) return
    const measure = () => document.documentElement.style.setProperty('--site-header-height', `${element.getBoundingClientRect().height}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const sandbox = location.pathname === '/try' || location.pathname.startsWith('/try/')
  useEffect(() => { void api.recordVisit().catch(() => {}) }, [])
  useLayoutEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [location.pathname, location.hash])
  return (
    <ThemeProvider>
      <header ref={header} className={`site-header${location.pathname.startsWith('/stories/') || sandbox ? ' is-compact' : ''}`}>
        <Link to="/" className="site-brand"><img src="/branding/storytool.svg" alt="" width="32" height="32" />{t('StoryTool')}</Link>
        {!sandbox && <nav aria-label={t('Main navigation')}>
          <NavLink to="/library" className={`site-nav-link ${location.pathname.startsWith('/stories/') ? 'is-active' : ''}`}>{t('Your stories')}</NavLink>
          <NavLink to="/how-to-use" className="site-nav-link">{t('How to use')}</NavLink>
          <NavLink to="/roadmap" className="site-nav-link">{t('Roadmap')}</NavLink>
          <NavLink to="/about" className="site-nav-link">{t('About')}</NavLink>
          <Link to="/how-to-use#mcp" className={`site-nav-link ${location.hash === '#mcp' ? 'is-active' : ''}`}>{t('Connect AI')}</Link>
          <NavLink to="/feedback" className="site-nav-link site-feedback-link">{t('Feedback')}</NavLink>
        </nav>}
        <div className="site-header-actions"><LanguageToggle signedIn={!sandbox} /><ThemeToggle />{!sandbox && <AccountMenu />}</div>
      </header>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/try" element={<Suspense fallback={<p className="p-8">{t('Opening sandbox…')}</p>}><TryStory /></Suspense>} />
      <Route path="/try/keep" element={<Suspense fallback={<p className="p-8">{t('Preparing sign-in…')}</p>}><TryKeep /></Suspense>} />
      <Route path="/try/*" element={<Suspense fallback={<p className="p-8">{t('Opening…')}</p>}><TryLocked /></Suspense>} />
      <Route path="/how-to-use" element={<HowToUse />} />
      <Route path="/roadmap" element={<Roadmap />} />
      <Route path="/thanks" element={<Shoutouts />} />
      <Route path="/about" element={<About />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/showcase/:token" element={<Suspense fallback={<p className="p-8">{t('Loading showcase…')}</p>}><StoryShowcase /></Suspense>} />
      <Route element={<AuthGate><Outlet /></AuthGate>}>
        <Route path="/library" element={<StoryList />} />
        <Route path="/settings" element={<UserSettings />} />
        <Route path="/checks" element={<WritingChecks />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="/stories/:storyId" element={<StoryWorkspace />} />
        <Route path="/stories/:storyId/images" element={<StoryImagesPage />} />
        <Route path="/stories/:storyId/beside/:kind/:id" element={<BesidePage />} />
        <Route path="/stories/:storyId/beta" element={<BetaOwner />} />
        <Route path="/stories/:storyId/polls" element={<BetaPolls />} />
        <Route path="/shared/:storyId" element={<Suspense fallback={<p className="p-8">{t('Loading reader…')}</p>}><SharedStoryReader /></Suspense>} />
      </Route>
      <Route element={<AuthGate prompt={t('Sign in with Google to read and discuss this beta manuscript.')}><Outlet /></AuthGate>}>
        <Route path="/beta/join/:token" element={<BetaInvitePage />} />
        <Route path="/beta/rounds/:roundId" element={<BetaReaderPage />} />
        <Route path="/beta/rounds/:roundId/threads/:threadId" element={<BetaThreadPage />} />
      </Route>
    </Routes>
    </ThemeProvider>
  )
}
