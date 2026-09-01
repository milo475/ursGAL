import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { FileText } from 'lucide-react'
import PaymentBadge from '../../components/orders/PaymentBadge'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import Modal from '../../components/ui/Modal'
import Spinner from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/Toast'
import { useLang } from '../../context/LanguageContext'
import { api, proofSrc } from '../../lib/api'
import { formatDateTime, formatMoney } from '../../lib/format'
import { StatusProgress } from './PortalHome'

/** Компанийн нэр — Бүлэг 6-д Settings-ээс ирнэ */
const COMPANY_NAME = 'ursGAL Дэлгүүр'

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Цэвэрхэн хэвлэх нэхэмжлэхийг шинэ цонхонд нээнэ */
function openInvoice(order, t) {
  const rows = order.items
    .map(
      (i) => `<tr>
        <td>${esc(i.productName)}</td>
        <td class="num">${i.qty}</td>
        <td class="num">${esc(formatMoney(i.priceAtOrder))}</td>
        <td class="num">${esc(formatMoney(i.lineTotal))}</td>
      </tr>`,
    )
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(order.orderNo)}</title>
<style>
  body { font-family: 'Noto Sans', sans-serif; color: #111; margin: 40px; }
  h1 { font-size: 20px; margin: 0; }
  .muted { color: #666; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #111; padding-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 14px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #666;
       border-bottom: 1px solid #ccc; padding: 6px 8px; }
  td { padding: 8px; border-bottom: 1px solid #eee; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .total { margin-top: 16px; text-align: right; font-size: 18px; font-weight: 600; }
  @media print { body { margin: 12mm; } .noprint { display: none; } }
  .noprint { margin-top: 32px; }
  .noprint button { padding: 8px 20px; font-size: 14px; }
</style></head><body>
  <div class="head">
    <div>
      <h1>${esc(COMPANY_NAME)}</h1>
      <p class="muted">${esc(t('Нэхэмжлэх'))}</p>
    </div>
    <div style="text-align:right">
      <p style="font-family:monospace;margin:0">${esc(order.orderNo)}</p>
      <p class="muted">${esc(formatDateTime(order.createdAt))}</p>
    </div>
  </div>
  <table>
    <thead><tr>
      <th>${esc(t('Бараа'))}</th><th class="num">${esc(t('Тоо'))}</th>
      <th class="num">${esc(t('Нэгж үнэ'))}</th><th class="num">${esc(t('Дүн'))}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${
    Number(order.deliveryFee) > 0
      ? `<p class="muted" style="text-align:right;margin:6px 0 0">${esc(t('Хүргэлтийн хөлс'))}: ${esc(formatMoney(order.deliveryFee))}</p>`
      : ''
  }
  <p class="total">${esc(t('Нийт'))}: ${esc(formatMoney(order.totalAmount))}</p>
  <p class="muted" style="text-align:right;margin-top:4px">
    ${esc(t('Төлсөн'))}: ${esc(formatMoney(order.paidAmount ?? 0))} ·
    ${esc(t('pay.remaining'))}: ${esc(formatMoney(Number(order.totalAmount) - Number(order.paidAmount ?? 0)))}
  </p>
  <div class="noprint"><button onclick="window.print()">🖨 ${esc(t('Хэвлэх'))}</button></div>
</body></html>`
  const w = window.open('', '_blank', 'width=760,height=900')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

export default function PortalOrderDetail() {
  const { id } = useParams()
  const { t } = useLang()
  const toast = useToast()

  const [order, setOrder] = useState(null)
  const [error, setError] = useState(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [proofOpen, setProofOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(null)
    api(`/portal/orders/${id}`)
      .then(setOrder)
      .catch((e) => setError(e))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function cancelOrder() {
    setBusy(true)
    try {
      await api(`/portal/orders/${id}/cancel`, { method: 'PATCH' })
      toast.show(t('Захиалга цуцлагдаж, үлдэгдэл буцаан нэмэгдлээ'))
      setCancelOpen(false)
      load()
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <EmptyState
        title={t('Захиалга ачаалж чадсангүй')}
        note={error.message}
        action={
          <Link to="/portal/orders" className="text-accent underline">
            {t('← Миний захиалгууд')}
          </Link>
        }
      />
    )
  }
  if (!order) {
    return (
      <div className="py-16 text-center">
        <Spinner size={22} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <Link
        to="/portal/orders"
        className="text-sm text-ink-muted hover:text-ink"
      >
        {t('← Миний захиалгууд')}
      </Link>

      <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-mono text-3xl tabular-nums">{order.orderNo}</h1>
        <span className="flex items-center gap-2">
          <Badge status={order.orderStatus} />
          <Badge status={order.deliveryStatus} />
        </span>
      </div>

      {/* Захиалгын явц (tracking) */}
      <section className="mt-8 bg-surface border border-rule rounded-lg p-5">
        <StatusProgress status={order.orderStatus} t={t} />
        <div className="mt-5 border-t border-rule pt-4 space-y-2 text-sm">
          <p className="text-ink-muted">{order.fullAddress}</p>
          {order.assignedDriver && (
            <p>
              {t('Жолооч')}:{' '}
              <span className="font-medium">
                {order.assignedDriver.fullName}
              </span>
            </p>
          )}
          {order.deliveredAt && (
            <p className="font-mono text-xs text-ink-muted tabular-nums">
              {t('Хүргэсэн огноо')}: {formatDateTime(order.deliveredAt)}
            </p>
          )}
          {order.deliveryProofUrl && (
            <button type="button" onClick={() => setProofOpen(true)}>
              <img
                src={proofSrc(order.deliveryProofUrl)}
                alt={t('Баталгаажуулах зураг')}
                className="h-24 rounded border border-rule hover:opacity-80 transition-opacity"
              />
            </button>
          )}
        </div>
      </section>

      {/* Items + нийт */}
      <section className="mt-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-ink-muted border-b border-rule">
              <th className="text-left font-normal py-2">{t('Бараа')}</th>
              <th className="text-right font-normal py-2 px-3">{t('Тоо')}</th>
              <th className="text-right font-normal py-2">{t('Дүн')}</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-rule">
                <td className="py-2.5 font-sans">{item.productName}</td>
                <td className="text-right px-3">{item.qty}</td>
                <td className="text-right">{formatMoney(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 space-y-1 text-right">
          {Number(order.deliveryFee) > 0 && (
            <p className="text-sm text-ink-muted">
              {t('Хүргэлтийн хөлс')}
              <span className="font-mono tabular-nums ml-3 text-ink">
                {formatMoney(order.deliveryFee)}
              </span>
            </p>
          )}
          <p className="flex justify-end items-baseline gap-3">
            <span className="text-sm text-ink-muted">{t('Нийт')}</span>
            <span className="font-mono text-2xl tabular-nums">
              {formatMoney(order.totalAmount)}
            </span>
          </p>
        </div>

        {/* Төлбөрийн байдал */}
        <div className="mt-3 flex justify-end items-center gap-3 text-sm">
          <PaymentBadge status={order.paymentStatus} />
          {order.paymentStatus !== 'PAID' && (
            <span className="text-ink-muted">
              {t('pay.remaining')}:{' '}
              <span className="font-mono tabular-nums text-alarm">
                {formatMoney(
                  Number(order.totalAmount) - Number(order.paidAmount ?? 0),
                )}
              </span>
            </span>
          )}
        </div>
      </section>

      {/* Үйлдлүүд */}
      <section className="mt-8 border-t border-rule pt-6 flex items-center gap-3">
        <Button variant="ghost" onClick={() => openInvoice(order, t)}>
          <FileText size={16} />
          {t('Нэхэмжлэх харах')}
        </Button>
        {order.canCancel && (
          <Button
            variant="danger"
            onClick={() => setCancelOpen(true)}
            className="ml-auto"
          >
            {t('Цуцлах')}
          </Button>
        )}
      </section>

      <Modal
        open={proofOpen}
        onClose={() => setProofOpen(false)}
        title={t('Баталгаажуулах зураг')}
      >
        {order.deliveryProofUrl && (
          <img
            src={proofSrc(order.deliveryProofUrl)}
            alt={t('Баталгаажуулах зураг')}
            className="w-full rounded"
          />
        )}
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        title={t('Захиалга цуцлах')}
        message={t('Үлдэгдэл буцаан нэмэгдэнэ. Цуцлах уу?')}
        confirmLabel={t('Цуцлах')}
        danger
        loading={busy}
        onConfirm={cancelOrder}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  )
}
