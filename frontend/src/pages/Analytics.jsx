import { useCallback, useEffect, useState } from 'react'
import BarMini from '../components/dashboard/BarMini'
import MetricCard from '../components/dashboard/MetricCard'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Spinner from '../components/ui/Spinner'
import Table from '../components/ui/Table'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import { formatMoney, formatMoneyRound, formatMoneyShort } from '../lib/format'
import { channelLabel } from '../lib/channels'

const PRESETS = [7, 30, 90]

/** from ISO огноо (өнөөдрөөс n-1 хоногийн өмнө) */
function fromFor(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (days - 1))
  return d.toISOString()
}

export default function Analytics() {
  const { t } = useLang()

  const [days, setDays] = useState(30)
  const [custom, setCustom] = useState(null) // {from, to}
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    setData(null)
    const q = new URLSearchParams()
    if (custom) {
      q.set('from', new Date(custom.from).toISOString())
      q.set('to', new Date(`${custom.to}T23:59:59`).toISOString())
    } else {
      q.set('from', fromFor(days))
    }
    const range = q.toString()
    Promise.all([
      api(`/analytics/sales?${range}&groupBy=${(custom || days > 30) ? 'week' : 'day'}`),
      api(`/analytics/top-products?${range}&limit=8`),
      api(`/analytics/drivers?${range}`),
      api('/analytics/customers'),
      api(`/analytics/channels?${range}`),
    ])
      .then(([sales, top, drivers, customers, channels]) =>
        setData({ sales, top, drivers, customers, channels }),
      )
      .catch((e) => setError(e))
  }, [days, custom])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <EmptyState
        title={t('Өгөгдөл ачаалж чадсангүй')}
        note={error.message}
        action={<Button onClick={load}>{t('Дахин оролдох')}</Button>}
      />
    )
  }

  const driverColumns = [
    { key: 'name', header: t('Жолооч') },
    {
      key: 'assigned',
      header: t('Хуваарилагдсан'),
      align: 'right',
      render: (d) => <span className="font-mono tabular-nums">{d.assigned}</span>,
    },
    {
      key: 'delivered',
      header: t('Хүргэсэн'),
      align: 'right',
      render: (d) => (
        <span className="font-mono tabular-nums">{d.delivered}</span>
      ),
    },
    {
      key: 'dr',
      header: 'DR%',
      align: 'right',
      render: (d) => (
        <span className="font-mono tabular-nums">
          {Math.round(d.dr * 100)}%
        </span>
      ),
    },
    {
      key: 'earnings',
      header: t('Бодогдох цалин'),
      align: 'right',
      render: (d) => (
        <span className="font-mono tabular-nums">{formatMoney(d.earnings)}</span>
      ),
    },
  ]

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="font-serif text-4xl font-medium">{t('Аналитик')}</h1>

        {/* Интервал сонгогч */}
        <div className="flex items-end gap-2 flex-wrap">
          {PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setCustom(null)
                setDays(n)
              }}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                !custom && days === n
                  ? 'bg-surface text-accent-text'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t('{n} хоног', { n })}
            </button>
          ))}
          <Input
            id="an-from"
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <Input
            id="an-to"
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
          />
          <Button
            variant="ghost"
            disabled={!customFrom || !customTo}
            onClick={() => setCustom({ from: customFrom, to: customTo })}
          >
            {t('Шүүх')}
          </Button>
        </div>
      </div>

      {!data ? (
        <div className="py-16 text-center">
          <Spinner size={22} />
        </div>
      ) : (
        <>
          {/* Борлуулалт */}
          <section className="mt-10 border-t border-rule pt-6">
            <div className="flex items-start gap-10 flex-wrap">
              <div className="grid grid-cols-2 gap-y-6 md:flex md:gap-y-0 [&>*]:min-w-0 md:[&>*]:basis-44 md:[&>*]:shrink-0 md:divide-x divide-rule">
                <MetricCard
                  label={t('Захиалгын тоо')}
                  value={String(data.sales.totals.count)}
                />
                <MetricCard
                  label={t('Нийт дүн')}
                  value={formatMoneyRound(data.sales.totals.amount)}
                />
                <MetricCard
                  label={t('Ашиг')}
                  value={formatMoneyRound(data.sales.totals.profit)}
                  sub={`${t('Өртөг')}: ${formatMoneyShort(data.sales.totals.cost)}`}
                />
              </div>
              <div className="flex gap-10 flex-wrap">
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                    {t('Захиалгын тоо')}
                  </p>
                  <BarMini
                    values={data.sales.rows.map((r) => r.count)}
                    width={Math.max(160, data.sales.rows.length * 14)}
                    height={56}
                    labels={data.sales.rows.map((r, i) =>
                      i === 0 || i === data.sales.rows.length - 1
                        ? r.bucket.slice(5)
                        : '',
                    )}
                  />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                    {t('Дүн')}
                  </p>
                  <BarMini
                    values={data.sales.rows.map((r) => Number(r.amount))}
                    width={Math.max(160, data.sales.rows.length * 14)}
                    height={56}
                    color="var(--color-safe)"
                    labels={data.sales.rows.map((r, i) =>
                      i === 0 || i === data.sales.rows.length - 1
                        ? r.bucket.slice(5)
                        : '',
                    )}
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="mt-12 grid lg:grid-cols-2 gap-x-12 gap-y-10">
            {/* TOP бараа — хэвтээ багана */}
            <section>
              <p className="text-xs uppercase tracking-wide text-ink-muted border-b border-rule pb-2 mb-4">
                {t('TOP бараа')}
              </p>
              {data.top.length === 0 ? (
                <p className="text-sm text-ink-muted">—</p>
              ) : (
                <ul className="space-y-3">
                  {data.top.map((p) => {
                    const max = Number(data.top[0].amount) || 1
                    const w = Math.max(
                      4,
                      Math.round((Number(p.amount) / max) * 100),
                    )
                    return (
                      <li key={p.productId}>
                        <div className="flex justify-between gap-3 text-sm">
                          <span className="truncate">
                            {p.name}
                            <span className="font-mono text-xs text-ink-muted ml-1.5">
                              ×{p.qty}
                            </span>
                          </span>
                          <span className="shrink-0">
                            <span className="font-mono tabular-nums">
                              {formatMoneyShort(p.amount)}
                            </span>
                            {Number(p.cost) > 0 && (
                              <span className="font-mono text-xs text-safe ml-2 tabular-nums">
                                +{formatMoneyShort(p.profit)}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="mt-1 h-2 bg-surface rounded overflow-hidden">
                          <div
                            className="h-full bg-accent/70 rounded"
                            style={{ width: `${w}%` }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* Суваг — захиалга хаанаас ирж байна (V5) */}
            <section>
              <p className="text-xs uppercase tracking-wide text-ink-muted border-b border-rule pb-2 mb-4">
                {t('Суваг')}
              </p>
              {data.channels.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('Захиалга алга')}</p>
              ) : (
                <ul className="space-y-3">
                  {data.channels.map((c) => (
                    <li key={c.channel}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span>
                          {t(channelLabel(c.channel))}
                          <span className="ml-2 font-mono text-xs text-ink-muted tabular-nums">
                            {c.orders} {t('захиалга')} · {c.share}%
                          </span>
                        </span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(c.amount)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded bg-rule overflow-hidden">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${c.share}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Хүлээн авагч (утсаар бүлэглэсэн) */}
            <section>
              <p className="text-xs uppercase tracking-wide text-ink-muted border-b border-rule pb-2 mb-4">
                {t('Хүлээн авагч')}
              </p>
              <div className="grid grid-cols-2 gap-y-6 md:flex md:gap-y-0 [&>*]:min-w-0 md:[&>*]:basis-44 md:[&>*]:shrink-0 md:divide-x divide-rule">
                <MetricCard
                  label={t('Шинэ')}
                  value={String(data.customers.newCustomers)}
                  sub={t('1 захиалгатай')}
                />
                <MetricCard
                  label={t('Давтан')}
                  value={String(data.customers.repeatCustomers)}
                  sub={t('2+ захиалгатай')}
                />
              </div>
              <ul className="mt-5 divide-y divide-rule border-y border-rule">
                {data.customers.topCustomers.slice(0, 5).map((c) => (
                  <li
                    key={c.phone}
                    className="py-2 flex items-center gap-3 text-sm"
                  >
                    <span className="flex-1 truncate">
                      {c.name}
                      <span className="font-mono text-xs text-ink-muted ml-2">
                        {c.phone}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-ink-muted">
                      {c.orders} {t('захиалга')}
                    </span>
                    <span className="font-mono tabular-nums w-24 text-right">
                      {formatMoneyShort(c.totalAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Жолоочид — DR%-аар эрэмбэлсэн */}
          <section className="mt-12">
            <p className="text-xs uppercase tracking-wide text-ink-muted border-b border-rule pb-2 mb-4">
              {t('Жолоочдын харьцуулалт')}
            </p>
            <Table
              columns={driverColumns}
              rows={[...data.drivers].sort((a, b) => b.dr - a.dr)}
              empty={t('Жолооч алга')}
            />
          </section>
        </>
      )}
    </div>
  )
}
