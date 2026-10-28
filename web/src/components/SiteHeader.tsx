import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { t, UI_LANGUAGES } from '../i18n'
import { useLanguageChoice } from './LanguageToggle'
import { useLogout } from './AuthGate'
import { useTheme } from './theme-context'

const icon = (path: ReactNode, size = 16) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
const speech = <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
const moon = <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
const sun = <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
const check = <svg className="sh-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
const chevron = <svg className="sh-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
const google = <span className="sh-g" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 48 48">
  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
</svg></span>

/** Open/close state for a header dropdown: closes on an outside click or Escape. */
function useDropdown() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close) }
  }, [open])
  return { open, setOpen, box }
}

function initials(name: string | null | undefined, email: string) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return (words.length ? words.slice(0, 2).map(word => word[0]).join('') : email.slice(0, 1)).toUpperCase()
}

/** Site-wide header (2026-10-28 redesign): mark, main links, Feedback, language, theme and
 * the account. Below 960px everything but the account folds into a sheet. The guided tour
 * (/try) shows only language and theme, as before. */
export function SiteHeader({ headerRef, sandbox, compact }: { headerRef: Ref<HTMLElement>; sandbox: boolean; compact: boolean }) {
  const location = useLocation()
  const { theme, toggle } = useTheme()
  const { language, current, choose } = useLanguageChoice(!sandbox)
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false, enabled: !sandbox })
  const logout = useLogout()
  const languageMenu = useDropdown()
  const accountMenu = useDropdown()
  const [sheet, setSheet] = useState(false)
  useEffect(() => { setSheet(false); languageMenu.setOpen(false); accountMenu.setOpen(false) }, [location.pathname, location.hash]) // eslint-disable-line react-hooks/exhaustive-deps

  const signedIn = !sandbox && !!me.data
  const signedOut = !sandbox && me.isError
  const mcp = location.pathname === '/how-to-use' && location.hash === '#mcp'
  const storiesActive = location.pathname === '/library' || location.pathname.startsWith('/stories/')
  const themeLabel = theme === 'dark' ? t('Light mode') : t('Dark mode')
  const links = [
    ...(signedIn ? [{ to: '/library', label: t('Your stories'), active: storiesActive }] : []),
    { to: '/how-to-use', label: t('How to use'), active: location.pathname === '/how-to-use' && !mcp },
    { to: '/how-to-use#mcp', label: t('Connect AI'), active: mcp },
    { to: '/about', label: t('About'), active: location.pathname === '/about' },
  ]
  const signIn = (extra = '') => <Link to="/library" className={`sh-gbtn ${extra}`}>{google}{t('Sign in with Google')}</Link>

  return <header ref={headerRef} className={`site-header${compact ? ' is-compact' : ''}`}>
    <div className="sh-bar">
      <Link to="/" className="sh-mark">{t('StoryTool')}</Link>
      {!sandbox && <nav className="sh-links" aria-label={t('Main navigation')}>
        {links.map(link => <NavLink key={link.to} to={link.to} className={() => link.active ? 'is-active' : ''} aria-current={link.active ? 'page' : undefined}>{link.label}</NavLink>)}
      </nav>}
      <div className="sh-right">
        {!sandbox && <span className="sh-vr" aria-hidden="true" />}
        {!sandbox && <NavLink to="/feedback" className="sh-ghost sh-fb sh-tip" data-tip={t('Feedback')}>{icon(speech)}<span className="sh-fb-text">{t('Feedback')}</span></NavLink>}
        <div className="sh-dd sh-lang" ref={languageMenu.box}>
          <button type="button" className="sh-ghost" aria-haspopup="menu" aria-expanded={languageMenu.open} aria-label={t('Interface language: {0}', current.label)} onClick={() => languageMenu.setOpen(value => !value)}>
            {icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>)}
            <span>{current.id.slice(0, 2).toUpperCase()}</span>{chevron}
          </button>
          {languageMenu.open && <div className="sh-menu" role="menu">
            {UI_LANGUAGES.map(option => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === language} onClick={() => { languageMenu.setOpen(false); choose(option.id) }}>{option.label}{check}</button>)}
          </div>}
        </div>
        <button type="button" className="sh-ghost sh-icon sh-tip sh-theme" data-tip={themeLabel} aria-label={t('Switch to {0} mode', theme === 'dark' ? t('light') : t('dark'))} onClick={toggle}>{icon(theme === 'dark' ? sun : moon)}</button>
        {signedOut && signIn('sh-signin-bar')}
        {signedIn && me.data && <div className="sh-dd" ref={accountMenu.box}>
          <button type="button" className="sh-avatar" aria-haspopup="menu" aria-expanded={accountMenu.open} aria-label={t('Account menu')} onClick={() => accountMenu.setOpen(value => !value)}>{initials(me.data.name, me.data.email)}</button>
          {accountMenu.open && <div className="sh-menu sh-menu-account" role="menu">
            <div className="sh-menu-head" role="none"><strong>{me.data.name ?? t('Your account')}</strong><span>{me.data.email}</span></div>
            <Link role="menuitem" to="/settings">{icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>)}{t('Settings')}</Link>
            <Link role="menuitem" to="/checks">{icon(<path d="m5 12 4 4 10-10" />)}{t('Writing checks')}</Link>
            <Link role="menuitem" to="/how-to-use#mcp">{icon(<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5" />)}{t('Connect AI')}</Link>
            <Link role="menuitem" to="/feedback">{icon(speech)}{t('Feedback')}</Link>
            <hr />
            <button type="button" role="menuitem" onClick={() => logout.mutate()} disabled={logout.isPending}>{icon(<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />)}{logout.isPending ? t('Signing out…') : t('Sign out')}</button>
            {logout.isError && <p role="alert">{t('Could not sign out. Try again.')}</p>}
          </div>}
        </div>}
        <button type="button" className="sh-ghost sh-icon sh-burger" aria-expanded={sheet} aria-controls="site-sheet" aria-label={sheet ? t('Close menu') : t('Open menu')} onClick={() => setSheet(value => !value)}>
          {icon(sheet ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />, 18)}
        </button>
      </div>
    </div>
    {sheet && <div className="sh-sheet" id="site-sheet">
      {!sandbox && <nav aria-label={t('Menu')}>
        {links.map(link => <Link key={link.to} to={link.to} className={link.active ? 'is-active' : ''}>{link.label}</Link>)}
        <Link to="/feedback">{icon(speech)}{t('Feedback')}</Link>
      </nav>}
      {signedOut && signIn('sh-signin-sheet')}
      <p className="sh-label" id="site-sheet-languages">{t('Language')}</p>
      <div className="sh-langs" role="group" aria-labelledby="site-sheet-languages">
        {UI_LANGUAGES.map(option => <button key={option.id} type="button" aria-pressed={option.id === language} onClick={() => choose(option.id)}>{option.label}</button>)}
      </div>
      <p className="sh-label">{t('Theme')}</p>
      <button type="button" className="sh-ghost sh-sheet-theme" onClick={toggle}>{icon(theme === 'dark' ? sun : moon)}{themeLabel}</button>
    </div>}
  </header>
}
