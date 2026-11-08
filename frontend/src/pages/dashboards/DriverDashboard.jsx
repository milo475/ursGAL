import { useNavigate } from 'react-router'
import BarMini from '../../components/dashboard/BarMini'
import Rise from '../../components/dashboard/Rise'
import Button from '../../components/ui/Button'
import { useLang } from '../../context/LanguageContext'
import { DashError, DashSkeleton } from '../../components/dashboard/DashStates'
import { useDashboard } from '../../hooks/useDashboard'
import { formatMoney } from '../../lib/format'

/** Жолоочийн самбар — утсанд зориулсан том элементүүд */
export default function DriverDashboard() {
  const { t } = useLang()
  const navigate = useNavigate()
  const { data, error, reload } = useDashboard('driver')

  if (error) return <DashError error={error} onRetry={reload} />
  if (!data) return <DashSkeleton />

  const delivered = data.last7Days.map((d) => d.delivered)
  const dayLabels = data.last7Days.map((d) => d.date.slice(8, 10))
  const deliveredToday = delivered[delivered.length - 1] ?? 0

  return (
    <div className="max-w-md mx-auto space-y-4">
      <Rise delay={0}>
        <h1 className="font-serif text-3xl font-medium">
          {t('Жолоочийн самбар')}
        </h1>
      </Rise>

      {/* Том карт ×2 */}
      <Rise delay={60}>
        <div className="bg-surface border border-rule rounded-lg p-5">
          <p className="text-xs uppercase tracking-wide text-ink-muted">
            {t('Өнөөдрийн хүргэлт')}
          </p>
          <p className="mt-2 font-mono text-4xl tabular-nums">
            {deliveredToday}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {t('7 хоног')}: {data.assignedThisWeek} / {data.deliveredThisWeek}
          </p>
        </div>
      </Rise>

      <Rise delay={120}>
        <div className="bg-surface border border-accent/40 rounded-lg p-5">
          <p className="text-xs uppercase tracking-wide text-ink-muted">
            {t('Тооцоогүй цалин')}
          </p>
          <p className="mt-2 font-mono text-5xl tabular-nums text-accent-text">
            {formatMoney(data.earnings.unpaid)}
          </p>
          <p className="mt-1 text-sm text-ink-muted font-mono tabular-nums">
            {data.unpaidCount} × {formatMoney(data.feePerDelivery)}
          </p>
          <div className="mt-4 border-t border-rule pt-3 space-y-1.5 text-sm">
            <p className="flex justify-between">
              <span className="text-ink-muted">{t('Тооцоонд орсон')}</span>
              <span className="font-mono tabular-nums">
                {formatMoney(data.earnings.pendingPayout)}
              </span>
            </p>
            <p className="flex justify-between">
              <span className="text-ink-muted">{t('Олгосон нийт')}</span>
              <span className="font-mono tabular-nums">
                {formatMoney(data.earnings.paidTotal)}
              </span>
            </p>
          </div>
        </div>
      </Rise>

      {/* 7 хоногийн гүйцэтгэл */}
      <Rise delay={180}>
        <div className="bg-surface border border-rule rounded-lg p-5">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              {t('7 хоногийн гүйцэтгэл')}
            </p>
            <p className="font-mono text-sm tabular-nums">
              {t('Нийт хүргэсэн')}: {data.totalDelivered}
            </p>
          </div>
          <BarMini values={delivered} width={340} height={64} labels={dayLabels} />
        </div>
      </Rise>

      {/* Том товч */}
      <Rise delay={240}>
        <Button
          onClick={() => navigate('/deliveries')}
          className="w-full py-4 text-lg"
        >
          {t('Хүргэлтээ эхлэх')} →
        </Button>
      </Rise>
    </div>
  )
}
