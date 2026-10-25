import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Loader2, LockKeyhole, Sparkles } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { qk } from '../lib/hooks'
import { Logo, LogoMark } from '../components/Logo'

export function LoginPage() {
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      await api.auth.login(password)
      queryClient.setQueryData(qk.auth, { auth_required: true, authenticated: true })
      await queryClient.invalidateQueries()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось войти.')
    } finally {
      setLoading(false)
    }
  }

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
          <p className="login-subtitle">
            Введи пароль, чтобы открыть свой второй мозг.
          </p>

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

            {error && <div className="form-error">{error}</div>}

            <button className="btn btn-primary btn-block btn-large" type="submit" disabled={loading}>
              {loading ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={17} />}
              {loading ? 'Открываю…' : 'Войти в кабинет'}
            </button>
          </form>

          <p className="login-note">
            Пароль задаётся в переменной <code>APP_PASSWORD</code> на сервере. Если она пуста,
            приложение открывается без пароля.
          </p>
        </div>
        <div className="login-footer">Второй мозг · личное пространство</div>
      </main>
    </div>
  )
}
