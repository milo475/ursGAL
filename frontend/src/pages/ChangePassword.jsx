import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { homeFor } from '../components/auth/RoleRoute'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import AuthShell from '../components/auth/AuthShell'

/**
 * Түр нууц үгээр нэвтэрсэн хэрэглэгчийн заавал солих дэлгэц (V4-06).
 * Солитол ProtectedRoute бусад хуудас руу оруулахгүй, backend бүх API-д 403.
 */
export default function ChangePassword() {
  const { user, loading, applyAuth } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <main className="min-h-screen bg-bg text-ink-muted flex items-center justify-center font-mono text-sm">
        {t('ачаалж байна…')}
      </main>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  async function onSubmit(e) {
    e.preventDefault()
    if (newPassword !== confirm) {
      setError(t('Нууц үг таарахгүй байна'))
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const data = await api('/auth/change-password', {
        method: 'POST',
        body: { oldPassword, newPassword },
      })
      applyAuth(data)
      navigate(homeFor(data.user.role), { replace: true })
    } catch (err) {
      setError(err.message ?? 'Алдаа гарлаа')
    } finally {
      setSubmitting(false)
    }
  }

  const field = (id, label, value, onChange, autoComplete) => (
    <div>
      <label
        htmlFor={id}
        className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        minLength={id === 'cp-old' ? undefined : 6}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        className="w-full bg-bg border border-rule rounded px-3 py-2 text-sm focus:outline-none focus:border-ink-muted"
      />
    </div>
  )

  return (
    <AuthShell>
      <div>
        {/* Шилэн карт: доорх зураг бүдгэрч харагдана (V5).
            `backdrop-blur` нь ард талыг нь бүдгэрүүлдэг тул
            зураг дээр ч текст цэвэр уншигдана. */}
        <div className="bg-surface/80 backdrop-blur-lg border border-rule/50 rounded-lg p-8 shadow-2xl shadow-black/40">
          <h1 className="font-serif text-3xl font-medium text-center">
            {t('Шинэ нууц үг зохиох')}
          </h1>
          <p className="mt-2 text-center text-sm text-ink-muted">
            {t('Түр нууц үгээ сольсны дараа систем нээгдэнэ')}
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {field(
              'cp-old',
              t('Түр (хуучин) нууц үг'),
              oldPassword,
              (e) => setOldPassword(e.target.value),
              'current-password',
            )}
            {field(
              'cp-new',
              t('Шинэ нууц үг'),
              newPassword,
              (e) => setNewPassword(e.target.value),
              'new-password',
            )}
            {field(
              'cp-confirm',
              t('Нууц үг давтах'),
              confirm,
              (e) => setConfirm(e.target.value),
              'new-password',
            )}

            {error && (
              <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-ink text-bg rounded py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {submitting ? t('Хадгалж байна…') : t('Нууц үг солих')}
            </button>
          </form>
        </div>
      </div>
    </AuthShell>
  )
}
