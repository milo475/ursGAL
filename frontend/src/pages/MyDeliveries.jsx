import { useCallback, useEffect, useState } from 'react'
import { List, Map as MapIcon, LayoutList } from 'lucide-react'
import Button from '../components/ui/Button'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useLang } from '../context/LanguageContext'
import { api, apiUpload } from '../lib/api'
import { enqueueComplete, pendingCount } from '../lib/offlineQueue'
import { formatMoney } from '../lib/format'

/**
 * Жолоочийн хүргэлтийн хуудас — утсанд зориулагдсан:
 * карт том, утас руу шууд залгана, камер шууд нээгддэг.
 */
export default function MyDeliveries() {
  const { t } = useLang()
  const toast = useToast()

  const [deliveries, setDeliveries] = useState(null)
  const [error, setError] = useState(null)
  const [sheet, setSheet] = useState(null) // баталгаажуулж буй захиалга
  const [routeView, setRouteView] = useState(false) // Миний маршрут хураангуй

  const [starting, setStarting] = useState(null) // «замд гарлаа» илгээж буй id

  const load = useCallback(() => {
    setError(null)
    api('/deliveries/my')
      .then(setDeliveries)
      .catch((e) => setError(e))
  }, [])

  /**
   * «Замд гарлаа» — ASSIGNED → ON_THE_WAY. Диспетчер самбар дээр
   * жолооч гарсан эсэхийг бодитоор харна.
   */
  const start = useCallback(
    async (d) => {
      setStarting(d.id)
      try {
        await api(`/deliveries/${d.id}/start`, { method: 'POST' })
        toast.show(t('Замд гарлаа'))
        load()
      } catch (e) {
        toast.show(e.message, { type: 'error' })
      } finally {
        setStarting(null)
      }
    },
    [load, t, toast],
  )

  useEffect(() => {
    load()
    // SSE push (V4-09): хуваарилалт хийгдмэгц жагсаалт шууд шинэчлэгдэнэ
    window.addEventListener('notif:push', load)
    return () => window.removeEventListener('notif:push', load)
  }, [load])

  // Offline дараалал (V4-10): хүлээгдэж буй илгээлтийн тоо + илгээгдмэгц refresh
  const [pending, setPending] = useState(0)
  useEffect(() => {
    const update = () => {
      void pendingCount().then(setPending)
    }
    update()
    const onFlushed = (e) => {
      toast.show(
        t('{n} баталгаажуулалт илгээгдлээ', { n: e.detail?.sent ?? 1 }),
      )
      load()
    }
    window.addEventListener('offline-queue:changed', update)
    window.addEventListener('offline-queue:flushed', onFlushed)
    return () => {
      window.removeEventListener('offline-queue:changed', update)
      window.removeEventListener('offline-queue:flushed', onFlushed)
    }
  }, [load, t, toast])

  if (error) {
    return (
      <EmptyState
        title={t('Өгөгдөл ачаалж чадсангүй')}
        note={error.message}
        action={<Button onClick={load}>{t('Дахин оролдох')}</Button>}
      />
    )
  }

  if (!deliveries) {
    return (
      <div className="py-16 text-center">
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-3xl font-medium">
          {t(routeView ? 'Миний маршрут' : 'Миний хүргэлт')}
        </h1>
        {deliveries.length > 0 && (
          <button
            type="button"
            onClick={() => setRouteView((v) => !v)}
            className="flex items-center gap-1.5 border border-rule rounded px-3 py-2 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            {routeView ? <LayoutList size={16} /> : <List size={16} />}
            {t(routeView ? 'Дэлгэрэнгүй' : 'Миний маршрут')}
          </button>
        )}
      </div>

      {/* Offline дараалал (V4-10) */}
      {pending > 0 && (
        <p className="mt-4 text-sm border border-status-preparing/40 bg-status-preparing/10 text-status-preparing rounded px-3 py-2">
          {t('Илгээгдээгүй баталгаажуулалт: {n} — online болмогц автоматаар илгээгдэнэ', { n: pending })}
        </p>
      )}

      {deliveries.length === 0 ? (
        <div className="mt-8">
          <EmptyState title={t('Одоогоор хуваарилагдсан хүргэлт алга')} />
        </div>
      ) : routeView ? (
        /* Хураангуй маршрут — явцад хурдан харах */
        <ol className="mt-6 divide-y divide-rule border-y border-rule">
          {deliveries.map((d, i) => (
            <li key={d.id} className="py-3 flex items-start gap-3">
              <span className="font-mono text-xl text-accent-text tabular-nums w-7 shrink-0">
                {i + 1}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-base font-medium leading-snug">
                  {d.fullAddress || d.orderNo}
                </span>
                <a
                  href={`tel:${d.phone}`}
                  className="font-mono text-base text-accent-text underline underline-offset-2"
                >
                  {d.phone}
                </a>
              </span>
              <a
                href={d.mapUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={t('Замын зураг')}
                className="p-2 text-ink-muted hover:text-accent-text shrink-0"
              >
                <MapIcon size={20} />
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-6 space-y-4">
          {deliveries.map((d, i) => (
            <div
              key={d.id}
              className="bg-surface border border-rule rounded-lg p-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-lg text-accent-text tabular-nums">
                    №{i + 1}
                  </span>
                  <span className="font-mono text-sm text-ink-muted">
                    {d.orderNo}
                  </span>
                </span>
                <span className="font-mono text-lg tabular-nums">
                  {formatMoney(d.totalAmount)}
                </span>
              </div>

              {d.customerName && (
                <p className="mt-3 text-lg font-medium">{d.customerName}</p>
              )}
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <a
                  href={`tel:${d.phone}`}
                  className="font-mono text-xl text-accent-text underline underline-offset-4"
                >
                  📞 {d.phone}
                </a>
                {d.extraPhone && (
                  <a
                    href={`tel:${d.extraPhone}`}
                    className="font-mono text-lg text-accent-text underline underline-offset-4"
                  >
                    📞 {d.extraPhone}
                  </a>
                )}
              </div>

              {/* Backend-ийн угсарсан fullAddress — том үсгээр */}
              <p className="mt-3 text-xl font-medium leading-snug">
                {d.fullAddress}
              </p>

              <ul className="mt-3 border-t border-rule pt-3 space-y-1">
                {d.items.map((item, i) => (
                  <li key={i} className="flex justify-between gap-3 text-base">
                    <span className="truncate">{item.productName}</span>
                    <span className="font-mono tabular-nums shrink-0">
                      × {item.qty}
                    </span>
                  </li>
                ))}
              </ul>

              {d.note && (
                <p className="mt-3 text-base border border-accent/60 rounded px-3 py-2">
                  {d.note}
                </p>
              )}

              <a
                href={d.mapUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex items-center justify-center gap-2 w-full border border-rule rounded px-4 py-2.5 text-base text-ink-muted hover:text-ink hover:border-ink-muted transition-colors"
              >
                <MapIcon size={18} />
                {t('Замын зураг')}
              </a>
              {d.deliveryStatus === 'ON_THE_WAY' ? (
                <p className="mt-2 text-center text-base text-accent-text">
                  {t('Замд яваа')}
                </p>
              ) : (
                <Button
                  variant="ghost"
                  loading={starting === d.id}
                  onClick={() => start(d)}
                  className="w-full mt-2 py-3 text-base"
                >
                  {t('Замд гарлаа')}
                </Button>
              )}
              <Button
                onClick={() => setSheet(d)}
                className="w-full mt-2 py-3.5 text-lg"
              >
                {t('Баталгаажуулах')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {sheet && (
        <CompleteSheet
          delivery={sheet}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null)
            load()
          }}
          t={t}
          toast={toast}
        />
      )}
    </div>
  )
}

/** Доороос гарах баталгаажуулалтын sheet */
function CompleteSheet({ delivery, onClose, onDone, t, toast }) {
  const [shown, setShown] = useState(false)
  const [success, setSuccess] = useState(true)
  const [photo, setPhoto] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false) // Илгээхийн өмнөх асуулт
  const [error, setError] = useState(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function onPickPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPhoto(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  // Зураг заавал биш — гэртээ байхгүй үед тайлбараар баталгаажуулж болно.
  // Амжилтгүйд шалтгаан заавал.
  const canSubmit = success || note.trim().length > 0

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await apiUpload(`/deliveries/${delivery.id}/complete`, {
        success: String(success),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(photo ? { photo } : {}),
      })
      toast.show(
        success ? t('Хүргэлт баталгаажлаа') : t('Амжилтгүй гэж тэмдэглэгдлээ'),
      )
      onDone()
    } catch (err) {
      // Сүлжээний алдаа (status-гүй) = offline — дараалалд хадгална (V4-10)
      if (err?.status === undefined) {
        try {
          await enqueueComplete({
            deliveryId: delivery.id,
            orderNo: delivery.orderNo,
            success,
            note: note.trim(),
            photo,
          })
          toast.show(t('Офлайн — дараа илгээгдэнэ'))
          onDone()
          return
        } catch {
          /* IndexedDB боломжгүй бол энгийн алдаа руу унана */
        }
      }
      setError(err.message)
      toast.show(err.message, { type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t('Хаах')}
        onClick={onClose}
        className={`absolute inset-0 w-full bg-bg transition-opacity duration-300 motion-reduce:transition-none ${
          shown ? 'opacity-60' : 'opacity-0'
        }`}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-surface border-t border-rule rounded-t-2xl p-5 pb-8 max-h-[85vh] overflow-y-auto transition-transform duration-300 motion-reduce:transition-none ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="max-w-md mx-auto space-y-4">
          <p className="font-mono text-sm text-ink-muted">{delivery.orderNo}</p>

          {/* Амжилттай / Амжилтгүй toggle */}
          <div className="grid grid-cols-2 border border-rule rounded overflow-hidden">
            <button
              type="button"
              onClick={() => setSuccess(true)}
              className={`py-3 text-base font-medium transition-colors ${
                success
                  ? 'bg-safe/15 text-safe'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              ✓ {t('Амжилттай')}
            </button>
            <button
              type="button"
              onClick={() => setSuccess(false)}
              className={`py-3 text-base font-medium transition-colors ${
                !success
                  ? 'bg-alarm/15 text-alarm'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              ✗ {t('Амжилтгүй')}
            </button>
          </div>

          {/* Зураг — утасны камер шууд нээгдэнэ (заавал биш) */}
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-ink-muted mb-2">
              {t('Баталгаажуулах зураг')} {t('(заавал биш)')}
            </span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhoto}
              className="block w-full text-sm text-ink-muted file:mr-3 file:py-2.5 file:px-4 file:rounded file:border-0 file:bg-accent file:text-accent-foreground file:text-base file:font-medium"
            />
          </label>
          {previewUrl && (
            <img
              src={previewUrl}
              alt=""
              className="w-full max-h-56 object-cover rounded border border-rule"
            />
          )}

          {/* Тайлбар: амжилттайд заавал биш (ж: дэлгүүрт үлдээсэн),
              амжилтгүйд шалтгаан заавал */}
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-ink-muted mb-2">
              {t('Тайлбар')}
              {success ? ` ${t('(заавал биш)')}` : ' *'}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required={!success}
              rows={2}
              placeholder={t(
                success
                  ? 'Ж: Гэрт нь байгаагүй — доод талын дэлгүүрт үлдээсэн'
                  : 'Шалтгаан бичнэ үү',
              )}
              className="w-full bg-bg border border-rule rounded px-3 py-2.5 text-base focus:outline-none focus:border-ink-muted"
            />
          </label>

          {error && (
            <p className="text-sm text-alarm border border-alarm rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 py-3"
            >
              {t('Болих')}
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              loading={submitting}
              disabled={!canSubmit}
              className="flex-1 py-3 text-base"
            >
              {t('Илгээх')}
            </Button>
          </div>
        </div>
      </div>

      {/* Илгээхийн өмнөх баталгаажуулалт — санамсаргүй даралтаас хамгаална */}
      <ConfirmDialog
        open={confirmOpen}
        title={t(success ? 'Хүргэлт баталгаажуулах' : 'Амжилтгүй тэмдэглэх')}
        message={t(
          success
            ? 'Та энэ хүргэлтийг амжилттай гэж баталгаажуулахдаа итгэлтэй байна уу?'
            : 'Та энэ хүргэлтийг амжилтгүй гэж тэмдэглэхдээ итгэлтэй байна уу?',
        )}
        confirmLabel={t('Илгээх')}
        danger={!success}
        loading={submitting}
        onConfirm={() => {
          setConfirmOpen(false)
          handleSubmit()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
