import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { homeFor } from '../components/auth/RoleRoute'
import Modal from '../components/ui/Modal'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import AuthShell from '../components/auth/AuthShell'

/**
 * Нээлттэй демо (build-ийн үед VITE_DEMO_LOGIN="имэйл:нууц үг").
 * Тохируулаагүй бол юу ч харагдахгүй — энгийн байршуулалтад нөлөөгүй.
 */
const DEMO = (() => {
  const raw = import.meta.env.VITE_DEMO_LOGIN
  if (!raw || !raw.includes(':')) return null
  const i = raw.indexOf(':')
  return { email: raw.slice(0, i), password: raw.slice(i + 1) }
})()

export default function Login() {
  const { user, loading, login } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [company, setCompany] = useState(null)

  function openForgot() {
    setForgotOpen(true)
    if (!company) {
      api('/settings/company')
        .then(setCompany)
        .catch(() => setCompany({}))
    }
  }

  // Session сэргээгдэж дуусаагүй бол хүлээнэ
  if (loading) {
    return (
      <main className="min-h-screen bg-bg text-ink-muted flex items-center justify-center font-mono text-sm">
        {t('ачаалж байна…')}
      </main>
    )
  }

  // Аль хэдийн нэвтэрсэн бол эрхийнхээ нүүр рүү (DRIVER → /deliveries)
  if (user)
    return (
      <Navigate
        to={user.mustChangePassword ? '/change-password' : homeFor(user.role)}
        replace
      />
    )

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const loggedIn = await login(email, password)
      // Түр нууц үгтэй бол эхлээд солиулна (V4-06)
      navigate(
        loggedIn.mustChangePassword
          ? '/change-password'
          : homeFor(loggedIn.role),
        { replace: true },
      )
    } catch (err) {
      setError(err.message ?? 'Алдаа гарлаа')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <div>
        {/* Шилэн карт: доорх хээ бүдгэрч харагдана.
            `backdrop-blur` нь ард талыг нь бүдгэрүүлдэг тул
            хээн дээр ч текст цэвэр уншигдана. */}
        <div className="bg-surface/80 backdrop-blur-lg border border-rule/50 rounded-lg p-8 shadow-2xl shadow-black/40">
          <div className="flex flex-col items-center">
            <img src="/brand/mark-dark.svg" alt="" width="56" height="56" className="h-14 w-14" />
            <h1 className="mt-3 font-brand text-3xl font-bold tracking-tight">Ochir</h1>
          </div>
          <p className="mt-1.5 text-center text-sm text-ink-muted">
            {t('Захиалга, хүргэлтийн систем')}
          </p>

          {DEMO && (
            <div className="mt-6 flex items-center justify-between gap-3 rounded border border-rule bg-bg/60 px-3 py-2.5 text-sm">
              <span>
                <span className="text-ink-muted">Демо: </span>
                <span className="font-mono">
                  {DEMO.email} / {DEMO.password}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setEmail(DEMO.email)
                  setPassword(DEMO.password)
                }}
                className="shrink-0 underline underline-offset-2 text-ink-muted hover:text-ink"
              >
                Бөглөх
              </button>
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5"
              >
                {t('Имэйл')}
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-bg border border-rule rounded px-3 py-2 text-sm focus:outline-none focus:border-ink-muted"
                placeholder="admin@ochir.mn"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5"
              >
                {t('Нууц үг')}
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-bg border border-rule rounded px-3 py-2 text-sm focus:outline-none focus:border-ink-muted"
              />
            </div>

            {error && (
              <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-ink text-bg rounded py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center justify-center gap-2"
            >
              {submitting && (
                <span className="inline-block w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
              )}
              {submitting ? t('Нэвтэрч байна…') : t('Нэвтрэх')}
            </button>
          </form>

          <p className="mt-2 text-center text-sm">
            <button
              type="button"
              onClick={openForgot}
              className="text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              {t('Нууц үг мартсан?')}
            </button>
          </p>
        </div>
      </div>

      <Modal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title={t('Нууц үг мартсан?')}
      >
        <p className="text-sm">
          {t(
            'Админд хандаж түр нууц үг авна уу. Түр нууц үгээр нэвтэрсний дараа шинэ нууц үгээ зохионо.',
          )}
        </p>
        {company?.companyPhone && (
          <p className="mt-3 text-sm text-ink-muted">
            {t('Холбогдох утас')}:{' '}
            <span className="font-mono text-ink">{company.companyPhone}</span>
          </p>
        )}
      </Modal>
    </AuthShell>
  )
}
