import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { AIMAGS, DISTRICTS } from '../data/aimags'
import { khorooList } from '../data/khoroo'
import { API_BASE } from '../lib/api'
import { formatMoney } from '../lib/format'

/**
 * Нийтийн захиалгын хуудас (V5) — НЭВТРЭЛТГҮЙ.
 * Ажилтан энэ линкийг IG/FB-ийн чат руу илгээнэ, хэрэглэгч өөрөө
 * бараагаа сонгож, хаягаа бөглөж, шилжүүлгийн баримтаа хавсаргана.
 *
 * ЧУХАЛ: энэ хуудас ЗАХИАЛГА үүсгэхгүй — зөвхөн ХҮСЭЛТ үүсгэнэ.
 * Үлдэгдэл ажилтан баталгаажуулах хүртэл хөдлөхгүй (спамаас хамгаална).
 */
/**
 * Талбар бүрийн шалгалт — backend-ийн PublicOrderRequestDto-той ЯГ ижил
 * дүрэм. Хүсэлт илгээгээд сая мэдэх биш, бөглөж байхад нь улаанаар
 * харуулахын тулд урд талд давхардуулав.
 */
function validate(form) {
  const e = {}
  if (form.customerName.trim().length < 2) {
    e.customerName = 'Нэрээ бүтнээр нь бичнэ үү'
  }
  if (!/^\d{8}$/.test(form.phone.trim())) {
    e.phone = form.phone.trim()
      ? 'Утасны дугаар 8 оронтой тоо байна'
      : 'Утасны дугаараа бичнэ үү'
  }
  if (form.region === 'ULAANBAATAR') {
    if (!form.district) e.district = 'Дүүргээ сонгоно уу'
    if (!form.khoroo) e.khoroo = 'Хороогоо сонгоно уу'
    if (!form.building.trim()) e.building = 'Байр/хороолол/хашаагаа бичнэ үү'
  } else {
    if (!form.province) e.province = 'Аймгаа сонгоно уу'
    if (!form.soum.trim()) e.soum = 'Сум/суурин газраа бичнэ үү'
  }
  return e
}

