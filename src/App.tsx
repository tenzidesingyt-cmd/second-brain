import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api, UNAUTHORIZED_EVENT } from './lib/api'
import { qk } from './lib/hooks'
import { Logo, LogoMark } from './components/Logo'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/LoginPage'
import { InboxPage } from './pages/InboxPage'
import { NotesPage } from './pages/NotesPage'
import { NoteEditorPage } from './pages/NoteEditorPage'
import { TasksPage } from './pages/TasksPage'
import { CalendarPage } from './pages/CalendarPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { SettingsPage } from './pages/SettingsPage'
import { useToast } from './context/ToastContext'

function Splash() {
  return (
    <div className="splash">
      <div className="splash-glow" />
      <Logo />
      <div className="splash-loading">
        <span className="splash-line" />
      </div>
      <p className="splash-caption">Собираю мысли в одном месте…</p>
    </div>
  )
}

function BootError({ onRetry, message }: { onRetry: () => void; message: string }) {
  return (
    <div className="splash">
      <div className="boot-error-card">
        <LogoMark size={44} />
        <h1>Не удалось запустить приложение</h1>
        <p>{message}</p>
        <button className="btn btn-primary" onClick={onRetry}>
          <RefreshCw size={16} /> Попробовать снова
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const auth = useQuery({
    queryKey: qk.auth,
    queryFn: () => api.auth.me(),
    retry: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    const onUnauthorized = () => {
      showToast('Сессия истекла. Войди снова.', 'error')
      void queryClient.invalidateQueries({ queryKey: qk.auth })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [queryClient, showToast])

  if (auth.isPending) return <Splash />
  if (auth.isError) {
    return (
      <BootError
        onRetry={() => auth.refetch()}
        message={auth.error instanceof Error ? auth.error.message : 'Сервер не отвечает.'}
      />
    )
  }
  if (auth.data?.auth_required && !auth.data.authenticated) {
    return <LoginPage />
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:id" element={<NoteEditorPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Route>
    </Routes>
  )
}
