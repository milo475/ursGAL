import { useState } from 'react'
import { useNavigate } from 'react-router'
import ProductCatalog from '../components/orders/ProductCatalog'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import { useToast } from '../components/ui/Toast'
import { useLang } from '../context/LanguageContext'
import { AIMAGS, DISTRICTS } from '../data/aimags'
import { khorooList } from '../data/khoroo'
import { formatFullAddress } from '../lib/address'
import { api } from '../lib/api'
import { formatMoney } from '../lib/format'
import { CHANNELS } from '../lib/channels'

const PHONE_RE = /^\d{8}$/

/** УБ горимын заавал талбарууд + монгол алдааны мессежүүд */
const UB_REQUIRED = {
  district: 'Дүүрэг заавал',
  khoroo: 'Хороо заавал',
  building: 'Барилга/Хороолол/Хашаа заавал',
  entrance: 'Орц заавал',
  floor: 'Давхар заавал',
  door: 'Хаалга заавал',
}
const ON_REQUIRED = {
  province: 'Аймаг заавал',
  soum: 'Сум/Суурин газар заавал',
  transport: 'Ачаа явах тээвэр заавал',
}

const EMPTY_FORM = {
  region: 'ULAANBAATAR',
  // УБ
  district: '',
  khoroo: '',
  building: '',
  entrance: '',
  floor: '',
  door: '',
  // Орон нутаг
  province: '',
  soum: '',
  transport: '',
  addressDetail: '',
  // Хүлээн авагч
  customerName: '',
  customerPhone: '',
  extraPhone: '',
  note: '',
}

