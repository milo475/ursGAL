import { useEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '../../context/LanguageContext'
import { api } from '../../lib/api'
import { formatMoney } from '../../lib/format'

/**
 * Барааны каталог (wizard step 2): хайлтын мөрний ДООР бүх бараа
 * ангилалаараа бүлэглэгдэн харагдаж, дарж сагслана. Хайлт нь
 * каталогийг шууд шүүнэ (нэр/SKU/barcode). endpoint — portal горимд
 * /portal/products.
 */
export default function ProductCatalog({
  onPick,
  excludeIds = [],
  endpoint = '/products',
}) {
  const { t } = useLang()
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState(null)
  const [error, setError] = useState(null)

  // Barcode скан (V4-12) — BarcodeDetector дэмждэг browser-т л товч гарна
  const scanSupported =
    typeof window !== 'undefined' && 'BarcodeDetector' in window
  const [scanOpen, setScanOpen] = useState(false)

  useEffect(() => {
    api(`${endpoint}?limit=200`)
      .then((d) => setProducts(d.items))
      .catch((e) => setError(e))
  }, [endpoint])

  // Хайлтаар шүүгээд ангилалаар бүлэглэнэ
  const groups = useMemo(() => {
    if (!products) return []
    const q = query.trim().toLowerCase()
    const filtered = q
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.sku ?? '').toLowerCase().includes(q) ||
            (p.barcode ?? '') === query.trim(),
        )
      : products
    const map = new Map()
    for (const p of filtered) {
      const cat = p.category?.name ?? t('Ангилалгүй')
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat).push(p)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [products, query, t])

  if (error) {
    return (
      <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
        {t('Бараа ачаалж чадсангүй')}: {error.message}
      </p>
    )
  }

  return (
    <div>
      {/* Хайлт — каталогийг шууд шүүнэ */}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Бараа шүүх — нэр, SKU, barcode…')}
          className={`w-full bg-bg border border-rule rounded px-3 py-2 text-sm focus:outline-none focus:border-ink-muted ${scanSupported ? 'pr-10' : ''}`}
          aria-label={t('Бараа шүүх — нэр, SKU, barcode…')}
        />
        {scanSupported && (
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            aria-label={t('Barcode скан')}
            title={t('Barcode скан')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-lg leading-none"
          >
            📷
          </button>
        )}
      </div>

      {/* Каталог — ангилалаар бүлэглэсэн, дарж сагслана */}
      <div className="mt-3 border border-rule rounded max-h-96 overflow-y-auto divide-y divide-rule">
        {products === null ? (
          <p className="px-3 py-6 text-sm text-ink-muted text-center">…</p>
        ) : groups.length === 0 ? (
          <p className="px-3 py-6 text-sm text-ink-muted text-center">
            {t('Олдсонгүй')}
          </p>
        ) : (
          groups.map(([cat, list]) => (
            <div key={cat}>
              <p className="sticky top-0 bg-surface px-3 py-1.5 text-xs uppercase tracking-wide text-ink-muted border-b border-rule">
                {cat}
                <span className="ml-2 font-mono">({list.length})</span>
              </p>
              <ul className="divide-y divide-rule">
                {list.map((p) => {
                  const added = excludeIds.includes(p.id)
                  const out = p.stockQty === 0
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={added || out}
                        onClick={() => onPick(p)}
                        className="w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 hover:bg-bg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <span className="flex items-center gap-3 min-w-0">
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              className="w-10 h-10 rounded border border-rule object-cover shrink-0"
                            />
                          ) : (
                            <span className="w-10 h-10 rounded border border-rule shrink-0" />
                          )}
                          <span className="min-w-0">
                          <span className="block truncate">{p.name}</span>
                          <span className="font-mono text-xs text-ink-muted">
                            {p.sku}
                            {out && (
                              <span className="ml-2 uppercase text-status-cancelled">
                                {t('stock.out')}
                              </span>
                            )}
                          </span>
                          </span>
                        </span>
                        <span className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-xs text-ink-muted tabular-nums">
                            {formatMoney(p.price)} · {p.stockQty}
                            {p.unit ?? 'ш'}
                          </span>
                          <span
                            className={`font-mono text-xs border rounded px-2 py-1 ${
                              added
                                ? 'text-safe border-safe/40 bg-safe/12'
                                : 'text-accent-text border-accent/40'
                            }`}
                          >
                            {added ? `✓ ${t('Сагсанд')}` : `+ ${t('Сагслах')}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      {scanOpen && (
        <BarcodeScanOverlay
          t={t}
          onClose={() => setScanOpen(false)}
          onDetect={(code) => {
            setScanOpen(false)
            setQuery(code)
          }}
        />
      )}
    </div>
  )
}

/**
 * Утасны камераар barcode уншина (V4-12). BarcodeDetector API —
 * Chrome/Android дээр ажиллана; олдсон кодыг шүүлтэд тавина.
 */
function BarcodeScanOverlay({ onDetect, onClose, t }) {
  const videoRef = useRef(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let stream = null
    let timer = null
    let stopped = false
    const detector = new window.BarcodeDetector()

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((tr) => tr.stop())
          return
        }
        stream = s
        videoRef.current.srcObject = s
        return videoRef.current.play().then(() => {
          timer = setInterval(async () => {
            try {
              const codes = await detector.detect(videoRef.current)
              if (codes.length > 0) onDetect(codes[0].rawValue)
            } catch {
              /* бэлэн биш хүрээг алгасна */
            }
          }, 300)
        })
      })
      .catch((e) => setErr(e.message))

    return () => {
      stopped = true
      clearInterval(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [onDetect])

  return (
    <div className="fixed inset-0 z-50 bg-bg/90 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface border border-rule rounded-lg p-4 space-y-3">
        <p className="text-sm text-ink-muted">{t('Barcode-ыг камерт ойртуулна уу')}</p>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="w-full rounded bg-bg aspect-video" />
        {err && (
          <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">{err}</p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-full border border-rule rounded py-2 text-sm text-ink-muted hover:text-ink"
        >
          {t('Болих')}
        </button>
      </div>
    </div>
  )
}
