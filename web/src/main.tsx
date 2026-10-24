import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initUiLanguage } from './i18n'
import { LanguageRoot } from './i18n/LanguageRoot'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Structural data changes only when the author changes it; no need to refetch
      // on every window focus.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

void initUiLanguage().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <LanguageRoot render={() => <App />} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
))
