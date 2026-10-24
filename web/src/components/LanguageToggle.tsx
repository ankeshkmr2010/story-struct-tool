import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { isUiLanguage, setUiLanguage, storedUiLanguage, t, UI_LANGUAGES, useUiLanguage, type UiLanguage } from '../i18n'

/** Small flags drawn inline: Windows shows flag emoji as two letters. */
function Flag({ code }: { code: string }) {
  const stripes = (colours: string[], vertical: boolean) => colours.map((fill, index) => vertical
    ? <rect key={index} x={(index * 30) / colours.length} y="0" width={30 / colours.length} height="20" fill={fill} />
    : <rect key={index} x="0" y={(index * 20) / colours.length} width="30" height={20 / colours.length} fill={fill} />)
  return <svg className="language-flag" viewBox="0 0 30 20" aria-hidden="true">
    {code === 'gb' && <>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
      <path d="M0 0L30 20M30 0L0 20" stroke="#C8102E" strokeWidth="1.5" />
      <path d="M15 0V20M0 10H30" stroke="#fff" strokeWidth="6" />
      <path d="M15 0V20M0 10H30" stroke="#C8102E" strokeWidth="3.5" />
    </>}
    {code === 'fr' && stripes(['#002395', '#ffffff', '#ED2939'], true)}
    {code === 'it' && stripes(['#009246', '#ffffff', '#CE2B37'], true)}
    {code === 'de' && stripes(['#000000', '#DD0000', '#FFCE00'], false)}
    {code === 'es' && <><rect width="30" height="20" fill="#AA151B" /><rect y="5" width="30" height="10" fill="#F1BF00" /></>}
    {code === 'br' && <>
      <rect width="30" height="20" fill="#009C3B" />
      <path d="M15 2.5L27 10L15 17.5L3 10Z" fill="#FFDF00" />
      <circle cx="15" cy="10" r="4.2" fill="#002776" />
    </>}
  </svg>
}

/** Interface language, beside the theme toggle. Kept in this browser and, when signed in, on
 * the account so it follows the author to other devices. */
export function LanguageToggle({ signedIn = true }: { signedIn?: boolean }) {
  const language = useUiLanguage()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false, enabled: signedIn })
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = UI_LANGUAGES.find(option => option.id === language) ?? UI_LANGUAGES[0]

  // The account's choice wins once signed in; an account without one takes this browser's.
  const saved = me.data?.ui_language
  useEffect(() => {
    if (!me.data) return
    if (isUiLanguage(saved)) {
      if (saved !== language) void setUiLanguage(saved)
    } else if (storedUiLanguage()) {
      void api.saveProfile({ ui_language: language }).then(user => qc.setQueryData(['me'], user)).catch(() => {})
    }
    // Only when the account loads or changes: picking a language below saves it itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data?.id, saved])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])

  const choose = (next: UiLanguage) => {
    setOpen(false)
    void setUiLanguage(next)
    if (me.data) void api.saveProfile({ ui_language: next }).then(user => qc.setQueryData(['me'], user)).catch(() => {})
  }

  return <div className="language-toggle" ref={box}>
    <button type="button" className="theme-toggle" aria-haspopup="menu" aria-expanded={open} aria-label={t('Interface language: {0}', current.label)} onClick={() => setOpen(value => !value)}>
      <Flag code={current.flag} />
      <span>{current.label}</span>
    </button>
    {open && <div className="language-menu" role="menu">
      {UI_LANGUAGES.map(option => <button key={option.id} type="button" role="menuitemradio" aria-checked={option.id === language} className={option.id === language ? 'is-active' : ''} onClick={() => choose(option.id)}>
        <Flag code={option.flag} />{option.label}
      </button>)}
    </div>}
  </div>
}
