import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  CalendarDays,
  Inbox,
  ListChecks,
  Moon,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react'
import { Logo, LogoMark } from './Logo'
import { SearchPalette } from './SearchPalette'
import { useAiSettings, useInbox } from '../lib/hooks'
import { useRealtime } from '../hooks/useRealtime'
import { useTheme } from '../context/ThemeContext'
import { formatFullDate } from '../lib/date'

const NAV_ITEMS = [
  { to: '/inbox', label: 'Инбокс', icon: Inbox },
  { to: '/notes', label: 'Заметки', icon: NotebookPen },
  { to: '/tasks', label: 'Задачи', icon: ListChecks },
  { to: '/calendar', label: 'Календарь', icon: CalendarDays },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3 },
]

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const { theme, toggleTheme } = useTheme()
  const connected = useRealtime(true)
  const ai = useAiSettings()
  const inbox = useInbox()
  const isEditor = /^\/notes\/[^/]+$/.test(location.pathname)

  const attentionCount = useMemo(
    () =>
      (inbox.data || []).filter(
        (item) => item.status === 'new' || item.status === 'processing' || item.status === 'failed',
      ).length,
    [inbox.data],
  )

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [location.pathname])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
        return
      }
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        navigate('/inbox?new=1')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  const aiReady = Boolean(ai.data?.configured)

  return (
    <div className={`app-shell ${isEditor ? 'editor-mode' : ''}`}>
      <aside className="sidebar">
        <NavLink to="/inbox" className="sidebar-brand">
          <Logo />
        </NavLink>

        <button
          className="capture-cta"
          onClick={() => navigate('/inbox?new=1')}
          title="Новая запись (N)"
        >
          <span className="capture-cta-icon">
            <Plus size={18} />
          </span>
          <span>Новая запись</span>
          <kbd>N</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="Основная навигация">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
              >
                <Icon size={19} strokeWidth={1.9} />
                <span>{item.label}</span>
                {item.to === '/inbox' && attentionCount > 0 && (
                  <span className="nav-count">{attentionCount}</span>
                )}
              </NavLink>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <NavLink to="/settings" className={`sidebar-ai ${aiReady ? 'is-ready' : ''}`}>
            <span className="sidebar-ai-orb">
              <Sparkles size={16} />
            </span>
            <span className="sidebar-ai-copy">
              <strong>{aiReady ? 'ИИ на связи' : 'Подключить ИИ'}</strong>
              <small>{aiReady ? ai.data?.text_model : 'OpenRouter · 1 минута'}</small>
            </span>
          </NavLink>

          <div className="sidebar-utility">
            <NavLink to="/settings" className="sidebar-utility-link">
              <Settings size={17} />
              <span>Настройки</span>
            </NavLink>
            <button
              className="icon-btn sidebar-theme"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>

          <div className="sidebar-sync">
            <span className={`sync-dot ${connected ? 'is-live' : ''}`} />
            <span>{connected ? 'Синхронизировано' : 'Нет соединения'}</span>
            <span className="sidebar-version">v1.0</span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="mobile-header">
          <NavLink to="/inbox" className="mobile-brand">
            <LogoMark size={30} />
            <span className="mobile-wordmark">
              второй <em>мозг</em>
            </span>
          </NavLink>
          <div className="mobile-actions">
            <button
              className="icon-btn"
              onClick={() => setSearchOpen(true)}
              aria-label="Поиск"
            >
              <Search size={19} />
            </button>
            <NavLink to="/settings" className="icon-btn" aria-label="Настройки">
              <Settings size={19} />
            </NavLink>
          </div>
        </header>

        <header className="desktop-topbar">
          <div className="topbar-date">{formatFullDate(new Date())}</div>
          <div className="topbar-actions">
            <button className="search-pill" onClick={() => setSearchOpen(true)}>
              <Search size={16} />
              <span>Поиск по всему</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className={`sync-chip ${connected ? 'is-live' : ''}`}>
              <span className="sync-dot" />
              <span>{connected ? 'Синхронизировано' : 'Нет связи'}</span>
            </div>
          </div>
        </header>

        <main className="page-shell">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Навигация">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `bottom-nav-item ${isActive ? 'is-active' : ''}`}
            >
              <span className="bottom-nav-icon">
                <Icon size={21} strokeWidth={1.9} />
                {item.to === '/inbox' && attentionCount > 0 && <span className="bottom-nav-dot" />}
              </span>
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
