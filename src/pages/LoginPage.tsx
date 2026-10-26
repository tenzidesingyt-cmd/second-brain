import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Loader2, LockKeyhole, Sparkles } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthState } from '../../shared/types'
import { api } from '../lib/api'
import { qk } from '../lib/hooks'
import { Logo, LogoMark } from '../components/Logo'

const AUTH_ERRORS: Record<string, string> = {
  google_not_configured: 'Вход через Google ещё не настроен на сервере.',
  google_state: 'Сессия входа истекла. Попробуйте войти снова.',
  google_denied: 'У этого Google-аккаунта нет доступа к кабинету.',
  google_email: 'Google не подтвердил email. Попробуйте другой аккаунт.',
  google_owner: 'На сервере не задан владелец кабинета. Нужен OWNER_EMAIL.',
  google_failed: 'Не удалось войти через Google. Попробуйте ещё раз.',
}

function readAuthError(): string {
  const code = new URLSearchParams(window.location.search).get('error')
  return code ? AUTH_ERRORS[code] || 'Не удалось войти. Попробуйте ещё раз.' : ''
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.14.76-4.59l-7.97-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
      />
    </svg>
  )
}

export function LoginPage({ auth }: { auth: AuthState }) {
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(readAuthError)
  const queryClient = useQueryClient()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      await api.auth.login(password)
      queryClient.setQueryData(qk.auth, { ...auth, authenticated: true })
      await queryClient.invalidateQueries()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось войти.')
    } finally {
      setLoading(false)
    }
  }

  const subtitle = auth.google_enabled
    ? auth.password_enabled
      ? 'Войди через Google или резервный пароль.'
      : 'Войди через Google, чтобы открыть свой второй мозг.'
    : 'Введи пароль, чтобы открыть свой второй мозг.'

  return (
    <div className="login-shell">
      <aside className="login-visual">
        <div className="login-visual-glow" />
        <div className="login-visual-top">
          <LogoMark size={36} />
          <span className="login-visual-brand">
            второй <em>мозг</em>
          </span>
        </div>

        <div className="login-visual-copy">
          <div className="login-visual-eyebrow">Твой личный кабинет</div>
          <h1>
            Место, где мысли
            <br />
            становятся <em>планами</em>.
          </h1>
          <p>
            Сбрасывай сюда всё — идеи, фото, голосовые и задачи. ИИ разложит по полочкам,
            а синхронизация перенесёт на любое устройство.
          </p>
        </div>

        <div className="orbit" aria-hidden="true">
          <div className="orbit-ring orbit-ring-1" />
          <div className="orbit-ring orbit-ring-2" />
          <div className="orbit-ring orbit-ring-3" />
          <div className="orbit-core">
            <Sparkles size={20} />
          </div>
          <div className="orbit-chip orbit-chip-1">
            <span className="orbit-chip-dot coral" />
            Сдать проект до пятницы
          </div>
          <div className="orbit-chip orbit-chip-2">
            <span className="orbit-chip-dot green" />
            Конспект по истории
          </div>
          <div className="orbit-chip orbit-chip-3">
            <span className="orbit-chip-dot amber" />
            Идея для ролика
          </div>
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-mobile-brand">
          <Logo />
        </div>
        <div className="login-card">
          <div className="login-eyebrow">Личный кабинет</div>
          <h2 className="login-title">С возвращением</h2>
          <p className="login-subtitle">{subtitle}</p>

          {error && <div className="form-error login-error">{error}</div>}

          <div className="login-methods">
            {auth.google_enabled && (
              <a className="btn btn-google btn-block btn-large" href="/api/auth/google">
                <GoogleIcon />
                Войти через Google
              </a>
            )}

            {auth.google_enabled && auth.password_enabled && (
              <div className="login-divider">
                <span>или по паролю</span>
              </div>
            )}

            {auth.password_enabled && (
              <form onSubmit={submit} className="login-form">
                <label className="field">
                  <span className="field-label">Пароль</span>
                  <span className="input-icon-wrap">
                    <LockKeyhole size={17} className="input-icon" />
                    <input
                      className="input input-with-icon input-with-action"
                      type={visible ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      className="input-action"
                      onClick={() => setVisible((current) => !current)}
                      aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
                    >
                      {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                </label>

                <button
                  className="btn btn-primary btn-block btn-large"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={17} />}
                  {loading ? 'Открываю…' : 'Войти в кабинет'}
                </button>
              </form>
            )}
          </div>

          <p className="login-note">
            {auth.google_enabled ? (
              <>
                Доступ только для Google-аккаунта владельца кабинета.
                {auth.password_enabled && (
                  <>
                    {' '}
                    Резервный пароль задаётся в <code>APP_PASSWORD</code>.
                  </>
                )}
              </>
            ) : (
              <>
                Пароль задаётся в переменной <code>APP_PASSWORD</code> на сервере. Если она пуста,
                приложение открывается без пароля.
              </>
            )}
          </p>
        </div>
        <div className="login-footer">Второй мозг · личное пространство</div>
      </main>
    </div>
  )
}