/** Алхмын заагч */
function Stepper({ step, onBack, t }) {
  const steps = ['Хаяг, хүлээн авагч', 'Бараа сонгох']
  return (
    <div className="mt-6 flex items-center gap-3">
      {steps.map((label, i) => {
        const n = i + 1
        const active = step === n
        const done = step > n
        return (
          <button
            key={label}
            type="button"
            disabled={!done}
            onClick={() => done && onBack(n)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded border text-sm transition-colors ${
              active
                ? 'border-accent/50 text-accent-text bg-accent/12'
                : done
                  ? 'border-rule text-ink hover:border-ink-muted'
                  : 'border-rule text-ink-muted'
            }`}
          >
            <span
              className={`font-mono w-5 h-5 rounded-full border flex items-center justify-center text-xs ${
                active
                  ? 'border-accent/60 text-accent-text'
                  : 'border-rule text-ink-muted'
              }`}
            >
              {done ? '✓' : n}
            </span>
            {t(label)}
          </button>
        )
      })}
    </div>
  )
}

export default function OrderNew() {
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useLang()

  const [step, setStep] = useState(1)
  // Нэг state — алхам хооронд болон горим солиход утга алдагдахгүй
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM }))
  const [errors, setErrors] = useState({})
  const [items, setItems] = useState([])
  const [submitting, setSubmitting] = useState(false)
  // Төлбөр төлсөн эсэх — "Төлсөн" бол бүтэн төлбөр захиалгатай хамт бүртгэгдэнэ
  const [channel, setChannel] = useState('INSTAGRAM')
  const [paid, setPaid] = useState(false)

  const isUB = form.region === 'ULAANBAATAR'
  const set = (key) => (e) => {
    const value = e.target.value
    setForm((f) => ({
      ...f,
      [key]: value,
      // Дүүрэг солигдвол хуучин дүүргийн хороо утгагүй болно
      ...(key === 'district' ? { khoroo: '' } : {}),
    }))
    setErrors((er) => ({ ...er, [key]: undefined }))
  }

  /** Алхам 1-ийн client талын шалгалт — горимоо дагасан */
  function validateStep1() {
    const er = {}
    const required = isUB ? UB_REQUIRED : ON_REQUIRED
    for (const [key, msg] of Object.entries(required)) {
      if (!String(form[key]).trim()) er[key] = t(msg)
    }
    if (!PHONE_RE.test(form.customerPhone)) {
      er.customerPhone = t('Утасны дугаар 8 оронтой тоо байна')
    }
    if (form.extraPhone && !PHONE_RE.test(form.extraPhone)) {
      er.extraPhone = t('Нэмэлт утас 8 оронтой тоо байна')
    }
    setErrors(er)
    return Object.keys(er).length === 0
  }

  function goStep2() {
    if (validateStep1()) setStep(2)
  }

  // ── Алхам 2-ын барааны логик ──
  function addProduct(product) {
    setItems((list) =>
      list.some((i) => i.product.id === product.id)
        ? list
        : [...list, { product, qty: 1 }],
    )
  }
  const setQty = (productId, qty) =>
    setItems((list) =>
      list.map((i) => (i.product.id === productId ? { ...i, qty } : i)),
    )
  const removeItem = (productId) =>
    setItems((list) => list.filter((i) => i.product.id !== productId))

  // Хүргэлтийн хөлс шинэ захиалгад нэмэгдэхгүй — нийт = барааны нийлбэр
  const total = items.reduce(
    (a, i) => a + Number(i.product.price) * (Number(i.qty) || 0),
    0,
  )
  const canSubmit =
    items.length > 0 &&
    items.every((i) => Number.isInteger(Number(i.qty)) && Number(i.qty) >= 1)

  /** 400-ийн мессеж аль алхамд хамаарахыг таамаглана */
  function stepForError(message) {
    const step1Words = [
      'Дүүрэг', 'Хороо', 'Барилга', 'Орц', 'Давхар', 'Хаалга',
      'Аймаг', 'Сум', 'тээвэр', 'утас', 'Утас', 'нэр', 'Бүс',
    ]
    return step1Words.some((w) => message.includes(w)) ? 1 : 2
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      // Зөвхөн идэвхтэй горимын талбаруудыг илгээнэ
      const addr = isUB
        ? {
            district: form.district.trim(),
            khoroo: form.khoroo.trim(),
            building: form.building.trim(),
            entrance: form.entrance.trim(),
            floor: form.floor.trim(),
            door: form.door.trim(),
          }
        : {
            province: form.province,
            soum: form.soum.trim(),
            transport: form.transport.trim(),
            ...(form.addressDetail.trim()
              ? { addressDetail: form.addressDetail.trim() }
              : {}),
          }
      const order = await api('/orders', {
        method: 'POST',
        body: {
          region: form.region,
          customerPhone: form.customerPhone.trim(),
          ...(form.customerName.trim()
            ? { customerName: form.customerName.trim() }
            : {}),
          ...(form.extraPhone.trim() ? { extraPhone: form.extraPhone.trim() } : {}),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
          ...addr,
          // "Төлсөн" сонгосон бол бүтэн төлбөр хамт бүртгэгдэнэ (staff л)
          channel,
          ...(paid ? { paid: true } : {}),
          items: items.map((i) => ({
            productId: i.product.id,
            qty: Number(i.qty),
          })),
        },
      })
      toast.show(t('Захиалга {no} үүслээ', { no: order.orderNo }))
      navigate(`/orders/${order.id}`)
    } catch (err) {
      toast.show(err.message, { type: 'error' })
      setStep(stepForError(err.message))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-serif text-4xl font-medium">{t('Шинэ захиалга')}</h1>
      <Stepper step={step} onBack={setStep} t={t} />

      {step === 1 && (
        <div className="mt-8">
          {/* Горим сонгох toggle */}
          <div className="grid grid-cols-2 border border-rule rounded overflow-hidden max-w-md">
            {[
              ['ULAANBAATAR', 'Улаанбаатар'],
              ['ORON_NUTAG', 'Орон нутаг'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, region: value }))}
                className={`py-3 text-base font-medium transition-colors ${
                  form.region === value
                    ? 'bg-accent/15 text-accent-text'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t(label)}
              </button>
            ))}
          </div>

          {/* Хаягийн талбарууд — горимоороо */}
          {isUB ? (
            <div className="mt-6 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Select
                  id="a-district"
                  label={t('Дүүрэг')}
                  value={form.district}
                  onChange={set('district')}
                  error={errors.district}
                >
                  <option value="">—</option>
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
                <Select
                  id="a-khoroo"
                  label={t('Хороо')}
                  value={form.khoroo}
                  onChange={set('khoroo')}
                  error={errors.khoroo}
                  disabled={!form.district}
                >
                  <option value="">
                    {form.district ? '—' : t('Эхлээд дүүргээ сонгоно уу')}
                  </option>
                  {khorooList(form.district).map((k) => (
                    <option key={k} value={k}>
                      {k}-р хороо
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                id="a-building"
                label={t('Барилга/Хороолол/Хашаа')}
                value={form.building}
                onChange={set('building')}
                error={errors.building}
                placeholder="Гоёо хотхон 45-р байр"
              />
              <div className="grid grid-cols-3 gap-4">
                <Input
                  id="a-entrance"
                  label={t('Орц')}
                  value={form.entrance}
                  onChange={set('entrance')}
                  error={errors.entrance}
                  className="font-mono"
                />
                <Input
                  id="a-floor"
                  label={t('Давхар')}
                  value={form.floor}
                  onChange={set('floor')}
                  error={errors.floor}
                  className="font-mono"
                />
                <Input
                  id="a-door"
                  label={t('Хаалга')}
                  value={form.door}
                  onChange={set('door')}
                  error={errors.door}
                  className="font-mono"
                />
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Select
                  id="a-province"
                  label={t('Аймаг')}
                  value={form.province}
                  onChange={set('province')}
                  error={errors.province}
                >
                  <option value="">—</option>
                  {AIMAGS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
                <Input
                  id="a-soum"
                  label={t('Сум/Суурин газар')}
                  value={form.soum}
                  onChange={set('soum')}
                  error={errors.soum}
                />
              </div>
              <Input
                id="a-transport"
                label={t('Ачаа явах тээвэр')}
                value={form.transport}
                onChange={set('transport')}
                error={errors.transport}
                placeholder={t('Жишээ: Од транс, 99112233')}
              />
              <div>
                <label
                  htmlFor="a-detail"
                  className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5"
                >
                  {t('Хаягийн дэлгэрэнгүй')}
                </label>
                <textarea
                  id="a-detail"
                  rows={2}
                  value={form.addressDetail}
                  onChange={set('addressDetail')}
                  className="w-full bg-bg border border-rule rounded px-3 py-2 text-sm focus:outline-none focus:border-ink-muted"
                />
              </div>
            </div>
          )}

          {/* Хүлээн авагч — хоёр горимд адил */}
          <div className="mt-8 border-t border-rule pt-6 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Input
                id="r-name"
                label={t('Хүлээн авагчийн нэр')}
                value={form.customerName}
                onChange={set('customerName')}
                placeholder={t('(заавал биш)')}
              />
              <Input
                id="r-phone"
                label={t('Хүлээн авагчийн утас')}
                inputMode="numeric"
                value={form.customerPhone}
                onChange={set('customerPhone')}
                error={errors.customerPhone}
                placeholder="99112233"
                className="font-mono"
              />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <Input
                id="r-extra"
                label={t('Нэмэлт утас')}
                inputMode="numeric"
                value={form.extraPhone}
                onChange={set('extraPhone')}
                error={errors.extraPhone}
                placeholder={t('(заавал биш)')}
                className="font-mono"
              />
              <Input
                id="r-note"
                label={t('Нэмэлт тэмдэглэл')}
                value={form.note}
                onChange={set('note')}
              />
            </div>
          </div>

          {/* Захиалга аль сувгаас ирсэн бэ (V5) */}
          <div className="mt-8 border-t border-rule pt-6">
            <p className="text-xs uppercase tracking-wide text-ink-muted mb-3">
              {t('Захиалга ирсэн суваг')}
            </p>
            <div className="inline-flex border border-rule rounded overflow-hidden flex-wrap">
              {CHANNELS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChannel(value)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    channel === value
                      ? 'bg-accent/15 text-accent-text'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8 flex justify-end">
            <Button onClick={goStep2} className="px-8">
              {t('Үргэлжлүүлэх')} →
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-8">
          <ProductCatalog
            onPick={addProduct}
            excludeIds={items.map((i) => i.product.id)}
          />

          {items.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title={t('Сагс хоосон')}
                note={t('Дээрх каталогоос бараа сонгож сагслана уу')}
              />
            </div>
          ) : (
            <div className="mt-4 divide-y divide-rule border-y border-rule">
              {items.map(({ product, qty }) => {
                const over = Number(qty) > product.stockQty
                const line = Number(product.price) * (Number(qty) || 0)
                return (
                  <div key={product.id} className="py-3">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="truncate">{product.name}</p>
                        <p className="font-mono text-xs text-ink-muted tabular-nums">
                          {product.sku} · {formatMoney(product.price)}
                        </p>
                      </div>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        max={product.stockQty}
                        value={qty}
                        onChange={(e) => setQty(product.id, e.target.value)}
                        aria-label={`${product.name} тоо ширхэг`}
                        className="w-20 bg-bg border border-rule rounded px-2 py-1.5 text-sm font-mono text-right focus:outline-none focus:border-ink-muted"
                      />
                      <span className="font-mono text-sm tabular-nums w-28 text-right">
                        {formatMoney(line)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(product.id)}
                        aria-label={t('Мөр устгах')}
                        className="text-ink-muted hover:text-alarm text-lg leading-none px-1"
                      >
                        ×
                      </button>
                    </div>
                    {over && (
                      // UX зөвлөмж — жинхэнэ шалгалт backend-ийн transaction-д
                      <p className="mt-1.5 text-xs text-status-preparing">
                        {t('⚠ Үлдэгдэл: {n}', { n: product.stockQty })}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Хаягийн тойм + нийт дүн */}
          <div className="mt-8 border-t border-rule pt-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-ink-muted">
                  {t('Хүргэлтийн хаяг')}
                </p>
                <p className="mt-1 text-sm">
                  {formatFullAddress(form)}
                  {form.customerName && ` — ${form.customerName}`}
                  <span className="font-mono text-ink-muted ml-2">
                    {form.customerPhone}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="mt-1 text-xs text-accent-text underline underline-offset-2"
                >
                  {t('Засах')}
                </button>
              </div>
              <p className="text-sm text-ink-muted">
                {t('Нийт')}{' '}
                <span className="font-mono text-2xl text-ink tabular-nums ml-2">
                  {formatMoney(total)}
                </span>
              </p>
            </div>

            {/* Төлбөр төлсөн эсэх */}
            {(
              <div className="mt-6 flex items-center justify-end gap-3 flex-wrap">
                <span className="text-xs uppercase tracking-wide text-ink-muted">
                  {t('Төлбөр')}
                </span>
                <div className="grid grid-cols-2 border border-rule rounded overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setPaid(true)}
                    className={`px-5 py-2 text-sm font-medium transition-colors ${
                      paid ? 'bg-safe/15 text-safe' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    ✓ {t('Төлсөн')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaid(false)}
                    className={`px-5 py-2 text-sm font-medium transition-colors ${
                      !paid ? 'bg-alarm/15 text-alarm' : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {t('Төлөөгүй')}
                  </button>
                </div>
                {paid && (
                  <span className="text-sm text-ink-muted self-center">
                    {t('pay.transfer')}
                  </span>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleSubmit}
                loading={submitting}
                disabled={!canSubmit}
                className="px-8"
              >
                {t('Захиалга үүсгэх')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
