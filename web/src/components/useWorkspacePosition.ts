import { useCallback, useEffect, useRef } from 'react'
import { api, type WorkspacePlace } from '../api/client'

type Navigation = Pick<WorkspacePlace, 'mode' | 'level' | 'chapter_id' | 'scene_id'>
const fraction = (value: number) => Math.max(0, Math.min(1, value))
function documentPosition(storyId: string, mode: WorkspacePlace['mode']): Partial<WorkspacePlace> {
  if (mode === 'read' || !document.querySelector(`[data-workspace-story="${storyId}"]`)) return {}
  const patch: Partial<WorkspacePlace> = { scroll_fraction: fraction(window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) }
  if (mode === 'write') {
    const scenes = Array.from(document.querySelectorAll<HTMLElement>('[data-writing-scene]'))
    const target = scenes.find(element => { const rect = element.getBoundingClientRect(); return rect.bottom > 100 && rect.top < window.innerHeight })
    if (target) { patch.write_scene_id = target.dataset.writingScene; patch.write_within = fraction((100 - target.getBoundingClientRect().top) / Math.max(1, target.offsetHeight)) }
  }
  return patch
}

/** Navigation only: never stores prose or restores over an explicit passage link. */
export function useWorkspacePosition(storyId: string, initial: WorkspacePlace | null | undefined, navigation: Navigation, enabled: boolean, explicitTarget: boolean) {
  const current = useRef<WorkspacePlace>({ ...initial, ...navigation })
  const navigationRef = useRef(navigation)
  useEffect(() => { navigationRef.current = navigation }, [navigation])
  const pending = useRef(false)
  const saving = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const restored = useRef(!initial || explicitTarget)
  const send = useCallback(async () => {
    if (!enabled || !pending.current || saving.current) return
    saving.current = true
    try {
      while (pending.current) {
        pending.current = false
        current.current = { ...current.current, ...documentPosition(storyId, current.current.mode) }
        try { await api.saveWorkspacePosition(storyId, { ...current.current }) }
        catch { pending.current = true; break }
      }
    }
    finally { saving.current = false }
  }, [storyId, enabled])
  const schedule = useCallback(() => {
    if (!enabled || !restored.current || document.visibilityState !== 'visible' || !document.hasFocus()) return
    pending.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { void send() }, 1000)
  }, [enabled, send])
  const update = useCallback((patch: Partial<WorkspacePlace>) => {
    if (patch.write_chapter_id && patch.write_chapter_id !== current.current.write_chapter_id) patch = { ...patch, write_scene_id: null, write_within: 0 }
    current.current = { ...current.current, ...patch, ...navigationRef.current }
    schedule()
  }, [schedule])

  useEffect(() => {
    const previous = current.current
    current.current = { ...previous, ...navigation }
    if (previous.mode !== navigation.mode || previous.level !== navigation.level || previous.chapter_id !== navigation.chapter_id || previous.scene_id !== navigation.scene_id) schedule()
  }, [navigation, schedule])

  useEffect(() => {
    if (restored.current || !enabled || !initial || initial.mode === 'read') { restored.current = true; return }
    let stopped = false
    const stopRestore = () => { restored.current = true }
    window.addEventListener('wheel', stopRestore, { passive: true })
    window.addEventListener('touchstart', stopRestore, { passive: true })
    window.addEventListener('keydown', stopRestore)
    window.addEventListener('pointerdown', stopRestore)
    const restore = () => {
      if (stopped || restored.current) return
      if (initial.mode === 'write') {
        const scenes = Array.from(document.querySelectorAll<HTMLElement>('[data-writing-scene]'))
        const target = scenes.find(element => element.dataset.writingScene === initial.write_scene_id)
        if (target && target.querySelector('.cm-editor')) {
          window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top + (initial.write_within ?? 0) * target.offsetHeight - 100)
          restored.current = true
        }
      } else if (document.querySelector('[data-workspace-ready]')) {
        window.scrollTo(0, (initial.scroll_fraction ?? 0) * Math.max(0, document.documentElement.scrollHeight - window.innerHeight))
        restored.current = true
      }
    }
    // Deleted passages or changed outlines have a safe document-position fallback. It waits until
    // the content has loaded and stopped changing, so a slow load cannot scroll a half-built page.
    let fallback: ReturnType<typeof setTimeout> | undefined
    const fallBack = () => {
      if (!restored.current && !stopped) {
        window.scrollTo(0, (initial.scroll_fraction ?? 0) * Math.max(0, document.documentElement.scrollHeight - window.innerHeight))
        restored.current = true
      }
      observer.disconnect()
    }
    const loaded = () => !!document.querySelector('[data-workspace-ready]') && (initial.mode !== 'write' || !!document.querySelector('[data-writing-scene] .cm-editor'))
    const armFallback = () => { if (loaded()) { clearTimeout(fallback); fallback = setTimeout(fallBack, 1500) } }
    const observer = new MutationObserver(() => { restore(); if (!restored.current) armFallback() })
    observer.observe(document.body, { childList: true, subtree: true })
    void document.fonts.ready.then(() => { if (!stopped) requestAnimationFrame(restore) })
    armFallback()
    const deadline = setTimeout(fallBack, 30000)
    return () => {
      stopped = true; observer.disconnect(); clearTimeout(fallback); clearTimeout(deadline)
      window.removeEventListener('wheel', stopRestore); window.removeEventListener('touchstart', stopRestore); window.removeEventListener('keydown', stopRestore)
      window.removeEventListener('pointerdown', stopRestore)
    }
  }, [storyId, initial, enabled])

  useEffect(() => {
    if (!enabled) return
    const capture = () => {
      if (!restored.current || document.visibilityState !== 'visible' || !document.hasFocus()) return
      const mode = navigationRef.current.mode
      if (mode === 'read') return
      update(documentPosition(storyId, mode))
    }
    const flush = () => { clearTimeout(timer.current); void send() }
    const visibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('scroll', capture, { passive: true })
    window.addEventListener('focus', capture)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', visibility)
    const retry = setInterval(() => { if (document.visibilityState === 'visible' && document.hasFocus()) void send() }, 5000)
    return () => {
      window.removeEventListener('scroll', capture); window.removeEventListener('focus', capture); window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', visibility); clearInterval(retry); flush()
    }
  }, [storyId, enabled, update, send])
  return update
}