export default function PublicOrder() {
  const { token } = useParams()
  const [cfg, setCfg] = useState(null)
  const [error, setError] = useState(null)
  const [step, setStep] = useState(1)
  const [cart, setCart] = useState([]) // [{product, qty}]
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({
    customerName: '',
    phone: '',
    socialName: '',
    channel: 'INSTAGRAM',
    region: 'ULAANBAATAR',
    district: '',
    khoroo: '',
    building: '',
    entrance: '',
    floor: '',
    door: '',
    province: '',
    soum: '',
    transport: '',
    addressDetail: '',
    note: '',
  })
  const [proof, setProof] = useState(null)
  /** Аль талбарыг хөндсөн бэ — алдааг ярьж эхлээгүй талбар дээр гаргахгүй */
  const [touched, setTouched] = useState({})
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [k]: v, ...(k === 'district' ? { khoroo: '' } : {}) }))
    // Сонголтын талбар (дүүрэг/хороо/аймаг) сонгосон даруйдаа шалгагдана
    if (e.target.tagName === 'SELECT') {
      setTouched((t) => ({ ...t, [k]: true }))
    }
  }
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }))

  useEffect(() => {
    fetch(`${API_BASE}/public/order-form?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Линк хүчингүй байна'))))
      .then(setCfg)
      .catch((e) => setError(e.message))
  }, [token])

  const total = cart.reduce((a, i) => a + Number(i.product.price) * i.qty, 0)
  const isUB = form.region === 'ULAANBAATAR'
  const errors = validate(form)
  /** Зөвхөн хөндсөн талбарын алдааг харуулна */
  const shown = (k) => (touched[k] ? errors[k] : undefined)

  /**
   * Хаягийн алхмаас цаашлах — алдаатай бол ЦААШ ЯВУУЛАХГҮЙ, бүх талбарыг
   * хөндсөнд тооцож улаанаар тэмдэглээд эхнийх рүү нь гүйлгэнэ. Өмнө нь
   * шалгалт зөвхөн сервер дээр байсан тул хэрэглэгч бүгдийг бөглөж
   * дуусаад «Захиалга илгээх» дарж байж алдаагаа мэдэж байв.
   */
  function nextFromAddress() {
    const keys = Object.keys(errors)
    if (keys.length === 0) {
      setStep(3)
      return
    }
    setTouched((t) => ({
      ...t,
      ...Object.fromEntries(keys.map((k) => [k, true])),
    }))
    document
      .querySelector(`[data-field="${keys[0]}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const groups = useMemo(() => {
    if (!cfg) return []
    const map = new Map()
    for (const p of cfg.products) {
      const c = p.category ?? 'Бусад'
      if (!map.has(c)) map.set(c, [])
      map.get(c).push(p)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [cfg])

  function add(p) {
    setCart((c) =>
      c.some((i) => i.product.id === p.id)
        ? c.map((i) => (i.product.id === p.id ? { ...i, qty: i.qty + 1 } : i))
        : [...c, { product: p, qty: 1 }],
    )
  }
  const setQty = (id, qty) =>
    setCart((c) =>
      qty <= 0
        ? c.filter((i) => i.product.id !== id)
        : c.map((i) => (i.product.id === id ? { ...i, qty } : i)),
    )

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      const fields = { ...form }
      if (isUB) {
        delete fields.province
        delete fields.soum
        delete fields.transport
      } else {
        delete fields.district
        delete fields.khoroo
        delete fields.building
        delete fields.entrance
        delete fields.floor
        delete fields.door
      }
      for (const [k, v] of Object.entries(fields)) {
        if (v !== '' && v !== null && v !== undefined) fd.append(k, String(v))
      }
      fd.append(
        'items',
        JSON.stringify(cart.map((i) => ({ productId: i.product.id, qty: i.qty }))),
      )
      if (proof) fd.append('proof', proof)

      const res = await fetch(
        `${API_BASE}/public/order-requests?token=${encodeURIComponent(token)}`,
        { method: 'POST', body: fd },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const msg = body?.message
        throw new Error(
          Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Илгээж чадсангүй'),
        )
      }
      setSent(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !cfg) {
    return (
      <Shell>
        <p className="text-center text-alarm">{error}</p>
      </Shell>
    )
  }
  if (!cfg) {
    return (
      <Shell>
        <p className="text-center text-ink-muted font-mono text-sm">
          ачаалж байна…
        </p>
      </Shell>
    )
  }

  if (sent) {
    return (
      <Shell title={cfg.companyName}>
        <div className="text-center py-10">
          <p className="text-5xl">✓</p>
          <h2 className="mt-4 text-2xl font-medium">Захиалга хүлээн авлаа</h2>
          <p className="mt-2 text-ink-muted">
            Бид тун удахгүй тантай холбогдож баталгаажуулна.
          </p>
          {cfg.companyPhone && (
            <p className="mt-4 text-sm text-ink-muted">
              Асуулт байвал:{' '}
              <span className="font-mono text-ink">{cfg.companyPhone}</span>
            </p>
          )}
        </div>
      </Shell>
    )
  }

  return (
    <Shell title={cfg.companyName}>
      {/* Алхмын заагч */}
      <div className="flex gap-2 mb-5 text-xs">
        {['Бараа', 'Хаяг', 'Төлбөр'].map((label, i) => (
          <span
            key={label}
            className={`flex-1 text-center py-1.5 rounded border ${
              step === i + 1
                ? 'border-accent/50 text-accent-text bg-accent/12'
                : 'border-rule text-ink-muted'
            }`}
          >
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {step === 1 && (
        <>
          <div className="space-y-4">
            {groups.map(([cat, list]) => (
              <div key={cat}>
                <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                  {cat}
                </p>
                <ul className="grid grid-cols-2 gap-3">
                  {list.map((p) => {
                    const inCart = cart.find((i) => i.product.id === p.id)
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={!p.inStock}
                          onClick={() => add(p)}
                          className={`w-full text-left border rounded-lg overflow-hidden transition-colors ${
                            inCart
                              ? 'border-accent/60'
                              : 'border-rule hover:border-ink-muted'
                          } disabled:opacity-40`}
                        >
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              className="w-full aspect-square object-cover bg-bg"
                            />
                          ) : (
                            <div className="w-full aspect-square bg-bg" />
                          )}
                          <span className="block p-2">
                            <span className="block text-sm leading-tight">
                              {p.name}
                            </span>
                            <span className="block font-mono text-sm mt-1">
                              {formatMoney(p.price)}
                            </span>
                            {!p.inStock && (
                              <span className="block text-xs text-alarm mt-0.5">
                                Дууссан
                              </span>
                            )}
                            {inCart && (
                              <span className="block text-xs text-accent-text mt-0.5">
                                Сагсанд {inCart.qty}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>

          {cart.length > 0 && (
            <div className="mt-6 border-t border-rule pt-4">
              <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                Сонгосон бараа
              </p>
              <ul className="divide-y divide-rule border-y border-rule">
                {cart.map((i) => (
                  <li
                    key={i.product.id}
                    className="py-2 flex items-center gap-3 text-sm"
                  >
                    <span className="flex-1 truncate">{i.product.name}</span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setQty(i.product.id, i.qty - 1)}
                        className="w-7 h-7 border border-rule rounded"
                      >
                        −
                      </button>
                      <span className="font-mono w-6 text-center">{i.qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty(i.product.id, i.qty + 1)}
                        className="w-7 h-7 border border-rule rounded"
                      >
                        +
                      </button>
                    </span>
                    <span className="font-mono tabular-nums w-24 text-right">
                      {formatMoney(Number(i.product.price) * i.qty)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-right">
                Нийт{' '}
                <span className="font-mono text-xl tabular-nums ml-2">
                  {formatMoney(total)}
                </span>
              </p>
              <Btn onClick={() => setStep(2)} className="mt-4 w-full">
                Үргэлжлүүлэх →
              </Btn>
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 border border-rule rounded overflow-hidden">
            {[
              ['ULAANBAATAR', 'Хот дотор'],
              ['ORON_NUTAG', 'Орон нутаг'],
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setForm((f) => ({ ...f, region: v }))}
                className={`py-3 text-sm font-medium ${
                  form.region === v ? 'bg-accent/15 text-accent-text' : 'text-ink-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <Field
            label="Таны нэр *"
            name="customerName"
            value={form.customerName}
            onChange={set('customerName')}
            onBlur={touch('customerName')}
            error={shown('customerName')}
          />
          <Field
            label="Утас *"
            name="phone"
            value={form.phone}
            onChange={set('phone')}
            onBlur={touch('phone')}
            error={shown('phone')}
            inputMode="numeric"
            maxLength={8}
            placeholder="99112233"
          />

          {isUB ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Sel
                  label="Дүүрэг *"
                  name="district"
                  value={form.district}
                  onChange={set('district')}
                  onBlur={touch('district')}
                  error={shown('district')}
                >
                  <option value="">—</option>
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </Sel>
                <Sel
                  label="Хороо *"
                  name="khoroo"
                  value={form.khoroo}
                  onChange={set('khoroo')}
                  onBlur={touch('khoroo')}
                  error={shown('khoroo')}
                  disabled={!form.district}
                >
                  <option value="">{form.district ? '—' : 'Дүүргээ сонго'}</option>
                  {khorooList(form.district).map((k) => (
                    <option key={k} value={k}>{k}-р хороо</option>
                  ))}
                </Sel>
              </div>
              <Field
                label="Байр / Хороолол / Хашаа *"
                name="building"
                value={form.building}
                onChange={set('building')}
                onBlur={touch('building')}
                error={shown('building')}
              />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Орц" value={form.entrance} onChange={set('entrance')} />
                <Field label="Давхар" value={form.floor} onChange={set('floor')} />
                <Field label="Тоот" value={form.door} onChange={set('door')} />
              </div>
            </>
          ) : (
            <>
              <Sel
                label="Аймаг *"
                name="province"
                value={form.province}
                onChange={set('province')}
                onBlur={touch('province')}
                error={shown('province')}
              >
                <option value="">—</option>
                {AIMAGS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </Sel>
              <Field
                label="Сум / Суурин газар *"
                name="soum"
                value={form.soum}
                onChange={set('soum')}
                onBlur={touch('soum')}
                error={shown('soum')}
              />
              <Field
                label="Ямар тээврээр явуулах вэ? (мэдэхгүй бол хоосон орхи)"
                value={form.transport}
                onChange={set('transport')}
              />
            </>
          )}

          <Field
            label="Нэмэлт тэмдэглэл"
            value={form.note}
            onChange={set('note')}
            placeholder="Ж: оройн 6-аас хойш утасдана уу"
          />

          <div>
            <span className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5">
              Та хаанаас холбогдсон бэ?
            </span>
            <div className="flex gap-2 flex-wrap">
              {[
                ['INSTAGRAM', 'Instagram'],
                ['FACEBOOK', 'Facebook'],
                ['PHONE', 'Утсаар'],
                ['OTHER', 'Бусад'],
              ].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, channel: v }))}
                  className={`px-3 py-1.5 rounded border text-sm ${
                    form.channel === v
                      ? 'border-accent/50 text-accent-text bg-accent/12'
                      : 'border-rule text-ink-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Field
            label="Instagram / Facebook дээрх нэр"
            value={form.socialName}
            onChange={set('socialName')}
            placeholder="@нэр — таныг таних"
          />

          <div className="flex gap-2 pt-2">
            <Btn ghost onClick={() => setStep(1)} className="flex-1">
              ← Буцах
            </Btn>
            <Btn onClick={nextFromAddress} className="flex-1">
              Үргэлжлүүлэх →
            </Btn>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="border border-rule rounded p-4">
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              Төлөх дүн
            </p>
            <p className="font-mono text-2xl tabular-nums mt-1">
              {formatMoney(total)}
            </p>
          </div>

          {(cfg.bank?.account || cfg.bank?.name) && (
            <div className="border border-rule rounded p-4 space-y-1 text-sm">
              <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                Шилжүүлэх данс
              </p>
              {cfg.bank.name && <p>Банк: {cfg.bank.name}</p>}
              {cfg.bank.account && (
                <p>
                  Данс: <span className="font-mono">{cfg.bank.account}</span>
                </p>
              )}
              {cfg.bank.holder && <p>Хүлээн авагч: {cfg.bank.holder}</p>}
            </div>
          )}

          {/* «Хараахан төлөөгүй» сонголт ХАСАГДСАН (V5): компани бэлэн
              мөнгөөр үйлчлэхгүй тул линкээр захиалахын тулд эхлээд
              шилжүүлж, баримтаа хавсаргах ёстой. Баримт нь өөрөө
              төлсний нотолгоо — тусад нь «төлсөн» гэж дарах шаардлагагүй. */}
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5">
              Гүйлгээний баримтын зураг <span className="text-alarm">*</span>
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setProof(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-muted file:mr-3 file:border file:border-rule file:rounded file:bg-bg file:px-3 file:py-1.5 file:text-ink file:text-sm"
            />
            <span className="block mt-2 text-xs text-ink-muted">
              Дээрх данс руу шилжүүлээд баримтын зургаа хавсаргана уу.
              Баримтгүй захиалга хүлээж авахгүй.
            </span>
          </label>

          {error && (
            <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Btn ghost onClick={() => setStep(2)} className="flex-1">
              ← Буцах
            </Btn>
            <Btn
              onClick={submit}
              disabled={busy || !proof}
              className="flex-1"
            >
              {busy
                ? 'Илгээж байна…'
                : proof
                  ? 'Захиалга илгээх'
                  : 'Баримтаа хавсаргана уу'}
            </Btn>
          </div>
        </div>
      )}
    </Shell>
  )
}

/* ── Жижиг дотоод бүрдлүүд (нийтийн хуудас нь app-ийн layout ашиглахгүй) ── */

function Shell({ title, children }) {
  return (
    <main className="min-h-screen bg-bg text-ink px-4 py-6">
      <div className="max-w-md mx-auto">
        {title && (
          <h1 className="font-serif text-3xl font-medium text-center mb-6">
            {title}
          </h1>
        )}
        {children}
      </div>
    </main>
  )
}

function Field({ label, error, name, ...props }) {
  return (
    <label className="block" data-field={name}>
      <span
        className={`block text-xs uppercase tracking-wide mb-1.5 ${
          error ? 'text-alarm' : 'text-ink-muted'
        }`}
      >
        {label}
      </span>
      <input
        {...props}
        aria-invalid={error ? 'true' : undefined}
        className={`w-full bg-bg border rounded px-3 py-2.5 text-base focus:outline-none ${
          error
            ? 'border-alarm text-alarm focus:border-alarm'
            : 'border-rule focus:border-ink-muted'
        }`}
      />
      {error && <span className="block mt-1 text-xs text-alarm">{error}</span>}
    </label>
  )
}

function Sel({ label, error, name, children, ...props }) {
  return (
    <label className="block" data-field={name}>
      <span
        className={`block text-xs uppercase tracking-wide mb-1.5 ${
          error ? 'text-alarm' : 'text-ink-muted'
        }`}
      >
        {label}
      </span>
      <select
        {...props}
        aria-invalid={error ? 'true' : undefined}
        className={`w-full bg-bg border rounded px-3 py-2.5 text-base focus:outline-none disabled:opacity-50 ${
          error
            ? 'border-alarm text-alarm focus:border-alarm'
            : 'border-rule focus:border-ink-muted'
        }`}
      >
        {children}
      </select>
      {error && <span className="block mt-1 text-xs text-alarm">{error}</span>}
    </label>
  )
}

function Btn({ ghost, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded py-3 text-sm font-medium transition-opacity disabled:opacity-50 ${
        ghost
          ? 'border border-rule text-ink-muted'
          : 'bg-ink text-bg hover:opacity-90'
      } ${className}`}
    />
  )
}
