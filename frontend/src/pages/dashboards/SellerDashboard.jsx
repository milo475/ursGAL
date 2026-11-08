import { useNavigate } from 'react-router'
import MetricCard from '../../components/dashboard/MetricCard'
import Rise from '../../components/dashboard/Rise'
import EmptyState from '../../components/ui/EmptyState'
import { useLang } from '../../context/LanguageContext'
import { DashError, DashSkeleton } from '../../components/dashboard/DashStates'
import { useDashboard } from '../../hooks/useDashboard'
import { channelLabel } from '../../lib/channels'
import { formatDateTime, formatMoney } from '../../lib/format'

/**
 * Борлуулагчийн самбар (V5).
 * Ажил нь гурван алхам: линкээр ирсэн хүсэлтийг ШАЛГАХ → захиалга
 * БОЛГОХ → жолооч хуваарилж ХҮРГЭЛТЭД ГАРГАХ. Самбар нь тэр гурвын
 * аль нь гацсаныг нэг харцаар харуулна.
 */
export default function SellerDashboard() {
  const { t } = useLang()
  const navigate = useNavigate()
  const { data, error, reload } = useDashboard('seller')

  if (error) return <DashError error={error} onRetry={reload} />
  if (!data) return <DashSkeleton />

  return (
    <div>
      <Rise delay={0}>
        <section>
          <h1 className="font-serif text-4xl font-medium">
            {t('Борлуулагчийн самбар')}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {t('Хүсэлт шалгах → захиалга болгох → хүргэлтэд гаргах')}
          </p>
        </section>
      </Rise>

      <Rise delay={60}>
        <section className="mt-16 border-t border-rule pt-8">
          <div className="grid gap-x-4 gap-y-6 md:gap-y-0 grid-cols-2 md:grid-cols-4 md:divide-x divide-rule">
            <MetricCard
              label={t('Хүлээгдэж буй хүсэлт')}
              value={String(data.newRequests)}
            />
            <MetricCard
              label={t('Өнөөдөр батласан')}
              value={String(data.convertedToday)}
            />
            <MetricCard
              label={t('Жолооч хүлээж буй')}
              value={String(data.unassignedOrders)}
            />
            <MetricCard
              label={t('Өнөөдөр хүргэлтэд гарсан')}
              value={String(data.releasedToday)}
            />
          </div>
        </section>
      </Rise>

      {/* Яаралтай: амжилтгүй хүргэлт — хэрэглэгчтэй эргэж ярина */}
      {data.failedDeliveries.length > 0 && (
        <Rise delay={90}>
          <section className="mt-16 border-t border-alarm/40 pt-8">
            <p className="text-xs uppercase tracking-wide text-alarm mb-4">
              ⚠ {t('Амжилтгүй хүргэлт')} ({data.failedDeliveries.length})
            </p>
            <ul className="border border-alarm/40 rounded-lg divide-y divide-rule">
              {data.failedDeliveries.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/orders/${o.id}`)}
                    className="w-full text-left px-4 py-3 flex items-start justify-between gap-4 hover:bg-bg transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">
                        {o.orderNo}
                        {o.driverName && (
                          <span className="ml-2 text-ink-muted">
                            🚚 {o.driverName}
                          </span>
                        )}
                      </span>
                      <span className="block text-sm">
                        {o.customerName}
                        <span className="ml-2 font-mono text-xs text-ink-muted">
                          {o.phone}
                        </span>
                      </span>
                      <span className="block text-xs text-ink-muted truncate">
                        {o.shortAddress}
                      </span>
                      {o.deliveryNote && (
                        <span className="block mt-1 text-sm text-alarm">
                          ✕ {o.deliveryNote}
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-sm tabular-nums shrink-0">
                      {formatMoney(o.totalAmount)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-muted">
              {t('Хэрэглэгчтэй ярилцаад дахин жолооч хуваарилна')}
            </p>
          </section>
        </Rise>
      )}

      {/* 1. Шалгах ээлж — линкээр ирсэн хүсэлтүүд */}
      <Rise delay={120}>
        <section className="mt-16 border-t border-rule pt-8">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              {t('Шалгах хүсэлтүүд')}
            </p>
            <button
              type="button"
              onClick={() => navigate('/order-requests')}
              className="text-sm text-accent-text underline underline-offset-2"
            >
              {t('Бүгдийг харах')} →
            </button>
          </div>
          {data.pendingRequests.length === 0 ? (
            <EmptyState title={t('Хүсэлт алга')} />
          ) : (
            <ul className="border border-rule rounded-lg divide-y divide-rule">
              {data.pendingRequests.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => navigate('/order-requests')}
                    className="w-full text-left px-4 py-3 flex items-center justify-between gap-4 hover:bg-bg transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block">
                        {r.customerName}
                        {r.socialName && (
                          <span className="ml-2 text-sm text-ink-muted">
                            {r.socialName}
                          </span>
                        )}
                      </span>
                      <span className="block font-mono text-xs text-ink-muted">
                        {r.phone} · {t(channelLabel(r.channel))} ·{' '}
                        {formatDateTime(r.createdAt)}
                      </span>
                    </span>
                    <span
                      className={`font-mono text-[11px] uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 ${
                        r.paid
                          ? 'text-safe border-safe/40 bg-safe/12'
                          : 'text-alarm border-alarm/40 bg-alarm/12'
                      }`}
                    >
                      {r.paid ? t('Төлсөн гэсэн') : t('Төлөөгүй')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Rise>

      {/* 2. Хүргэлтэд гаргах ээлж — жолоочгүй захиалгууд */}
      <Rise delay={180}>
        <section className="mt-16 border-t border-rule pt-8">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              {t('Жолооч хүлээж буй захиалга')}
            </p>
            <button
              type="button"
              onClick={() => navigate('/orders')}
              className="text-sm text-accent-text underline underline-offset-2"
            >
              {t('Захиалга')} →
            </button>
          </div>
          {data.awaitingDriver.length === 0 ? (
            <EmptyState title={t('Бүгд хуваарилагдсан')} />
          ) : (
            <ul className="border border-rule rounded-lg divide-y divide-rule">
              {data.awaitingDriver.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/orders/${o.id}`)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between gap-4 hover:bg-bg transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">
                        {o.orderNo}
                        <span className="ml-2 text-ink-muted">
                          {o.district ?? ''}
                        </span>
                      </span>
                      <span className="block text-sm text-ink-muted truncate">
                        {o.customerName} · {o.shortAddress}
                      </span>
                    </span>
                    <span className="font-mono text-sm tabular-nums shrink-0">
                      {formatMoney(o.totalAmount)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Rise>
    </div>
  )
}
