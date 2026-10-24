import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react'

/** Languages the app's own interface is offered in. English is the source text: every
 * `t()` call is written in English and other languages look that text up. */
export const UI_LANGUAGES = [
  { id: 'en', label: 'English', flag: 'gb' },
  { id: 'fr', label: 'Français', flag: 'fr' },
  { id: 'de', label: 'Deutsch', flag: 'de' },
  { id: 'es', label: 'Español', flag: 'es' },
  { id: 'pt-BR', label: 'Português', flag: 'br' },
  { id: 'it', label: 'Italiano', flag: 'it' },
] as const

export type UiLanguage = (typeof UI_LANGUAGES)[number]['id']

const STORAGE_KEY = 'storytool-ui-language'
const loaders = import.meta.glob<{ default: Record<string, string> }>('./locales/*.json')

let language: UiLanguage = 'en'
let dictionary: Record<string, string> = {}
const listeners = new Set<() => void>()

type Plain = string | number | boolean | null | undefined

/** The interface text in the chosen language. `{0}`, `{1}`… are filled from `args`. A text with
 * no translation stays in English. With an element among the args (a link, a list) the result
 * is a fragment rather than a string. */
export function t(text: string, ...args: Plain[]): string
export function t(text: string, ...args: ReactNode[]): ReactNode
export function t(text: string, ...args: ReactNode[]): ReactNode {
  const template = dictionary[text] ?? text
  if (!args.length) return template
  const fill = (value: ReactNode) => value === null || value === undefined || typeof value === 'boolean' ? '' : value
  if (args.every(arg => typeof arg !== 'object' || arg === null)) {
    return template.replace(/\{(\d+)\}/g, (match, index) => (Number(index) < args.length ? String(fill(args[Number(index)])) : match))
  }
  const parts = template.split(/\{(\d+)\}/).map((part, index) => (index % 2 ? fill(args[Number(part)]) : part))
  return createElement(Fragment, null, ...parts)
}

/** Marks interface text kept in a module-level constant: returns it unchanged so the key is
 * collected for translation, and the place that shows it calls `t(value)`. */
export const tx = (text: string): string => text

export const isUiLanguage =(value: unknown): value is UiLanguage => UI_LANGUAGES.some(option => option.id === value)

export function storedUiLanguage(): UiLanguage | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isUiLanguage(value) ? value : null
  } catch {
    return null
  }
}

export const getUiLanguage = () => language

/** Load a language and re-render the app in it. The choice is kept in this browser. */
export async function setUiLanguage(next: UiLanguage): Promise<void> {
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* The choice still applies until reload. */ }
  await applyUiLanguage(next)
}

async function applyUiLanguage(next: UiLanguage): Promise<void> {
  const loaded = next === 'en' ? {} : (await loaders[`./locales/${next}.json`]?.())?.default ?? {}
  language = next
  dictionary = loaded
  document.documentElement.lang = next
  listeners.forEach(listener => listener())
}

/** Before the first render, so the page opens in the remembered language. */
export const initUiLanguage = () => applyUiLanguage(storedUiLanguage() ?? 'en').catch(() => {})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The current interface language; a component using it re-renders when it changes. */
export const useUiLanguage = () => useSyncExternalStore(subscribe, getUiLanguage)
