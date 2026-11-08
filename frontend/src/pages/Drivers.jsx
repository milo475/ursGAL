import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import Table from '../components/ui/Table'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import { formatMoney } from '../lib/format'

/**
 * Жолооч нар — drivers.view эрхтэй хэн ч (MANAGER г.м.) харна.
 * Бүртгэлийн засвар (нэр, хөлс, идэвх) users.manage-тэйд /users дээр.
 */
export default function Drivers() {
  const { t } = useLang()
  const { hasPerm } = useAuth()

  const [drivers, setDrivers] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    api('/drivers')
      .then(setDrivers)
      .catch((e) => setError(e))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <EmptyState
        title={t('Жагсаалт ачаалж чадсангүй')}
        note={error.message}
        action={<Button onClick={load}>{t('Дахин оролдох')}</Button>}
      />
    )
  }
  if (!drivers) {
    return (
      <div className="py-16 text-center">
        <Spinner size={22} />
      </div>
    )
  }

  const columns = [
    {
      key: 'name',
      header: t('Нэр'),
      render: (d) => (
        <span>
          {d.name}
          {!d.isActive && (
            <span className="ml-2 font-mono text-[10px] uppercase text-alarm border border-alarm/40 rounded px-1 py-0.5">
              {t('Идэвхгүй')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'available',
      header: t('Төлөв'),
      render: (d) => (
        <span className="flex items-center gap-1.5 text-sm">
          <span
            className={`w-2 h-2 rounded-full ${
              d.isAvailable === false ? 'bg-alarm' : 'bg-safe'
            }`}
          />
          {t(d.isAvailable === false ? 'Завгүй' : 'Чөлөөтэй')}
        </span>
      ),
    },
    {
      key: 'active',
      header: t('Идэвхтэй хүргэлт'),
      align: 'right',
      render: (d) => <span className="font-mono tabular-nums">{d.active}</span>,
    },
    {
      key: 'today',
      header: t('Өнөөдөр хүргэсэн'),
      align: 'right',
      render: (d) => (
        <span className="font-mono tabular-nums">{d.deliveredToday}</span>
      ),
    },
    {
      key: 'total',
      header: t('Нийт хүргэсэн'),
      align: 'right',
      render: (d) => (
        <span className="font-mono tabular-nums">{d.totalDelivered}</span>
      ),
    },
    {
      key: 'dr',
      header: t('DR%'),
      align: 'right',
      render: (d) =>
        d.dr === null ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <span
            className={`font-mono tabular-nums ${d.dr >= 90 ? 'text-safe' : d.dr >= 70 ? '' : 'text-alarm'}`}
            title={`${d.totalDelivered}/${d.assigned}`}
          >
            {d.dr}%
          </span>
        ),
    },
    {
      key: 'zones',
      header: t('Харьяалах бүс'),
      render: (d) =>
        d.zones?.length ? (
          <span className="flex flex-wrap gap-1">
            {d.zones.map((z) => (
              <span
                key={z}
                className="font-mono text-[10px] border border-rule rounded px-1 py-0.5 text-ink-muted"
              >
                {z}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: 'employment',
      header: t('Ажлын төрөл'),
      render: (d) => (
        <span className="text-sm text-ink-muted">
          {d.employmentType === 'HOURLY' ? t('Цагийн') : t('Үндсэн')}
        </span>
      ),
    },
    {
      key: 'fee',
      header: t('Хөлс'),
      align: 'right',
      render: (d) => (
        <span className="font-mono tabular-nums text-ink-muted">
          {d.feePerDelivery ? formatMoney(d.feePerDelivery) : '—'}
        </span>
      ),
    },
    {
      key: 'vehicle',
      header: t('Тээврийн хэрэгсэл'),
      render: (d) => (
        <span className="text-sm text-ink-muted">{d.vehicleInfo ?? '—'}</span>
      ),
    },
  ]

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="font-serif text-4xl font-medium">{t('Жолооч нар')}</h1>
        <div className="flex items-center gap-4">
          {hasPerm('finance.driver_payroll') && (
            <Link
              to="/finance/payroll"
              className="text-sm text-accent-text hover:underline underline-offset-2"
            >
              {t('Жолоочийн цалин')} →
            </Link>
          )}
          {hasPerm('users.manage') && (
            <Link
              to="/users?role=DRIVER"
              className="text-sm text-accent-text hover:underline underline-offset-2"
            >
              {t('Бүртгэл засах')} →
            </Link>
          )}
        </div>
      </div>

      <div className="mt-8">
        <Table columns={columns} rows={drivers} empty={t('Жолооч алга')} />
      </div>
    </div>
  )
}
