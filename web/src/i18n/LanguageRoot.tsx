import type { ReactNode } from 'react'
import { useUiLanguage } from '.'

/** Changing the interface language re-renders the whole app (nothing is memoised), so every
 * t() call reads the new language without remounting or losing state. */
export function LanguageRoot({ render }: { render: () => ReactNode }) {
  useUiLanguage()
  return render()
}
