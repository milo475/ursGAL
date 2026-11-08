import { useState } from 'react'
import ProductCatalog from './ProductCatalog'
import Button from '../ui/Button'
import Drawer from '../ui/Drawer'
import Input from '../ui/Input'
import Select from '../ui/Select'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LanguageContext'
import { DISTRICTS } from '../../data/aimags'
import { AIMAGS } from '../../data/aimags'
import { khorooList } from '../../data/khoroo'
import { api } from '../../lib/api'
import { CHANNELS } from '../../lib/channels'
import { formatMoney } from '../../lib/format'

/**
 * Захиалга засах (V5).
 *
 * DM-ээр ажилладаг тул «хаягаа буруу хэлсэн», «нэгийг нэмээд өгөөч»
 * нь өдөр тутмын явдал. Өмнө нь баталгаажсаны дараа цуцлаад дахин
 * шивэхээс өөр арга байсангүй — дугаар үсэрч, түүх тасардаг байв.
 *
 * Бараа солиход үлдэгдэл ЗӨРҮҮГЭЭР нь тохируулагдана (backend). Тиймээс
 * энд бүтэн жагсаалтыг илгээнэ.
 */
export default function EditOrderDrawer({ order, onClose, onSaved }) {
  const { t } = useLang()
  const { hasPerm } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showCatalog, setShowCatalog] = useState(false)

  const [f, setF] = useState({
    customerName: order.customerName ?? '',
    customerPhone: order.phone ?? '',
    extraPhone: order.extraPhone ?? '',
    region: order.region,
    district: order.district ?? '',
    khoroo: order.khoroo ?? '',
    building: order.building ?? '',
    entrance: order.entrance ?? '',
    floor: order.floor ?? '',
    door: order.door ?? '',
    province: order.province ?? '',
    soum: order.soum ?? '',
    transport: order.transport ?? '',
    addressDetail: order.addressDetail ?? '',
    note: order.note ?? '',
    channel: order.channel ?? 'OTHER',
  })
  const set = (k) => (e) =>
    setF((p) => ({
      ...p,
      [k]: e.target.value,
      ...(k === 'district' ? { khoroo: '' } : {}),
    }))

  // Бараа: {productId, name, price, qty}
  const [items, setItems] = useState(() =>
    order.items.map((i) => ({
      productId: i.productId,
      name: i.productName,
      price: Number(i.priceAtOrder),
      qty: i.qty,
    })),
  )
  const canEditItems = hasPerm('inventory.view')
  const total = items.reduce((a, i) => a + i.price * i.qty, 0)
  const isUB = f.region === 'ULAANBAATAR'

  const setQty = (productId, qty) =>
    setItems((list) =>
      qty <= 0
        ? list.filter((i) => i.productId !== productId)
        : list.map((i) => (i.productId === productId ? { ...i, qty } : i)),
    )

  function addProduct(p) {
    setItems((list) =>
      list.some((i) => i.productId === p.id)
        ? list.map((i) =>
            i.productId === p.id ? { ...i, qty: i.qty + 1 } : i,
          )
        : [
            ...list,
            { productId: p.id, name: p.name, price: Number(p.price), qty: 1 },
          ],
    )
    setShowCatalog(false)
  }

  async function save() {
    if (items.length === 0) {
      setError(t('Захиалгад дор хаяж 1 бараа байна'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        customerName: f.customerName,
        customerPhone: f.customerPhone,
        extraPhone: f.extraPhone || undefined,
        region: f.region,
        note: f.note,
        channel: f.channel,
        items: items.map((i) => ({ productId: i.productId, qty: i.qty })),
        ...(isUB
          ? {
              district: f.district,
              khoroo: f.khoroo,
              building: f.building,
              entrance: f.entrance || undefined,
              floor: f.floor || undefined,
              door: f.door || undefined,
            }
          : {
              province: f.province,
              soum: f.soum,
              transport: f.transport || undefined,
              addressDetail: f.addressDetail || undefined,
            }),
      }
      await api(`/orders/${order.id}`, { method: 'PATCH', body })
      toast.show(t('Захиалга зассан'))
      onSaved()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Drawer open onClose={onClose} title={`${t('Засах')} — ${order.orderNo}`} width={520}>
      <div className="space-y-5">
        {/* Хүлээн авагч */}
        <section className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-ink-muted">
            {t('Хүлээн авагч')}
          </p>
          <Input
            id="e-name"
            label={t('Нэр')}
            value={f.customerName}
            onChange={set('customerName')}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="e-phone"
              label={t('Утас')}
              value={f.customerPhone}
              onChange={set('customerPhone')}
              inputMode="numeric"
              maxLength={8}
            />
            <Input
              id="e-phone2"
              label={t('Нэмэлт утас')}
              value={f.extraPhone}
              onChange={set('extraPhone')}
              inputMode="numeric"
              maxLength={8}
            />
          </div>
          <Select
            id="e-channel"
            label={t('Суваг')}
            value={f.channel}
            onChange={set('channel')}
          >
            {CHANNELS.map(([k, label]) => (
              <option key={k} value={k}>
                {t(label)}
              </option>
            ))}
          </Select>
        </section>

        {/* Хаяг */}
        <section className="space-y-3 border-t border-rule pt-4">
          <p className="text-xs uppercase tracking-wide text-ink-muted">
            {t('Хүргэлтийн хаяг')}
          </p>
          <Select
            id="e-region"
            label={t('Бүс')}
            value={f.region}
            onChange={set('region')}
          >
            <option value="ULAANBAATAR">{t('Улаанбаатар')}</option>
            <option value="ORON_NUTAG">{t('Орон нутаг')}</option>
          </Select>

          {isUB ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Select
                  id="e-district"
                  label={t('Дүүрэг')}
                  value={f.district}
                  onChange={set('district')}
                >
                  <option value="">—</option>
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Select>
                <Select
                  id="e-khoroo"
                  label={t('Хороо')}
                  value={f.khoroo}
                  onChange={set('khoroo')}
                  disabled={!f.district}
                >
                  <option value="">—</option>
                  {khorooList(f.district).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </Select>
              </div>
              <Input
                id="e-building"
                label={t('Байр / Хороолол / Хашаа')}
                value={f.building}
                onChange={set('building')}
              />
              <div className="grid grid-cols-3 gap-3">
                <Input id="e-entrance" label={t('Орц')} value={f.entrance} onChange={set('entrance')} />
                <Input id="e-floor" label={t('Давхар')} value={f.floor} onChange={set('floor')} />
                <Input id="e-door" label={t('Тоот')} value={f.door} onChange={set('door')} />
              </div>
            </>
          ) : (
            <>
              <Select
                id="e-province"
                label={t('Аймаг')}
                value={f.province}
                onChange={set('province')}
              >
                <option value="">—</option>
                {AIMAGS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </Select>
              <Input id="e-soum" label={t('Сум')} value={f.soum} onChange={set('soum')} />
              <Input id="e-transport" label={t('Тээвэр')} value={f.transport} onChange={set('transport')} />
              <Input
                id="e-detail"
                label={t('Нэмэлт хаяг')}
                value={f.addressDetail}
                onChange={set('addressDetail')}
              />
            </>
          )}
          <Input id="e-note" label={t('Тэмдэглэл')} value={f.note} onChange={set('note')} />
        </section>

        {/* Бараа */}
        <section className="border-t border-rule pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              {t('Бараа')}
            </p>
            {canEditItems && (
              <button
                type="button"
                onClick={() => setShowCatalog((v) => !v)}
                className="text-sm text-accent-text underline underline-offset-2"
              >
                {showCatalog ? t('Хаах') : `+ ${t('Бараа нэмэх')}`}
              </button>
            )}
          </div>

          {showCatalog && (
            <div className="mb-4">
              <ProductCatalog
                onPick={addProduct}
                excludeIds={items.map((i) => i.productId)}
              />
            </div>
          )}

          <ul className="border border-rule rounded divide-y divide-rule">
            {items.map((i) => (
              <li key={i.productId} className="px-3 py-2 flex items-center gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm">{i.name}</span>
                  <span className="font-mono text-xs text-ink-muted">
                    {formatMoney(i.price)}
                  </span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={t('Хасах')}
                    onClick={() => setQty(i.productId, i.qty - 1)}
                    className="w-7 h-7 border border-rule rounded text-ink-muted hover:text-ink"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-mono tabular-nums">
                    {i.qty}
                  </span>
                  <button
                    type="button"
                    aria-label={t('Нэмэх')}
                    onClick={() => setQty(i.productId, i.qty + 1)}
                    className="w-7 h-7 border border-rule rounded text-ink-muted hover:text-ink"
                  >
                    +
                  </button>
                </span>
                <span className="w-24 text-right font-mono text-sm tabular-nums shrink-0">
                  {formatMoney(i.price * i.qty)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-right text-sm">
            {t('Нийт')}
            <span className="ml-2 font-mono text-lg tabular-nums">
              {formatMoney(total)}
            </span>
          </p>
          {Number(order.paidAmount) > 0 && total !== Number(order.totalAmount) && (
            <p className="mt-2 text-xs text-status-preparing">
              {t('Төлсөн дүн {paid} — дүн өөрчлөгдвөл төлбөрийн төлөв дагаж шинэчлэгдэнэ', {
                paid: formatMoney(order.paidAmount),
              })}
            </p>
          )}
        </section>

        {error && (
          <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2 pb-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('Болих')}
          </Button>
          <Button loading={busy} onClick={save}>
            {t('Хадгалах')}
          </Button>
        </div>
      </div>
    </Drawer>
  )
}
