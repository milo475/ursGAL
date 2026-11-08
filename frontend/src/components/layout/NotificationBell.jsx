import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bell } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LanguageContext'
import { api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'

/** Мэдэгдэл дарахад очих хуудас — refType/refId + эрхээс хамаарна */
export function notifTarget(n, role) {
  // Харилцагч (нийлүүлэгч) дотоод хуудсанд хүрэхгүй — бага үлдэгдлийн
  // мэдэгдэл нь өөрийнх нь самбар руу очно
  if (role === 'OPERATOR') return '/'
  if (n.refType === 'order' && n.refId) {
    return role === 'DRIVER' ? '/deliveries' : `/orders/${n.refId}`
  }
  if (n.refType === 'order-request') return '/order-requests'
  if (n.refType === 'product') return '/products'
  if (n.refType === 'supply') return '/supplies'
  if (n.refType === 'payout') return '/finance/payroll'
  return '/notifications'
}

/** Уншсан болгоод AppShell-ийн badge-ийг шинэчилнэ */
export function markReadAndRefresh(n) {
  if (n.isRead) return Promise.resolve()
  return api(`/notifications/${n.id}/read`, { method: 'PATCH' })
    .then(() => window.dispatchEvent(new Event('notif:refresh')))
    .catch(() => {})
}

export default function NotificationBell({ unread }) {
  const { user } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(null)
  const boxRef = useRef(null)

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  /**
   * Хонх дарж НЭЭХЭД мэдэгдлүүд уншсан болно (V5).
   *
   * Өмнө нь мэдэгдлээ хараад ч хонхны улаан тоо хэвээр үлдэж,
   * шинэ зүйл ирсэн эсэхийг ялгах боломжгүй болдог байв.
   *
   * Жагсаалт нь ЭНЭ УДААД шинэ тэмдэглэгээгээ хадгална (дахин
   * ачаалахгүй) — хэрэглэгч юу шинэ болохыг харсаар байна, зөвхөн
   * тоо нь тэглэгдэнэ.
   */
  function toggle() {
    if (!open) {
      setItems(null)
      api('/notifications?limit=10')
        .then((d) => {
          setItems(d.items)
          if (d.items.some((n) => !n.isRead)) {
            api('/notifications/read-all', { method: 'POST' })
              .then(() => window.dispatchEvent(new Event('notif:refresh')))
              .catch(() => {})
          }
        })
        .catch(() => setItems([]))
    }
    setOpen((o) => !o)
  }

  function onPick(n) {
    setOpen(false)
    void markReadAndRefresh(n)
    navigate(notifTarget(n, user?.role))
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={t('Мэдэгдэл')}
        className="relative p-1.5 text-ink-muted hover:text-ink transition-colors"
      >
        {/* Mobile (driver) дээр том, desktop-д жижиг */}
        <Bell className="size-[22px] md:size-[18px]" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-alarm text-bg font-mono text-[10px] leading-4 text-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[85vw] bg-surface border border-rule rounded shadow-lg z-50">
          <p className="px-3 py-2 text-xs uppercase tracking-wide text-ink-muted border-b border-rule">
            {t('Мэдэгдэл')}
          </p>
          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <p className="px-3 py-4 text-sm text-ink-muted">…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-muted">
                {t('Мэдэгдэл алга')}
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onPick(n)}
                  className="w-full text-left px-3 py-2.5 border-b border-rule last:border-b-0 hover:bg-bg transition-colors"
                >
                  <span className="flex items-start gap-2">
                    {!n.isRead && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-accent shrink-0" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span
                        className={`block text-sm truncate ${
                          n.isRead ? 'text-ink-muted' : 'font-medium'
                        }`}
                      >
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="block text-xs text-ink-muted truncate">
                          {/* Олон мөрт биетэй мэдэгдэлд (ORDER_RELEASED)
                              хонх дээр эхний мөр нь л багтана */}
                          {n.body.split('\n')[0]}
                        </span>
                      )}
                      <span className="block font-mono text-[10px] text-ink-muted tabular-nums mt-0.5">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              navigate('/notifications')
            }}
            className="w-full px-3 py-2 text-sm text-accent-text border-t border-rule hover:bg-bg transition-colors text-center"
          >
            {t('Бүгдийг харах')}
          </button>
        </div>
      )}
    </div>
  )
}
