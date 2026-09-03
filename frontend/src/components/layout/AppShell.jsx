import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import {
  Bell,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Settings,
  X,
} from 'lucide-react'
import ConfirmDialog from '../ui/ConfirmDialog'
import { mobileTabsFor, navFor } from '../../config/nav'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LanguageContext'
import { API_BASE, api, getAccessToken } from '../../lib/api'
import { initOfflineQueue } from '../../lib/offlineQueue'
import NotificationBell from './NotificationBell'
import ThemeToggle from './ThemeToggle'

const ROLE_LABELS = {
  ADMIN: 'Админ',
  MANAGER: 'Менежер',
  OPERATOR: 'Харилцагч', // бараа нийлүүлдэг түнш — захиалга шивэх эрхтэй
  DRIVER: 'Жолооч',
  WAREHOUSE: 'Нярав',
  SELLER: 'Борлуулагч',
}

/**
 * Layout: зүүн талд эвхэгддэг sidebar (md+), дээд талд нимгэн topbar,
 * mobile дээр sidebar-ын оронд доод tab bar (жолоочийн mobile-first хэвээр).
 */
export default function AppShell() {
  const { user, logout, hasPerm } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('ursgal.sidebar') === '1',
  )

  // Эрхийн accent тема: root дээр data-role
  useEffect(() => {
    if (user) {
      document.documentElement.dataset.role = user.role.toLowerCase()
    }
    return () => {
      delete document.documentElement.dataset.role
    }
  }, [user])

  const items = navFor(user, hasPerm)

  // Уншаагүй мэдэгдлийн тоо — 30 сек тутам + read үйлдлийн дараа event-ээр
  const [unread, setUnread] = useState(0)
  const refreshUnread = useCallback(() => {
    api('/notifications/unread-count')
      .then((d) => setUnread(d.count))
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!user) return
    refreshUnread()
    const id = setInterval(refreshUnread, 30_000)
    window.addEventListener('notif:refresh', refreshUnread)
    return () => {
      clearInterval(id)
      window.removeEventListener('notif:refresh', refreshUnread)
    }
  }, [user, refreshUnread])

  // Offline индикатор + илгээгдээгүй дарааллын автомат илгээлт (V4-10)
  const [offline, setOffline] = useState(!navigator.onLine)
  useEffect(() => {
    if (!user) return
    initOfflineQueue()
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [user])

  // SSE (V4-09): мэдэгдэл ирмэгц badge шууд шинэчлэгдэнэ.
  // Тасарвал 5с тутам дахин холбогдоно; дээрх 30с poll fallback хэвээр.
  useEffect(() => {
    if (!user) return
    let es = null
    let retry = null
    let stopped = false

    /**
     * Stream-д ACCESS TOKEN биш богино насжилттай ТАСАЛБАР явна (V5):
     * access token URL-д орвол сервер/proxy-ийн логт үлдэж болзошгүй
     * байв. Тасалбар 60 сек амьдардаг, зөвхөн stream нээж чадна.
     */
    const connect = async () => {
      const token = getAccessToken()
      if (!token) {
        retry = setTimeout(connect, 5000)
        return
      }
      let ticket
      try {
        ;({ ticket } = await api('/notifications/stream-ticket'))
      } catch {
        if (!stopped) retry = setTimeout(connect, 5000)
        return
      }
      if (stopped) return
      es = new EventSource(
        `${API_BASE}/notifications/stream?ticket=${encodeURIComponent(ticket)}`,
      )
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          if (d.type === 'notification') {
            setUnread(d.unreadCount)
            // Нээлттэй хуудсууд (Миний хүргэлт г.м.) шууд шинэчлэгдэнэ
            window.dispatchEvent(new Event('notif:push'))
          }
        } catch {
          /* ping */
        }
      }
      es.onerror = () => {
        es?.close()
        if (!stopped) retry = setTimeout(connect, 5000)
      }
    }
    connect()
    return () => {
      stopped = true
      es?.close()
      clearTimeout(retry)
    }
  }, [user])

  function toggleSidebar() {
    setCollapsed((c) => {
      localStorage.setItem('ursgal.sidebar', c ? '0' : '1')
      return !c
    })
  }

  // Санамсаргүй дарж гарахаас хамгаална — эхлээд баталгаажуулна
  const [logoutOpen, setLogoutOpen] = useState(false)
  /** Mobile-ийн бүрэн цэс. Доод бар нь 4-өөс олон зүйлийг багтаадаггүй */
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // Цэс нээлттэй үед ард нь гүйлгэхгүй
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  function handleLogout() {
    setLogoutOpen(false)
    logout()
    navigate('/login')
  }

  const sideLink = ({ isActive }) =>
    [
      'flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors',
      collapsed ? 'justify-center px-2' : '',
      isActive
        ? 'text-accent bg-accent/10 font-medium'
        : 'text-ink-muted hover:text-ink hover:bg-surface',
    ].join(' ')

  const tabLink = ({ isActive }) =>
    [
      'flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[10px] leading-tight transition-colors',
      isActive ? 'text-accent' : 'text-ink-muted',
    ].join(' ')

  /**
   * Доод tab bar-т ЗӨВХӨН эхний цөөн зүйл орно (nav.js-ийн дараалал нь
   * чухлаараа). Админд 13 цэс байдаг тул бүгдийг нэг мөрөнд шахахад
   * бичвэр нь давхарлаж, дэлгэцнээс гардаг байв — үлдсэнийг «Цэс»
   * товчоор нээгддэг бүрэн жагсаалтад өгнө.
   */
  const MAX_TABS = 4
  const isDriver = user?.role === 'DRIVER'
  const tabItems = mobileTabsFor(user, items, MAX_TABS)
  const needsMore = items.length > tabItems.length

  return (
    <div className="min-h-screen bg-bg text-ink flex">
      {/* ── Sidebar (md+) ── */}
      <aside
        className={`hidden md:flex flex-col border-r border-rule shrink-0 transition-[width] duration-200 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <nav className="flex-1 overflow-y-auto p-2 space-y-1 mt-2">
          {items.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.end}
              className={sideLink}
              title={collapsed ? t(item.label) : undefined}
            >
              <item.icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{t(item.label)}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Доод хэсэг: тохиргоо + хэрэглэгч + гарах */}
        <div className="border-t border-rule p-2 space-y-1">
          <NavLink
            to="/settings"
            className={sideLink}
            title={collapsed ? t('Тохиргоо') : undefined}
          >
            <Settings size={18} className="shrink-0" />
            {!collapsed && <span>{t('Тохиргоо')}</span>}
          </NavLink>

          {user && !collapsed && (
            <div className="px-3 py-2">
              <p className="text-sm truncate">{user.name}</p>
              <span className="mt-1 inline-flex font-mono text-[11px] uppercase tracking-wide border rounded px-1.5 py-0.5 text-accent border-accent/40 bg-accent/12">
                {t(ROLE_LABELS[user.role] ?? user.role)}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setLogoutOpen(true)}
            title={collapsed ? t('Гарах') : undefined}
            className={`w-full flex items-center gap-3 rounded px-3 py-2 text-sm text-ink-muted hover:text-alarm transition-colors ${
              collapsed ? 'justify-center px-2' : ''
            }`}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && <span>{t('Гарах')}</span>}
          </button>

          <button
            type="button"
            onClick={toggleSidebar}
            title={collapsed ? t('Цэс дэлгэх') : t('Цэс хумих')}
            className={`w-full flex items-center gap-3 rounded px-3 py-2 text-sm text-ink-muted hover:text-ink transition-colors ${
              collapsed ? 'justify-center px-2' : ''
            }`}
          >
            {collapsed ? (
              <PanelLeft size={18} className="shrink-0" />
            ) : (
              <>
                <PanelLeftClose size={18} className="shrink-0" />
                <span>{t('Цэс хумих')}</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ── Баруун тал: topbar + контент ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-12 border-b border-rule flex items-center gap-3 px-4 md:px-6 shrink-0">
          <NavLink to="/" className="font-serif text-xl font-medium tracking-tight">
            ursGAL
          </NavLink>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            {/* Offline индикатор (V4-10) */}
            {offline && (
              <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-alarm border border-alarm/40 bg-alarm/10 rounded px-1.5 py-0.5">
                <span className="w-2 h-2 rounded-full bg-alarm animate-pulse" />
                {t('Офлайн')}
              </span>
            )}
            <NotificationBell unread={unread} />
            <ThemeToggle />
            {/* Mobile: sidebar байхгүй тул бүх цэс энэ товчны цаана.
                Тохиргоо/эрх/гарах ч мөн тэнд — topbar-т 3 зүйл л үлдэнэ */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={t('Цэс')}
              className="md:hidden p-1 text-ink-muted hover:text-ink"
            >
              <Menu size={20} />
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-6 md:py-10 pb-24 md:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Гарахын өмнөх баталгаажуулалт */}
      <ConfirmDialog
        open={logoutOpen}
        title={t('Системээс гарах')}
        message={t('Та системээс гарахдаа итгэлтэй байна уу?')}
        confirmLabel={t('Гарах')}
        danger
        onConfirm={handleLogout}
        onCancel={() => setLogoutOpen(false)}
      />

      {/* ── Mobile доод tab bar — хамгийн чухал 4 + «Цэс» ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-rule flex pb-[env(safe-area-inset-bottom)]">
        {tabItems.map((item) => (
          <NavLink key={item.key} to={item.path} end={item.end} className={tabLink}>
            <item.icon size={20} className="shrink-0" />
            <span className="w-full truncate text-center px-0.5">
              {t(item.label)}
            </span>
          </NavLink>
        ))}
        {/* Жолоочид мэдэгдлийн tab — badge-тэй */}
        {isDriver && (
          <NavLink to="/notifications" className={tabLink}>
            <span className="relative">
              <Bell size={20} />
              {unread > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-alarm text-bg font-mono text-[9px] leading-[15px] text-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            <span className="w-full truncate text-center px-0.5">
              {t('Мэдэгдэл')}
            </span>
          </NavLink>
        )}
        {needsMore && (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[10px] leading-tight text-ink-muted"
          >
            <Menu size={20} className="shrink-0" />
            <span className="w-full truncate text-center px-0.5">{t('Цэс')}</span>
          </button>
        )}
      </nav>

      {/* ── Mobile бүрэн цэс ── */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label={t('Хаах')}
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 w-full bg-bg/70"
          />
          <div className="absolute right-0 top-0 h-full w-[82vw] max-w-xs bg-surface border-l border-rule flex flex-col">
            <div className="flex items-center justify-between px-4 h-12 border-b border-rule shrink-0">
              <span className="font-serif text-lg">{t('Цэс')}</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t('Хаах')}
                className="p-1 text-ink-muted hover:text-ink"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-2 space-y-1">
              {items.map((item) => (
                <NavLink
                  key={item.key}
                  to={item.path}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                  className={sideLink}
                >
                  <item.icon size={18} className="shrink-0" />
                  <span className="truncate">{t(item.label)}</span>
                </NavLink>
              ))}
            </nav>

            <div className="border-t border-rule p-2 space-y-1 shrink-0">
              <NavLink
                to="/settings"
                onClick={() => setMenuOpen(false)}
                className={sideLink}
              >
                <Settings size={18} className="shrink-0" />
                <span>{t('Тохиргоо')}</span>
              </NavLink>
              {user && (
                <div className="px-3 py-2">
                  <p className="text-sm truncate">{user.name}</p>
                  <span className="mt-1 inline-flex font-mono text-[11px] uppercase tracking-wide border rounded px-1.5 py-0.5 text-accent border-accent/40 bg-accent/12">
                    {t(ROLE_LABELS[user.role] ?? user.role)}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setLogoutOpen(true)
                }}
                className="w-full flex items-center gap-3 rounded px-3 py-2 text-sm text-ink-muted hover:text-alarm"
              >
                <LogOut size={18} className="shrink-0" />
                <span>{t('Гарах')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
