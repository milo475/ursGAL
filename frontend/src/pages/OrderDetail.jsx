import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import AssignDriverModal from '../components/orders/AssignDriverModal'
import PaymentBadge from '../components/orders/PaymentBadge'
import RegionBadge from '../components/orders/RegionBadge'
import ReturnBadge from '../components/orders/ReturnBadge'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Badge from '../components/ui/Badge'
import DmReplyModal from '../components/orders/DmReplyModal'
import Button from '../components/ui/Button'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import Modal from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useLang } from '../context/LanguageContext'
import CustomerHistoryModal from '../components/customers/CustomerHistoryModal'
import EditOrderDrawer from '../components/orders/EditOrderDrawer'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { formatDateTime, formatMoney } from '../lib/format'
import { openPickingSheet } from '../lib/pickingSheet'
import { channelLabel, channelStyle } from '../lib/channels'
import { TRANSITIONS, TRANSITION_LABELS } from '../lib/orderStatus'

function InfoItem({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1">{value}</p>
    </div>
  )
}

export default function OrderDetail() {
  const { id } = useParams()
  const toast = useToast()
  const { user, hasPerm } = useAuth()
  const { t } = useLang()

  const [order, setOrder] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  // Хүсэлтийг батласны дараа шууд хуваарилах цонхтой ирнэ (V5)
  const { state: navState } = useLocation()
  const [proofOpen, setProofOpen] = useState(false)
  const [history, setHistory] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [dmOpen, setDmOpen] = useState(false)

  const load = useCallback(() => {
    setError(null)
    api(`/orders/${id}`)
      .then(setOrder)
      .catch((e) => setError(e))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Батласны дараа ирсэн бол хуваарилах цонхыг өөрөө нээнэ — гэхдээ
  // захиалга ачаалагдаж, жолоочгүй нь тодорхой болсны дараа
  useEffect(() => {
    if (navState?.assign && order && !order.assignedDriver) {
      setAssignOpen(true)
    }
  }, [navState, order])

  /**
   * Бэлтгэх хуудас хэвлэх. Orders.jsx-тэй ижил: SKU-г бараануудаас
   * best-effort татаж дамжуулна (өмнө нь 3 дахь аргумент дамждаггүй
   * тул SKU багана үргэлж хоосон гардаг байсан), popup хаагдсан бол
   * чимээгүй өнгөрөхгүй.
   */
  const [printing, setPrinting] = useState(false)
  async function printPickingSheet() {
    setPrinting(true)
    try {
      const skuById = {}
      if (hasPerm('inventory.view')) {
        const pids = [...new Set(order.items.map((i) => i.productId))]
        await Promise.all(
          pids.slice(0, 30).map((pid) =>
            api(`/products/${pid}`)
              .then((p) => {
                skuById[pid] = p.sku
              })
              .catch(() => {}),
          ),
        )
      }
      if (!openPickingSheet([order], t, skuById)) {
        toast.show(t('Popup хориглогдсон — зөвшөөрнө үү'), { type: 'error' })
      }
    } finally {
      setPrinting(false)
    }
  }

  async function transition(status) {
    setBusy(true)
    try {
      await api(`/orders/${id}/status`, { method: 'PATCH', body: { status } })
      toast.show(
        status === 'CANCELLED'
          ? t('Захиалга цуцлагдаж, үлдэгдэл буцаан нэмэгдлээ')
          : t('Статус шинэчлэгдлээ'),
      )
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
        action={<Button onClick={load}>{t('Дахин оролдох')}</Button>}
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

  // Frontend талд зөвхөн харагдах товчнууд — жинхэнэ шалгалт backend-д.
  // OPERATOR-ийн "зөвхөн өөрийн захиалга" ownership шалгалт хэвээр,
  // бусад нь effective permission-оор.
  const canManage =
    hasPerm('orders.change_status') &&
    (user?.role !== 'OPERATOR' || order.createdBy?.id === user?.id)
  const nextStatuses = canManage ? (TRANSITIONS[order.orderStatus] ?? []) : []
  // Цуцлах нь тусдаа эрх (V5) — нярав төлөв ахиулна, цуцлахгүй
  const canCancel =
    nextStatuses.includes('CANCELLED') && hasPerm('orders.cancel')
  const canAssign =
    hasPerm('orders.assign_driver') &&
    (order.orderStatus === 'CONFIRMED' || order.orderStatus === 'PREPARING')

  /**
   * Товчны хэт олон сонголтыг цэгцлэв (V5):
   * 1) Жолоочгүй байхад хийх ганц зүйл нь ЖОЛООЧ ХУВААРИЛАХ — бэлтгэлийн
   *    товчнууд түүнээс өмнө утгагүй тул нуугдана.
   * 2) «Бэлтгэж эхлэх»/«Бэлэн болсон» нь НЯРАВЫН алхмууд — тэднийхээ
   *    самбар дээр байдаг. Няравын эрхгүй хүнд эндээс харагдахгүй,
   *    оронд нь шууд «Дуусгах».
   */
  const isKeeper = hasPerm('warehouse.handover')
  /** Дууссан/цуцалсан захиалга хөшинө — backend-тэй ижил жагсаалт */
  const canEdit =
    hasPerm('orders.edit') &&
    ['NEW', 'CONFIRMED', 'PREPARING', 'READY'].includes(order.orderStatus)
  const needsDriver = canAssign && !order.assignedDriver
  const forward = nextStatuses.filter((s) => {
    if (s === 'CANCELLED') return false
    if (needsDriver) return false
    if (!isKeeper && (s === 'PREPARING' || s === 'READY')) return false
    return true
  })

  return (
    <div className="max-w-3xl">
      <Link to="/orders" className="text-sm text-ink-muted hover:text-ink">
        {t('← Захиалгын жагсаалт')}
      </Link>

      <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-mono text-3xl tabular-nums">{order.orderNo}</h1>
        <span className="flex items-center gap-2">
          <Badge status={order.orderStatus} />
          <Badge status={order.deliveryStatus} />
          <ReturnBadge state={order.returnState} />
          <span
            className={`inline-flex font-mono text-[10px] uppercase tracking-wide border rounded px-1 py-0.5 ${channelStyle(order.channel)}`}
          >
            {t(channelLabel(order.channel))}
          </span>
          {/* Үйлчлүүлэгч рүү илгээх хариу (V5).
              NEW дээр харагдахгүй — хараахан баталгаажаагүй захиалгыг
              «баталгаажлаа» гэж бичих нь худал болно. */}
          {!['NEW', 'CANCELLED'].includes(order.orderStatus) && (
            <Button variant="ghost" onClick={() => setDmOpen(true)}>
              💬 {t('Хариу хуулах')}
            </Button>
          )}
          {/* Бэлтгэх хуудас (V4-11) — нэг захиалгаар */}
          {['CONFIRMED', 'PREPARING'].includes(order.orderStatus) && (
            <Button
              variant="ghost"
              loading={printing}
              onClick={printPickingSheet}
            >
              🖨 {t('Бэлтгэх хуудас')}
            </Button>
          )}
        </span>
      </div>

      {/* Толгой мэдээлэл */}
      <section className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-5">
        <InfoItem label={t('Хүлээн авагч')} value={order.customerName} />
        <InfoItem
          label={t('Утас')}
          value={
            hasPerm('customers.view') ? (
              <button
                type="button"
                onClick={() => setHistory(true)}
                title={t('Худалдан авалтын түүх')}
                className="font-mono tabular-nums text-accent underline underline-offset-2"
              >
                {order.phone}
              </button>
            ) : (
              <span className="font-mono tabular-nums">{order.phone}</span>
            )
          }
        />
        <InfoItem
          label={t('Огноо')}
          value={
            <span className="font-mono text-sm tabular-nums">
              {formatDateTime(order.createdAt)}
            </span>
          }
        />
        <InfoItem
          label={t('Үүсгэсэн')}
          value={order.createdBy?.fullName ?? '—'}
        />
        {order.extraPhone && (
          <InfoItem
            label={t('Нэмэлт утас')}
            value={
              <span className="font-mono tabular-nums">{order.extraPhone}</span>
            }
          />
        )}
        {order.note && <InfoItem label={t('Тэмдэглэл')} value={order.note} />}
      </section>

      {/* Хүргэлтийн хаяг — бүтэцлэгдсэн, талбар тус бүр label-тай */}
      <section className="mt-10 border-t border-rule pt-6">
        <p className="text-xs uppercase tracking-wide text-ink-muted mb-2 flex items-center gap-2">
          {t('Хүргэлтийн хаяг')}
          <RegionBadge region={order.region} />
        </p>
        {/* Backend-ийн угсарсан fullAddress — нэг мөр тойм */}
        <p className="mb-5 text-base">{order.fullAddress}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-5">
          {order.region === 'ULAANBAATAR' ? (
            <>
              <InfoItem label={t('Дүүрэг')} value={order.district} />
              <InfoItem label={t('Хороо')} value={order.khoroo} />
              <InfoItem
                label={t('Барилга/Хороолол/Хашаа')}
                value={order.building}
              />
              <InfoItem label={t('Орц')} value={order.entrance} />
              <InfoItem label={t('Давхар')} value={order.floor} />
              <InfoItem label={t('Хаалга')} value={order.door} />
            </>
          ) : (
            <>
              <InfoItem label={t('Аймаг')} value={order.province} />
              <InfoItem label={t('Сум/Суурин газар')} value={order.soum} />
              {/* Тээвэр тод — жолооч биш ачааны тээврээр явна */}
              <div>
                <p className="text-xs uppercase tracking-wide text-accent">
                  {t('Ачаа явах тээвэр')}
                </p>
                <p className="mt-1 text-lg font-medium text-accent">
                  {order.transport}
                </p>
              </div>
              {order.addressDetail && (
                <InfoItem
                  label={t('Хаягийн дэлгэрэнгүй')}
                  value={order.addressDetail}
                />
              )}
            </>
          )}
        </div>
      </section>

      {/* Item-ууд — захиалга үүсэх үеийн snapshot утгууд */}
      <section className="mt-10 border-t border-rule pt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-ink-muted border-b border-rule">
              <th className="text-left font-normal py-2">{t('Бараа')}</th>
              <th className="text-right font-normal py-2 px-3">{t('Нэгж үнэ')}</th>
              <th className="text-right font-normal py-2 px-3">{t('Тоо')}</th>
              <th className="text-right font-normal py-2">{t('Дүн')}</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-rule">
                <td className="py-2.5 font-sans">{item.productName}</td>
                <td className="text-right px-3">
                  {formatMoney(item.priceAtOrder)}
                </td>
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
      </section>

      {/* Төлбөр (v4): орлого = төлбөр */}
      <PaymentSection
        order={order}
        onChanged={load}
        t={t}
        toast={toast}
        hasPerm={hasPerm}
      />

      {/* Буцаалт (v4) */}
      <ReturnSection
        order={order}
        onChanged={load}
        t={t}
        toast={toast}
        hasPerm={hasPerm}
      />

      {/* Хүргэлтийн мэдээлэл */}
      {(order.assignedDriver || order.deliveryProofUrl || order.deliveryNote) && (
        <section className="mt-10 border-t border-rule pt-6">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-4">
            {t('Хүргэлтийн мэдээлэл')}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-5">
            {order.assignedDriver && (
              <InfoItem label={t('Жолооч')} value={order.assignedDriver.fullName} />
            )}
            {order.assignedAt && (
              <InfoItem
                label={t('Хуваарилсан')}
                value={
                  <span className="font-mono text-sm tabular-nums">
                    {formatDateTime(order.assignedAt)}
                  </span>
                }
              />
            )}
            {order.deliveredAt && (
              <InfoItem
                label={t('Хүргэсэн огноо')}
                value={
                  <span className="font-mono text-sm tabular-nums">
                    {formatDateTime(order.deliveredAt)}
                  </span>
                }
              />
            )}
            {order.deliveryNote && (
              <InfoItem label={t('Тэмдэглэл')} value={order.deliveryNote} />
            )}
          </div>
          {order.deliveryProofUrl && (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                {t('Баталгаажуулах зураг')}
              </p>
              <button type="button" onClick={() => setProofOpen(true)}>
                <img
                  src={order.deliveryProofUrl}
                  alt={t('Баталгаажуулах зураг')}
                  className="h-24 rounded border border-rule hover:opacity-80 transition-opacity"
                />
              </button>
            </div>
          )}
        </section>
      )}

      {/* Статусын шилжилтийн товчнууд */}
      {(forward.length > 0 || canCancel || canAssign || canEdit) && (
        <section className="mt-10 border-t border-rule pt-6 flex items-center gap-3">
          {forward.map((s) => (
            <Button key={s} loading={busy} onClick={() => transition(s)}>
              {t(TRANSITION_LABELS[s])}
            </Button>
          ))}
          {canAssign && (
            <Button
              variant={needsDriver ? 'primary' : 'ghost'}
              onClick={() => setAssignOpen(true)}
            >
              {/* ОН-д ачааны тээврээр явдаг тул текст өөр, үйлдэл адилхан */}
              {order.region === 'ORON_NUTAG'
                ? t('Тээвэрт гаргах')
                : t('Жолооч хуваарилах')}
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" onClick={() => setEditOpen(true)}>
              ✎ {t('Засах')}
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => setCancelOpen(true)}
              className="ml-auto"
            >
              {t('Цуцлах')}
            </Button>
          )}
        </section>
      )}

      {dmOpen && (
        <DmReplyModal order={order} onClose={() => setDmOpen(false)} />
      )}

      {assignOpen && (
        <AssignDriverModal
          order={order}
          onClose={() => setAssignOpen(false)}
          onDone={() => {
            setAssignOpen(false)
            load()
          }}
        />
      )}

      <Modal
        open={proofOpen}
        onClose={() => setProofOpen(false)}
        title={t('Баталгаажуулах зураг')}
      >
        {order.deliveryProofUrl && (
          <img
            src={order.deliveryProofUrl}
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
        onConfirm={() => transition('CANCELLED')}
        onCancel={() => setCancelOpen(false)}
      />
      {editOpen && (
        <EditOrderDrawer
          order={order}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            load()
          }}
        />
      )}

      {history && (
        <CustomerHistoryModal
          phone={order.phone}
          name={order.customerName}
          onClose={() => setHistory(false)}
        />
      )}
    </div>
  )
}

/**
 * Төлбөр зөвхөн ШИЛЖҮҮЛЭГ (V5) — компани бэлэн мөнгөөр үйлчлэхгүй.
 * Сонголт байхгүй тул алдаа гарах, зөрчих ч боломжгүй.
 */
const methodLabel = (m) => (m === 'TRANSFER' ? 'pay.transfer' : m)

/** Төлбөрийн хэсэг: статус, дүнгүүд, түүх, бүртгэх/устгах */
function PaymentSection({ order, onChanged, t, toast, hasPerm }) {
  const [formOpen, setFormOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(null) // устгах гэж буй төлбөр

  const canPay = hasPerm('finance.create_income')
  const remaining =
    Number(order.totalAmount) - Number(order.paidAmount ?? 0)

  function openForm() {
    setAmount(String(remaining))
    setNote('')
    setError(null)
    setFormOpen(true)
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api(`/orders/${order.id}/payments`, {
        method: 'POST',
        body: {
          amount: amount.trim(),
          method: 'TRANSFER', // бэлэн мөнгө системд байхгүй (V5)
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })
      toast.show(t('Төлбөр бүртгэгдлээ'))
      setFormOpen(false)
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api(`/payments/${deleting.id}`, { method: 'DELETE' })
      toast.show(t('Төлбөрийн бүртгэл устлаа'))
      setDeleting(null)
      onChanged()
    } catch (err) {
      toast.show(err.message, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-10 border-t border-rule pt-6">
      <p className="text-xs uppercase tracking-wide text-ink-muted mb-4 flex items-center gap-2">
        {t('Төлбөр')}
        <PaymentBadge status={order.paymentStatus} />
      </p>

      <div className="grid grid-cols-3 gap-x-6 max-w-md">
        <InfoItem
          label={t('Нийт')}
          value={
            <span className="font-mono tabular-nums">
              {formatMoney(order.totalAmount)}
            </span>
          }
        />
        <InfoItem
          label={t('Төлсөн')}
          value={
            <span className="font-mono tabular-nums text-safe">
              {formatMoney(order.paidAmount ?? 0)}
            </span>
          }
        />
        <InfoItem
          label={t('pay.remaining')}
          value={
            <span
              className={`font-mono tabular-nums ${remaining > 0 ? 'text-alarm' : ''}`}
            >
              {formatMoney(remaining)}
            </span>
          }
        />
      </div>

      {/* Төлбөрийн түүх */}
      {order.payments?.length > 0 && (
        <ul className="mt-4 divide-y divide-rule border-y border-rule max-w-xl">
          {order.payments.map((p) => (
            <li key={p.id} className="py-2 flex items-center gap-3 text-sm">
              <span className="font-mono text-xs text-ink-muted tabular-nums">
                {formatDateTime(p.createdAt)}
              </span>
              <span className="font-mono text-[10px] uppercase border border-rule rounded px-1 py-0.5 text-ink-muted">
                {t(methodLabel(p.method))}
              </span>
              <span className="flex-1 truncate text-ink-muted">
                {p.note ?? ''} {p.receivedBy && `· ${p.receivedBy.fullName}`}
              </span>
              <span className="font-mono tabular-nums">
                {formatMoney(p.amount)}
              </span>
              {canPay && (
                <button
                  type="button"
                  onClick={() => setDeleting(p)}
                  aria-label={t('Төлбөр устгах')}
                  className="text-ink-muted hover:text-alarm px-1"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canPay &&
        order.paymentStatus !== 'PAID' &&
        order.orderStatus !== 'CANCELLED' && (
          <Button onClick={openForm} className="mt-4">
            {t('Төлбөр бүртгэх')}
          </Button>
        )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={`${t('Төлбөр бүртгэх')} — ${order.orderNo}`}
      >
        <form onSubmit={submit} className="space-y-4">
          <Input
            id="pay-amount"
            label={t('Дүн')}
            required
            inputMode="decimal"
            pattern="\d{1,10}(\.\d{1,2})?"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-mono"
          />
          <p className="text-sm text-ink-muted">
            {t('Хэлбэр')}: {t('pay.transfer')}
          </p>
          <Input
            id="pay-note"
            label={t('Тэмдэглэл')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setFormOpen(false)}
              disabled={busy}
            >
              {t('Болих')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('Хадгалах')}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title={t('Төлбөр устгах')}
        message={t(
          'Энэ төлбөрийн бүртгэлийг устгахдаа итгэлтэй байна уу? Орлого нь хамт хасагдана.',
        )}
        confirmLabel={t('Устгах')}
        danger
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </section>
  )
}

/** Буцаалтын хэсэг: түүх + бүртгэх modal (мөр сонгож, тоо зааж буцаана) */
function ReturnSection({ order, onChanged, t, toast, hasPerm }) {
  const [formOpen, setFormOpen] = useState(false)
  const [rows, setRows] = useState({}) // orderItemId -> qty (сонгосон мөрүүд)
  const [reason, setReason] = useState('')
  const [restock, setRestock] = useState(true)
  const [refundPayment, setRefundPayment] = useState(true)
  const [excludePayroll, setExcludePayroll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Мөр бүрээр аль хэдийн буцаагдсан тоо
  const returnedSoFar = {}
  for (const r of order.returns ?? []) {
    for (const ri of r.items) {
      returnedSoFar[ri.orderItemId] = (returnedSoFar[ri.orderItemId] ?? 0) + ri.qty
    }
  }
  const itemName = (orderItemId) =>
    order.items.find((i) => i.id === orderItemId)?.productName ?? '?'

  const finished =
    order.orderStatus === 'COMPLETED' || order.deliveryStatus === 'DELIVERED'
  const canReturn =
    hasPerm('orders.refund') &&
    finished &&
    order.orderStatus !== 'CANCELLED' &&
    order.returnState !== 'FULL'
  const returns = order.returns ?? []
  if (!canReturn && returns.length === 0) return null

  function openForm() {
    setRows({})
    setReason('')
    setRestock(true)
    setRefundPayment(Number(order.paidAmount ?? 0) > 0)
    setExcludePayroll(false)
    setError(null)
    setFormOpen(true)
  }

  function toggleRow(item, checked) {
    setRows((prev) => {
      const next = { ...prev }
      if (checked) next[item.id] = item.qty - (returnedSoFar[item.id] ?? 0)
      else delete next[item.id]
      return next
    })
  }

  async function submit(e) {
    e.preventDefault()
    const items = Object.entries(rows).map(([orderItemId, qty]) => ({
      orderItemId,
      qty: Number(qty),
    }))
    if (items.length === 0) {
      setError(t('Буцаах бараа сонгоно уу'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api(`/orders/${order.id}/return`, {
        method: 'POST',
        body: {
          items,
          reason: reason.trim(),
          restock,
          refundPayment,
          excludeFromPayroll: excludePayroll,
        },
      })
      toast.show(t('Буцаалт бүртгэгдлээ'))
      setFormOpen(false)
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-10 border-t border-rule pt-6">
      <p className="text-xs uppercase tracking-wide text-ink-muted mb-4 flex items-center gap-2">
        {t('Буцаалт')}
        <ReturnBadge state={order.returnState} />
      </p>

      {/* Буцаалтын түүх */}
      {returns.length > 0 && (
        <ul className="divide-y divide-rule border-y border-rule max-w-xl">
          {returns.map((r) => (
            <li key={r.id} className="py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-ink-muted tabular-nums">
                  {formatDateTime(r.createdAt)}
                </span>
                <span className="flex-1 truncate">
                  {r.reason} {r.createdBy && (
                    <span className="text-ink-muted">· {r.createdBy.fullName}</span>
                  )}
                </span>
                <span className="font-mono tabular-nums text-alarm">
                  −{formatMoney(r.refundAmount)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                {r.items.map((ri) => (
                  <span key={ri.id} className="border border-rule rounded px-1.5 py-0.5">
                    {itemName(ri.orderItemId)} ×{ri.qty}
                  </span>
                ))}
                {r.restocked && (
                  <span className="text-safe">{t('ret.restocked')}</span>
                )}
                {r.excludeFromPayroll && (
                  <span className="text-alarm">{t('ret.excluded')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canReturn && (
        <Button onClick={openForm} className="mt-4" variant="ghost">
          {t('Буцаалт бүртгэх')}
        </Button>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={`${t('Буцаалт бүртгэх')} — ${order.orderNo}`}
      >
        <form onSubmit={submit} className="space-y-4">
          {/* Мөр сонголт: checkbox + буцаах тоо */}
          <div className="divide-y divide-rule border-y border-rule">
            {order.items.map((item) => {
              const left = item.qty - (returnedSoFar[item.id] ?? 0)
              const checked = item.id in rows
              return (
                <label
                  key={item.id}
                  className={`flex items-center gap-3 py-2 text-sm ${left === 0 ? 'opacity-40' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    disabled={left === 0}
                    checked={checked}
                    onChange={(e) => toggleRow(item, e.target.checked)}
                    className="accent-accent"
                  />
                  <span className="flex-1">
                    {item.productName}
                    <span className="ml-2 text-xs text-ink-muted">
                      {t('ret.left')}: {left}/{item.qty}
                    </span>
                  </span>
                  {checked && (
                    <input
                      type="number"
                      min={1}
                      max={left}
                      value={rows[item.id]}
                      onChange={(e) =>
                        setRows((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="w-16 rounded border border-rule bg-transparent px-2 py-1 font-mono text-right"
                    />
                  )}
                </label>
              )
            })}
          </div>

          <Input
            id="ret-reason"
            label={t('Шалтгаан')}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={restock}
                onChange={(e) => setRestock(e.target.checked)}
                className="accent-accent"
              />
              {t('Үлдэгдэлд буцаан нэмэх')}
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={refundPayment}
                onChange={(e) => setRefundPayment(e.target.checked)}
                className="accent-accent"
              />
              {t('Төлсөн дүнгээс буцаан олгох')}
            </label>
            <label
              className={`flex items-center gap-2 ${order.payoutId ? 'opacity-40' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                disabled={!!order.payoutId}
                checked={excludePayroll}
                onChange={(e) => setExcludePayroll(e.target.checked)}
                className="accent-accent"
              />
              {t('Жолоочийн цалингийн тооцооноос хасах')}
              {order.payoutId && (
                <span className="text-xs text-ink-muted">
                  ({t('тооцоо хаагдсан')})
                </span>
              )}
            </label>
          </div>

          {error && (
            <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setFormOpen(false)}
              disabled={busy}
            >
              {t('Болих')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('Хадгалах')}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  )
}
