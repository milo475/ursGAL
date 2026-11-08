import { useCallback, useEffect, useState } from 'react'
import DriverOptions from '../components/orders/DriverOptions'
import DriverZones from '../components/warehouse/DriverZones'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { openHandoverSheet } from '../lib/handoverSheet'
import ExpiryAlert from '../components/ExpiryAlert'

/**
 * Няравын ажлын байр (V5).
 *
 * Бэлтгэл — жолооч тус бүрээр НЭГТГЭСЭН бараа харагдана: тухайн жолоочид
 * ямар бараа хэдэн ширхэг явахыг агуулахаас нэг дор түүнэ. Захиалга бүрийг
 * бэлдэж дуусмагц [Бэлэн] дарж төлөв солино.
 *
 * Хүлээлгэн өгөх — жолоочийн бэлэн болсон захиалгуудыг нэг хуудсанд оруулж,
 * хоёр тал дэлгэц дээр гарын үсгээ зурна. Хуудас хэвлэгдэж, захиалгууд
 * ASSIGNED болж жолоочийн апп дээр гарна.
 */
export default function Warehouse() {
  const { t } = useLang()
  const toast = useToast()

  const [tab, setTab] = useState('board')

  return (
    <div>
      <h1 className="font-serif text-4xl font-medium">{t('Нярав')}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {t('Бэлтгэл, жолоочид хүлээлгэн өгөх, хуудасны түүх')}
      </p>

      <ExpiryAlert />

      <div className="mt-8 flex gap-1 border-b border-rule pb-3">
        {[
          ['board', 'Бэлтгэл'],
          ['zones', 'Жолоочийн бүс'],
          ['history', 'Хүлээлгэсэн хуудсууд'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
              tab === key
                ? 'bg-ink text-bg'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {tab === 'board' ? (
        <Board t={t} toast={toast} />
      ) : tab === 'zones' ? (
        <DriverZones />
      ) : (
        <History t={t} toast={toast} />
      )}
    </div>
  )
}

/** Жолоочоор бүлэглэсэн бэлтгэлийн самбар */
function Board({ t, toast }) {
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(null)
  const [handing, setHanding] = useState(null)
  const [assigning, setAssigning] = useState(null)

  const load = useCallback(() => {
    setError(null)
    api(`/warehouse/board${all ? '?all=true' : ''}`)
      .then(setGroups)
      .catch((e) => setError(e))
  }, [all])

  useEffect(() => {
    setGroups(null)
    load()
    window.addEventListener('notif:push', load)
    return () => window.removeEventListener('notif:push', load)
  }, [load])

  async function setStatus(order, orderStatus) {
    setBusy(order.id)
    try {
      await api(`/orders/${order.id}/status`, {
        method: 'PATCH',
        body: { status: orderStatus },
      })
      load()
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <p className="mt-8 text-sm text-alarm border border-alarm rounded px-3 py-2">
        {error.message}
      </p>
    )
  }
  if (groups === null) {
    return (
      <div className="mt-16 flex justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="mt-6">
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
        {t('Надад хуваарилаагүйг ч харах')}
      </label>

      {groups.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={t('Бэлтгэх захиалга алга')}
            note={t('Менежер захиалга хуваарилахад энд гарч ирнэ')}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((g) => (
            <section
              key={g.driverId ?? 'none'}
              className="border border-rule rounded-lg"
            >
              <header className="flex items-center justify-between gap-4 flex-wrap px-4 py-3 border-b border-rule">
                <div>
                  <h2 className="font-serif text-xl font-medium">
                    {g.driverName}
                  </h2>
                  <p className="text-xs text-ink-muted font-mono">
                    {g.orderCount} {t('захиалга')} · {t('бэлэн')} {g.readyCount}
                  </p>
                </div>
                {g.driverId ? (
                  <Button
                    disabled={g.readyCount === 0}
                    onClick={() => setHanding(g)}
                  >
                    {t('Хүлээлгэн өгөх')}
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setAssigning(g)}>
                    🚚 {t('Жолооч хуваарилах')}
                  </Button>
                )}
              </header>

              {/* Нэгтгэсэн бараа — агуулахаас нэг дор түүхэд */}
              <div className="px-4 py-3 border-b border-rule bg-bg/40">
                <p className="text-xs uppercase tracking-wide text-ink-muted">
                  {t('Нийт түүх бараа')}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {g.items.map((i) => (
                    <li
                      key={i.productId}
                      className="border border-rule rounded px-2.5 py-1 text-sm"
                    >
                      {i.name}
                      <span className="ml-2 font-mono tabular-nums text-accent-text">
                        ×{i.qty}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <ul className="divide-y divide-rule">
                {g.orders.map((o) => (
                  <li
                    key={o.id}
                    className="px-4 py-3 flex items-start justify-between gap-4 flex-wrap"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm">
                        {o.orderNo}
                        <span className="ml-2 text-ink-muted">
                          {o.district}
                          {o.khoroo ? ` ${o.khoroo}` : ''}
                        </span>
                      </p>
                      <p className="text-sm">
                        {o.customerName}
                        <span className="ml-2 font-mono text-xs text-ink-muted">
                          {o.phone}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-ink-muted">
                        {o.items
                          .map((i) => `${i.productName} ×${i.qty}`)
                          .join(', ')}
                      </p>
                      {o.note && (
                        <p className="mt-1 text-xs text-ink-muted">✎ {o.note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {o.orderStatus === 'CONFIRMED' && (
                        <Button
                          variant="ghost"
                          loading={busy === o.id}
                          onClick={() => setStatus(o, 'PREPARING')}
                        >
                          {t('Бэлтгэж эхлэх')}
                        </Button>
                      )}
                      {o.orderStatus === 'PREPARING' && (
                        <Button
                          loading={busy === o.id}
                          onClick={() => setStatus(o, 'READY')}
                        >
                          {t('Бэлэн болсон')}
                        </Button>
                      )}
                      {o.orderStatus === 'READY' && (
                        <span className="text-sm text-safe">
                          ✓ {t('Бэлэн')}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {assigning && (
        <AssignDriverBoardModal
          group={assigning}
          t={t}
          toast={toast}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null)
            load()
          }}
        />
      )}

      {handing && (
        <HandoverModal
          group={handing}
          t={t}
          toast={toast}
          onClose={() => setHanding(null)}
          onDone={() => {
            setHanding(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/**
 * Няравын самбараас шууд жолооч оноох (V5).
 * Менежер оноогоогүй үед бэлтгэл зогсдог байсан — «Жолооч хуваарилаагүй»
 * бүлгийн захиалгуудыг нярав өөрөө өгнө. Жолоочдын жагсаалт нь
 * захиалгуудын дүүргээр эрэмбэлэгдэнэ.
 */
function AssignDriverBoardModal({ group, t, toast, onClose, onDone }) {
  const [drivers, setDrivers] = useState(null)
  const [driverId, setDriverId] = useState('')
  const [busy, setBusy] = useState(false)
  const districts = group.orders.map((o) => o.district)

  useEffect(() => {
    api('/drivers')
      .then((list) => setDrivers(list.filter((d) => d.isActive)))
      .catch(() => setDrivers([]))
  }, [])

  async function auto() {
    setBusy(true)
    try {
      const res = await api('/orders/assign-driver/auto', {
        method: 'PATCH',
        body: { orderIds: group.orders.map((o) => o.id) },
      })
      if (res.assigned.length > 0) {
        toast.show(
          t('{n} захиалга бүсээр нь хуваарилагдлаа', { n: res.assigned.length }),
        )
      }
      if (res.skipped.length > 0) {
        toast.show(
          `${t('Үлдсэн')} ${res.skipped.length}: ${res.skipped[0].reason}`,
          { type: 'error' },
        )
      }
      onDone()
    } catch (e) {
      toast.show(e.message, { type: 'error' })
      setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await api('/orders/assign-driver/bulk', {
        method: 'PATCH',
        body: { driverId, orderIds: group.orders.map((o) => o.id) },
      })
      if (res.assigned > 0) {
        toast.show(t('{n} захиалга хуваарилагдлаа', { n: res.assigned }))
      }
      if (res.failed.length > 0) {
        toast.show(res.failed[0].reason, { type: 'error' })
      }
      onDone()
    } catch (e) {
      toast.show(e.message, { type: 'error' })
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('Жолооч хуваарилах')}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-muted">
          {t('Хуваарилаагүй {n} захиалга', { n: group.orders.length })} ·{' '}
          <span className="font-mono">
            {[...new Set(districts.filter(Boolean))].join(', ')}
          </span>
        </p>
        {drivers === null ? (
          <p className="text-sm text-ink-muted">…</p>
        ) : (
          <Select
            id="board-driver"
            label={t('Жолооч')}
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
          >
            <option value="">—</option>
            <DriverOptions drivers={drivers} districts={districts} />
          </Select>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('Болих')}
          </Button>
          <Button variant="ghost" loading={busy} onClick={auto}>
            🎯 {t('Дүүргээр автоматаар')}
          </Button>
          <Button type="submit" loading={busy} disabled={!driverId}>
            {t('Хуваарилах')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Жолоочид хүлээлгэн өгөх цонх — баталгаажмагц хуудас хэвлэгдэнэ */
function HandoverModal({ group, t, toast, onClose, onDone }) {
  const ready = group.orders.filter((o) => o.orderStatus === 'READY')
  const [picked, setPicked] = useState(() => ready.map((o) => o.id))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    try {
      const h = await api('/warehouse/handovers', {
        method: 'POST',
        body: {
          driverId: group.driverId,
          orderIds: picked,
          note: note.trim() || undefined,
        },
      })
      toast.show(t('{no} хуудас үүслээ', { no: h.number }))
      openHandoverSheet(h, t)
      onDone()
    } catch (e) {
      toast.show(e.message, { type: 'error' })
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('Хүлээлгэн өгөх')} — ${group.driverName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Болих')}
          </Button>
          <Button
            loading={saving}
            disabled={picked.length === 0}
            onClick={submit}
          >
            {t('Баталгаажуулж хэвлэх')}
          </Button>
        </>
      }
    >
      <ul className="max-h-40 overflow-y-auto divide-y divide-rule border border-rule rounded">
        {ready.map((o) => (
          <li key={o.id} className="px-3 py-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.includes(o.id)}
                onChange={(e) =>
                  setPicked((p) =>
                    e.target.checked
                      ? [...p, o.id]
                      : p.filter((id) => id !== o.id),
                  )
                }
              />
              <span className="min-w-0">
                <span className="font-mono">{o.orderNo}</span> · {o.customerName}
                <span className="block text-xs text-ink-muted">
                  {o.items.map((i) => `${i.productName} ×${i.qty}`).join(', ')}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('Тэмдэглэл (заавал биш)')}
        className="mt-3 w-full bg-bg border border-rule rounded px-3 py-2 text-sm focus:outline-none focus:border-ink-muted"
      />

      <p className="mt-3 text-xs text-ink-muted">
        {t('Баталгаажуулахад хуудас хэвлэгдэнэ — гарын үсгээ цаасан дээр нь зурна')}
      </p>
    </Modal>
  )
}

/** Хүлээлгэн өгсөн хуудсуудын түүх — дахин хэвлэх боломжтой */
function History({ t, toast }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/warehouse/handovers')
      .then(setRows)
      .catch((e) => setError(e))
  }, [])

  async function reprint(id) {
    try {
      const h = await api(`/warehouse/handovers/${id}`)
      if (!openHandoverSheet(h, t)) {
        toast.show(t('Хэвлэх цонхыг зөвшөөрнө үү'), { type: 'error' })
      }
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    }
  }

  if (error) {
    return (
      <p className="mt-8 text-sm text-alarm border border-alarm rounded px-3 py-2">
        {error.message}
      </p>
    )
  }
  if (rows === null) {
    return (
      <div className="mt-16 flex justify-center">
        <Spinner />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState title={t('Хуудас алга')} />
      </div>
    )
  }

  return (
    <ul className="mt-6 border border-rule rounded-lg divide-y divide-rule">
      {rows.map((h) => (
        <li
          key={h.id}
          className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap"
        >
          <div>
            <p className="font-mono text-sm">{h.number}</p>
            <p className="text-sm text-ink-muted">
              {t('Жолооч')}: {h.driver?.fullName} · {t('Нярав')}:{' '}
              {h.keeper?.fullName} ·{' '}
              <span className="font-mono">
                {h._count.orders} {t('захиалга')}
              </span>
            </p>
            <p className="text-xs text-ink-muted font-mono">
              {formatDateTime(h.handedAt ?? h.createdAt)}
            </p>
          </div>
          <Button variant="ghost" onClick={() => reprint(h.id)}>
            🖨 {t('Хэвлэх')}
          </Button>
        </li>
      ))}
    </ul>
  )
}
