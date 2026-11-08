import { useNavigate } from 'react-router'
import MetricCard from '../../components/dashboard/MetricCard'
import Rise from '../../components/dashboard/Rise'
import EmptyState from '../../components/ui/EmptyState'
import { useLang } from '../../context/LanguageContext'
import { DashError, DashSkeleton } from '../../components/dashboard/DashStates'
import { useDashboard } from '../../hooks/useDashboard'
import { formatDateTime, formatMoney } from '../../lib/format'

/**
 * Харилцагчийн (нийлүүлэгчийн) самбар.
 *
 * Тэд ӨӨР КОМПАНИЙН хүмүүс тул зөвхөн өөрийн нийлүүлэлт, бидний
 * төлөх өр, дуусч буй өөрийн бараагаа хардаг. Захиалга, үйлчлүүлэгчийн
 * мэдээлэл, бусдын бараа энд огт харагдахгүй.
 */
export default function OperatorDashboard() {
  const { t } = useLang()
  const navigate = useNavigate()
  const { data, error, reload } = useDashboard('operator')

  if (error) return <DashError error={error} onRetry={reload} />
  if (!data) return <DashSkeleton />

  if (!data.company) {
    return (
      <div>
        <h1 className="font-serif text-4xl font-medium">{t('Нийлүүлэгч')}</h1>
        <div className="mt-10">
          <EmptyState
            title={t('Танай компани бүртгэгдээгүй байна')}
            note={t('Админ таныг харилцагч компанид холбосны дараа нийлүүлэлт, тооцоо энд харагдана')}
          />
        </div>
      </div>
    )
  }

  const due = Number(data.dueAmount)

  return (
    <div>
      <Rise delay={0}>
        <section>
          <h1 className="font-serif text-4xl font-medium">{data.company.name}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {t('Таны нийлүүлсэн бараа ба тооцоо')}
          </p>
        </section>
      </Rise>

      <Rise delay={60}>
        <section className="mt-16 border-t border-rule pt-8">
          <div className="grid gap-x-4 gap-y-6 md:gap-y-0 grid-cols-2 md:grid-cols-4 md:divide-x divide-rule">
            <MetricCard
              label={t('Нийлүүлэлт')}
              value={String(data.supplies)}
            />
            <MetricCard
              label={t('Нийт өртөг')}
              value={formatMoney(data.totalCost)}
            />
            <MetricCard
              label={t('Төлсөн')}
              value={formatMoney(data.paidAmount)}
            />
            <MetricCard
              label={t('Танд төлөх')}
              value={formatMoney(data.dueAmount)}
              sub={
                data.lastSupplyAt
                  ? `${t('Сүүлд')} ${formatDateTime(data.lastSupplyAt)}`
                  : undefined
              }
            />
          </div>
          {due > 0 && (
            <p className="mt-4 text-sm text-alarm">
              {t('Төлөгдөөгүй үлдэгдэл байна')}
            </p>
          )}
        </section>
      </Rise>

      {/* Өөрийнх нь бараа дуусч байвал — дахин нийлүүлэх дохио */}
      <Rise delay={120}>
        <section className="mt-16 border-t border-rule pt-8">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-4">
            {t('Дуусч буй таны бараа')}
          </p>
          {data.lowStockProducts.length === 0 ? (
            <EmptyState title={t('Бүх бараа хангалттай')} />
          ) : (
            <ul className="border border-status-preparing/40 rounded-lg divide-y divide-rule">
              {data.lowStockProducts.map((p) => (
                <li
                  key={p.id}
                  className="px-4 py-3 flex items-center justify-between gap-4"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="font-mono text-sm tabular-nums shrink-0 text-status-preparing">
                    {p.stockQty} / {p.lowStockLimit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Rise>

      <Rise delay={180}>
        <section className="mt-16 border-t border-rule pt-8">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              {t('Сүүлийн нийлүүлэлт')}
            </p>
            <button
              type="button"
              onClick={() => navigate('/supplies')}
              className="text-sm text-accent-text underline underline-offset-2"
            >
              {t('Бүгдийг харах')} →
            </button>
          </div>
          {data.recentSupplies.length === 0 ? (
            <EmptyState title={t('Нийлүүлэлт алга')} />
          ) : (
            <ul className="border border-rule rounded-lg divide-y divide-rule">
              {data.recentSupplies.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-mono text-sm">{s.number}</p>
                      <p className="text-sm text-ink-muted truncate">{s.items}</p>
                      <p className="font-mono text-xs text-ink-muted">
                        {formatDateTime(s.createdAt)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono tabular-nums">
                        {formatMoney(s.totalCost)}
                      </p>
                      <p
                        className={`font-mono text-xs tabular-nums ${
                          Number(s.dueAmount) > 0 ? 'text-alarm' : 'text-safe'
                        }`}
                      >
                        {Number(s.dueAmount) > 0
                          ? `${t('Өр')} ${formatMoney(s.dueAmount)}`
                          : `✓ ${t('Төлсөн')}`}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Rise>
    </div>
  )
}
