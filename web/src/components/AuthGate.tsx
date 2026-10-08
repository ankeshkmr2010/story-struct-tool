import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Link } from 'react-router-dom'

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void
      renderButton: (element: HTMLElement, options: { theme: string; size: string; text: string }) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false })
  const config = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig, enabled: me.isError })
  const buttonRef = useRef<HTMLDivElement>(null)
  const [scriptError, setScriptError] = useState(false)
  const login = useMutation({
    mutationFn: api.googleLogin,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const loginRef = useRef(login.mutate)
  useEffect(() => { loginRef.current = login.mutate }, [login.mutate])

  const clientId = config.data?.google_client_id
  useEffect(() => {
    if (!clientId) return
    const render = () => {
      if (!window.google || !buttonRef.current) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => loginRef.current(credential),
      })
      buttonRef.current.replaceChildren()
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline', size: 'large', text: 'signin_with',
      })
    }
    if (window.google) { render(); return }

    const script = document.getElementById('google-identity-script') as HTMLScriptElement | null
      ?? document.createElement('script')
    if (!script.id) {
      script.id = 'google-identity-script'
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', render)
    const failed = () => setScriptError(true)
    script.addEventListener('error', failed)
    return () => {
      script.removeEventListener('load', render)
      script.removeEventListener('error', failed)
    }
  }, [clientId])

  if (me.isPending) return <p className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading your account…</p>
  if (me.data) return children

  return (
    <main className="flex min-h-[calc(100dvh-73px)] items-center justify-center bg-slate-50 dark:bg-slate-950 p-5">
      <section className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">StoryTool</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Sign in with Google to open your stories.</p>
        <Link to="/how-to-use" className="mt-3 inline-block text-sm text-slate-600 dark:text-slate-300 underline underline-offset-4 hover:text-slate-900 dark:hover:text-slate-100">New here? Learn how StoryTool works</Link>
        {config.isPending && <p className="mt-6 text-sm text-slate-400">Preparing sign-in…</p>}
        {clientId && <div ref={buttonRef} className="mt-6 min-h-10" />}
        {config.data && !clientId && <p className="mt-6 text-sm text-amber-700 dark:text-amber-300">Google sign-in is being configured.</p>}
        {(config.isError || scriptError || login.isError) && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-300">
            {login.isError ? 'Sign-in failed. Please try again.' : 'Google sign-in is unavailable right now.'}
          </p>
        )}
      </section>
    </main>
  )
}

export function AccountMenu() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.currentUser, retry: false })
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => window.location.assign('/'),
  })

  if (!me.data) return null
  return (
    <div className="account-menu flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span className="account-name max-w-48 truncate" title={me.data.email}>{me.data.name ?? me.data.email}</span>
      <Link to="/settings" className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950">Settings</Link>
      <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-950 disabled:opacity-50">
        Sign out
      </button>
    </div>
  )
}
