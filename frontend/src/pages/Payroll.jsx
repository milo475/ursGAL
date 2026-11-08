import { useCallback, useEffect, useState } from 'react'
import Button from '../components/ui/Button'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import Table from '../components/ui/Table'
import { useToast } from '../components/ui/Toast'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import { formatDateTime, formatMoney } from '../lib/format'

/** PENDING шар / PAID ногоон badge */
function PayoutBadge({ status, t }) {
  const paid = status === 'PAID'
  return (
    <span
      className={`inline-flex font-mono text-[10px] uppercase tracking-wide border rounded px-1 py-0.5 ${
        paid
          ? 'text-safe border-safe/40 bg-safe/12'
          : 'text-status-preparing border-status-preparing/40 bg-status-preparing/12'
      }`}
    >
      {t(paid ? 'Төлсөн' : 'Хүлээгдэж буй')}
    </span>
  )
}

const day = (iso) => formatDateTime(iso).slice(0, 10)

export default function Payroll() {
  const { t } = useLang()
  const toast = useToast()

  const [pending, setPending] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)
  const [closing, setClosing] = useState(null) // тооцоо хаах гэж буй мөр
  const [paying, setPaying] = useState(null) // төлсөн болгох гэж буй тооцоо
  const [busy, setBusy] = useState(false)
  const [payingId, setPayingId] = useState(null)

  const load = useCallback(() => {
    setError(null)
    api('/finance/payroll/pending').then(setPending).catch((e) => setError(e))
    api('/finance/payroll').then(setHistory).catch((e) => setError(e))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function closePayroll() {
    setBusy(true)
    try {
      await api('/finance/payroll/close', {
        method: 'POST',
        body: { driverId: closing.driverId },
      })
      toast.show(t('Тооцоо хаагдлаа'))
      setClosing(null)
      load()
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function markPaid(p) {
    setPayingId(p.id)
    setPaying(null)
    try {
      await api(`/finance/payroll/${p.id}/pay`, { method: 'PATCH' })
      toast.show(t('Төлсөн болголоо'))
      load()
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    } finally {
      setPayingId(null)
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
  if (!pending || !history) {
    return (
      <div className="py-16 text-center">
        <Spinner size={22} />
      </div>
    )
  }

  const columns = [
    {
      key: 'driver',
      header: t('Жолооч'),
      render: (p) => p.driver?.fullName ?? '—',
    },
    {
      key: 'period',
      header: t('Хугацаа'),
      render: (p) => (
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {day(p.periodStart)} — {day(p.periodEnd)}
        </span>
      ),
    },
    {
      key: 'count',
      header: t('Тоо'),
      align: 'right',
      render: (p) => (
        <span className="font-mono tabular-nums">{p.deliveredCount}</span>
      ),
    },
    {
      key: 'fee',
      header: t('Хөлс'),
      align: 'right',
      render: (p) => (
        <span className="font-mono text-sm tabular-nums text-ink-muted">
          {formatMoney(p.feePerDelivery)}
        </span>
      ),
    },
    {
      key: 'total',
      header: t('Дүн'),
      align: 'right',
      render: (p) => (
        <span className="font-mono tabular-nums">
          {formatMoney(p.totalAmount)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('Статус'),
      render: (p) => (
        <span className="flex items-center gap-2">
          <PayoutBadge status={p.status} t={t} />
          {p.paidAt && (
            <span className="font-mono text-[11px] text-ink-muted tabular-nums">
              {day(p.paidAt)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: '_pay',
      header: '',
      render: (p) =>
        p.status === 'PENDING' ? (
          <Button
            variant="ghost"
            loading={payingId === p.id}
            onClick={() => setPaying(p)}
            className="text-xs px-2 py-1"
          >
            {t('Төлсөн болгох')}
          </Button>
        ) : null,
    },
  ]

  return (
    <div>
      <h1 className="font-serif text-4xl font-medium">{t('Жолоочийн цалин')}</h1>

      {/* Тооцоо хийгдээгүй */}
      <section className="mt-8">
        <p className="text-xs uppercase tracking-wide text-ink-muted mb-4">
          {t('Тооцоо хийгдээгүй')} — {pending.length}
        </p>
        {pending.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {t('Тооцоо хийгдээгүй жолооч алга')}
          </p>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pending.map((row) => (
              <div
                key={row.driverId}
                className="bg-surface border border-rule rounded-lg p-5"
              >
                <p className="text-lg font-medium">{row.driverName}</p>
                <p className="mt-1 font-mono text-sm text-ink-muted tabular-nums">
                  {row.deliveredCount} × {formatMoney(row.feePerDelivery)}
                </p>
                <p className="mt-3 font-mono text-3xl tabular-nums text-accent-text">
                  {formatMoney(row.amount)}
                </p>
                <Button
                  onClick={() => setClosing(row)}
                  className="w-full mt-4"
                >
                  {t('Тооцоо хаах')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Түүх */}
      <section className="mt-12 border-t border-rule pt-6">
        <p className="text-xs uppercase tracking-wide text-ink-muted mb-4">
          {t('Тооцооны түүх')}
        </p>
        <Table
          columns={columns}
          rows={history}
          empty={t('Тооцоо хийгдээгүй байна')}
        />
      </section>

      {/* Төлсөн болгохын өмнөх баталгаажуулалт */}
      <ConfirmDialog
        open={!!paying}
        title={t('Төлсөн болгох')}
        message={
          paying
            ? t('{name} — {amt}. Цалинг олгосон гэж тэмдэглэхдээ итгэлтэй байна уу?', {
                name: paying.driver?.fullName ?? '',
                amt: formatMoney(paying.totalAmount),
              })
            : ''
        }
        confirmLabel={t('Төлсөн болгох')}
        loading={payingId === paying?.id}
        onConfirm={() => markPaid(paying)}
        onCancel={() => setPaying(null)}
      />

      <ConfirmDialog
        open={!!closing}
        title={t('Тооцоо хаах')}
        message={
          closing
            ? t('{name} — {n} хүргэлт, {amt}. Тооцоо хаах уу?', {
                name: closing.driverName,
                n: closing.deliveredCount,
                amt: formatMoney(closing.amount),
              })
            : ''
        }
        confirmLabel={t('Тооцоо хаах')}
        loading={busy}
        onConfirm={closePayroll}
        onCancel={() => setClosing(null)}
      />
    </div>
  )
}
