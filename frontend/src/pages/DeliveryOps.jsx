import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowDown, ArrowUp } from 'lucide-react'
import RegionBadge from '../components/orders/RegionBadge'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import { formatMoney } from '../lib/format'

/** Багануудын дараалал: FAILED нь дахин хуваарилалт хүлээдэг тул эхний баганад */
const COLUMNS = [
  { key: 'PENDING', label: 'Хүлээгдэж буй', extra: 'FAILED' },
  { key: 'ASSIGNED', label: 'Хуваарилагдсан' },
  { key: 'ON_THE_WAY', label: 'Замд яваа' },
  { key: 'DELIVERED_TODAY', label: 'Өнөөдөр дууссан' },
]

function OrderCard({ o, t, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-surface border border-rule rounded p-3 hover:border-ink-muted transition-colors"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs tabular-nums">{o.orderNo}</span>
        {o.deliveryStatus === 'FAILED' && <Badge status="FAILED" />}
      </span>
      <span className="mt-1.5 flex items-center gap-1.5 text-sm min-w-0">
        <RegionBadge region={o.region} />
        <span className="truncate">{o.shortAddress || '—'}</span>
      </span>
      <span className="mt-1.5 flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="truncate">
          {o.assignedDriver?.fullName ?? t('Жолоочгүй')}
        </span>
        <span className="font-mono tabular-nums shrink-0">
          {formatMoney(o.totalAmount)}
        </span>
      </span>
    </button>
  )
}

export default function DeliveryOps() {
  const { t } = useLang()
  const { hasPerm } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  // Хуудсанд drivers.view-ээр ордог ч ХАДГАЛАХ нь drivers.assign
  // шаарддаг — эрхгүй хүн эрэмбэлээд хадгалахад 403 иддэг байсан
  const canAssign = hasPerm('drivers.assign')

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [driverId, setDriverId] = useState(null)
  const [routeList, setRouteList] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setError(null)
    api('/delivery-ops/board')
      .then(setData)
      .catch((e) => setError(e))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Сонгосон жолоочийн идэвхтэй хүргэлтүүд — маршрутын дарааллаар
  const driverActive = useMemo(() => {
    if (!data || !driverId) return []
    return [...data.board.ASSIGNED, ...data.board.ON_THE_WAY]
      .filter((o) => o.assignedDriver?.id === driverId)
      .sort(
        (a, b) =>
          (a.routeOrder ?? 999) - (b.routeOrder ?? 999) ||
          new Date(a.assignedAt) - new Date(b.assignedAt),
      )
  }, [data, driverId])

  useEffect(() => {
    setRouteList(driverActive)
    setDirty(false)
  }, [driverActive])

  function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= routeList.length) return
    const next = [...routeList]
    ;[next[i], next[j]] = [next[j], next[i]]
    setRouteList(next)
    setDirty(true)
  }

  async function saveRoute() {
    setSaving(true)
    try {
      await api('/deliveries/route-order', {
        method: 'PATCH',
        body: { driverId, orderIds: routeList.map((o) => o.id) },
      })
      toast.show(t('Дараалал хадгалагдлаа'))
      load()
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <EmptyState
        title={t('Өгөгдөл ачаалж чадсангүй')}
        note={error.message}
        action={<Button onClick={load}>{t('Дахин оролдох')}</Button>}
      />
    )
  }
  if (!data) {
    return (
      <div className="py-16 text-center">
        <Spinner size={22} />
      </div>
    )
  }

  return (
    <div>
      <h1 className="font-serif text-4xl font-medium">
        {t('Хүргэлтийн удирдлага')}
      </h1>

      <div className="mt-8 grid lg:grid-cols-[1fr_300px] gap-8 items-start">
        {/* ── Багана самбар ── */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 min-w-0">
          {COLUMNS.map((col) => {
            const rows = [
              ...data.board[col.key],
              ...(col.extra ? data.board[col.extra] : []),
            ]
            return (
              <section key={col.key} className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-ink-muted border-b border-rule pb-2 mb-3">
                  {t(col.label)}{' '}
                  <span className="font-mono tabular-nums">{rows.length}</span>
                </p>
                <div className="space-y-2">
                  {rows.length === 0 ? (
                    <p className="text-sm text-ink-muted">—</p>
                  ) : (
                    rows.map((o) => (
                      <OrderCard
                        key={o.id}
                        o={o}
                        t={t}
                        onOpen={() => navigate(`/orders/${o.id}`)}
                      />
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </div>

        {/* ── Жолоочдын панел + маршрут ── */}
        <aside className="bg-surface border border-rule rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-3">
            {t('Жолоочид')}
          </p>
          <div className="space-y-1">
            {data.drivers.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDriverId(d.id === driverId ? null : d.id)}
                className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm text-left transition-colors ${
                  d.id === driverId
                    ? 'bg-accent/12 text-accent-text'
                    : 'hover:bg-bg'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    d.isAvailable === false ? 'bg-alarm' : 'bg-safe'
                  }`}
                  title={d.isAvailable === false ? t('Завгүй') : t('Чөлөөтэй')}
                />
                <span className="flex-1 truncate">{d.name}</span>
                <span className="font-mono text-xs tabular-nums text-ink-muted">
                  {d.active} · {d.deliveredToday}✓
                </span>
              </button>
            ))}
          </div>

          {driverId && (
            <div className="mt-5 border-t border-rule pt-4">
              <p className="text-xs uppercase tracking-wide text-ink-muted mb-3">
                {t('Маршрутын дараалал')}
              </p>
              {routeList.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  {t('Идэвхтэй хүргэлт алга')}
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {routeList.map((o, i) => (
                    <li
                      key={o.id}
                      className="flex items-center gap-2 bg-bg border border-rule rounded px-2 py-1.5"
                    >
                      <span className="font-mono text-xs text-accent-text tabular-nums w-5 shrink-0">
                        {i + 1}.
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-mono text-xs tabular-nums">
                          {o.orderNo}
                        </span>
                        <span className="block text-xs text-ink-muted truncate">
                          {o.shortAddress || '—'}
                        </span>
                      </span>
                      <span className="flex flex-col shrink-0">
                        <button
                          type="button"
                          aria-label={`${o.orderNo} дээш`}
                          disabled={i === 0 || !canAssign}
                          onClick={() => move(i, -1)}
                          className="text-ink-muted hover:text-ink disabled:opacity-30"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`${o.orderNo} доош`}
                          disabled={i === routeList.length - 1 || !canAssign}
                          onClick={() => move(i, 1)}
                          className="text-ink-muted hover:text-ink disabled:opacity-30"
                        >
                          <ArrowDown size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {routeList.length > 0 &&
                (canAssign ? (
                  <Button
                    onClick={saveRoute}
                    loading={saving}
                    disabled={!dirty}
                    className="w-full mt-4"
                  >
                    {t('Дараалал хадгалах')}
                  </Button>
                ) : (
                  <p className="mt-4 text-xs text-ink-muted text-center">
                    {t('Дараалал хадгалах эрх байхгүй')}
                  </p>
                ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
