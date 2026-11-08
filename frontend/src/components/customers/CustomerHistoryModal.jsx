import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import Modal from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { useLang } from '../../context/LanguageContext'
import { api } from '../../lib/api'
import { formatDateTime, formatMoney } from '../../lib/format'

/**
 * Хэрэглэгчийн худалдан авалтын түүх утсаар нь (V5).
 *
 * Борлуулагч хүсэлт батлахаасаа өмнө «энэ хүн өмнө нь юу авч байсан,
 * төлбөрөө төлдөг үү, цуцалдаг уу» гэдгийг ЭНД шалгана. Нярав тооцоо
 * гаргахад, менежер хяналтдаа мөн ижил цонхыг ашиглана.
 */
export default function CustomerHistoryModal({ phone, name, onClose }) {
  const { t } = useLang()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api(`/customers/history?phone=${encodeURIComponent(phone)}`)
      .then(setData)
      .catch((e) => setError(e))
  }, [phone])

  const s = data?.summary

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('Худалдан авалтын түүх')} — ${name || phone}`}
    >
      {error ? (
        <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
          {error.message}
        </p>
      ) : !data ? (
        <div className="py-10 flex justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto -mx-1 px-1">
          <p className="font-mono text-sm text-ink-muted">{data.phone}</p>
          {data.names.length > 1 && (
            <p className="mt-1 text-xs text-ink-muted">
              {t('Бусад нэр')}: {data.names.join(', ')}
            </p>
          )}

          {s.orders === 0 && s.cancelled === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              {t('Анхны худалдан авалт — өмнөх захиалга алга')}
            </p>
          ) : (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-muted">{t('Захиалга')}</dt>
                <dd className="font-mono tabular-nums text-right">
                  {s.orders}
                  {s.cancelled > 0 && (
                    <span className="ml-2 text-status-cancelled">
                      +{s.cancelled} {t('цуцалсан')}
                    </span>
                  )}
                </dd>
                <dt className="text-ink-muted">{t('Нийт дүн')}</dt>
                <dd className="font-mono tabular-nums text-right">
                  {formatMoney(s.totalAmount)}
                </dd>
                <dt className="text-ink-muted">{t('Төлсөн')}</dt>
                <dd className="font-mono tabular-nums text-right">
                  {formatMoney(s.paidAmount)}
                </dd>
                <dt className="text-ink-muted">{t('Авлага')}</dt>
                <dd
                  className={`font-mono tabular-nums text-right ${
                    Number(s.dueAmount) > 0 ? 'text-alarm' : 'text-safe'
                  }`}
                >
                  {formatMoney(s.dueAmount)}
                </dd>
                {s.firstOrderAt && (
                  <>
                    <dt className="text-ink-muted">{t('Анх')}</dt>
                    <dd className="font-mono text-xs text-right">
                      {formatDateTime(s.firstOrderAt)}
                    </dd>
                  </>
                )}
              </dl>

              {s.topProducts.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                    {t('Ихэвчлэн авдаг')}
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {s.topProducts.map((p) => (
                      <li
                        key={p.name}
                        className="border border-rule rounded px-2 py-0.5 text-sm"
                      >
                        {p.name}
                        <span className="ml-1.5 font-mono text-accent-text">
                          ×{p.qty}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-5 text-xs uppercase tracking-wide text-ink-muted mb-2">
                {t('Захиалгууд')}
              </p>
              <ul className="border border-rule rounded divide-y divide-rule">
                {data.orders.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        navigate(`/orders/${o.id}`)
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-bg transition-colors"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm">{o.orderNo}</span>
                        <span className="font-mono text-sm tabular-nums">
                          {formatMoney(o.totalAmount)}
                        </span>
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {formatDateTime(o.createdAt)} · {o.orderStatus} ·{' '}
                        {o.paymentStatus}
                        {o.driverName ? ` · ${o.driverName}` : ''}
                      </span>
                      <span className="block text-xs text-ink-muted truncate">
                        {o.items
                          .map((i) => `${i.productName} ×${i.qty}`)
                          .join(', ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
