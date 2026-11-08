import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LanguageContext'
import { DISTRICTS } from '../../data/aimags'
import { api } from '../../lib/api'

/**
 * Жолоочийн бүс — ДҮҮРЭГ БҮРТ хэн явахыг тохируулна (V5).
 *
 * Өмнө нь бүс зөвхөн Хэрэглэгч хуудсаар (users.manage — админ)
 * засагддаг тул аль жолооч аль дүүрэгт явахыг ӨДӨР БҮР мэддэг нярав
 * өөрөө өөрчилж чаддаггүй байв. Энд дүүрэг бүр дээр жолооч нэмж,
 * хасаж болно — «Дүүргээр автоматаар хуваарилах» энэ өгөгдлөөр
 * ажилладаг тул жолоочгүй дүүргийг тусад нь сануулна.
 */
export default function DriverZones() {
  const { t } = useLang()
  const { hasPerm } = useAuth()
  const canEdit = hasPerm('drivers.zones')

  const [drivers, setDrivers] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // `${driverId}:${district}`
  const [adding, setAdding] = useState(null) // аль дүүрэгт нэмж байна

  const load = useCallback(() => {
    setError(null)
    api('/drivers')
      .then((list) => setDrivers(list.filter((d) => d.isActive)))
      .catch((e) => setError(e))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /** Дүүрэг → тухайн дүүргийг хамардаг жолоочид */
  const byDistrict = useMemo(() => {
    const map = new Map(DISTRICTS.map((d) => [d, []]))
    for (const dr of drivers ?? []) {
      for (const z of dr.zones ?? []) {
        if (map.has(z)) map.get(z).push(dr)
      }
    }
    return map
  }, [drivers])

  const zoneless = (drivers ?? []).filter((d) => (d.zones ?? []).length === 0)

  /** Бүтэн жагсаалтыг илгээнэ — нэмэх ч, хасах ч нэг зам */
  async function setZones(driver, zones) {
    setBusy(`${driver.id}`)
    try {
      const res = await api(`/drivers/${driver.id}/zones`, {
        method: 'PATCH',
        body: { zones },
      })
      setDrivers((list) =>
        list.map((d) => (d.id === driver.id ? { ...d, zones: res.zones } : d)),
      )
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
      setAdding(null)
    }
  }

  const add = (driver, district) =>
    setZones(driver, [...new Set([...(driver.zones ?? []), district])])
  const remove = (driver, district) =>
    setZones(
      driver,
      (driver.zones ?? []).filter((z) => z !== district),
    )

  if (error) {
    return (
      <p className="mt-8 text-sm text-alarm border border-alarm rounded px-3 py-2">
        {error.message}
      </p>
    )
  }
  if (drivers === null) {
    return (
      <div className="mt-16 flex justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="mt-6">
      <p className="text-sm text-ink-muted">
        {t('Дүүрэг бүрт хэн явахыг эндээс тохируулна. «Дүүргээр автоматаар хуваарилах» энэ жагсаалтаар ажиллана.')}
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DISTRICTS.map((district) => {
          const list = byDistrict.get(district) ?? []
          const free = drivers.filter((d) => !(d.zones ?? []).includes(district))
          return (
            <section
              key={district}
              className={`border rounded-lg p-3 ${
                list.length === 0 ? 'border-status-preparing/40' : 'border-rule'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-lg">{district}</h3>
                <span
                  className={`font-mono text-xs ${
                    list.length === 0
                      ? 'text-status-preparing'
                      : 'text-ink-muted'
                  }`}
                >
                  {list.length === 0
                    ? `⚠ ${t('жолоочгүй')}`
                    : `${list.length} ${t('жолооч')}`}
                </span>
              </div>

              <ul className="mt-2 flex flex-wrap gap-1.5 min-h-[2rem]">
                {list.map((d) => (
                  <li
                    key={d.id}
                    className="inline-flex items-center gap-1.5 border border-rule rounded px-2 py-1 text-sm"
                  >
                    <span className="truncate max-w-[9rem]">{d.name}</span>
                    <span className="font-mono text-[10px] text-ink-muted">
                      {d.active}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`${d.name} — ${district} ${t('хасах')}`}
                        disabled={busy === d.id}
                        onClick={() => remove(d, district)}
                        className="text-ink-muted hover:text-alarm disabled:opacity-40"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {canEdit &&
                (adding === district ? (
                  <select
                    autoFocus
                    aria-label={`${district} — ${t('жолооч нэмэх')}`}
                    defaultValue=""
                    onChange={(e) => {
                      const d = drivers.find((x) => x.id === e.target.value)
                      if (d) add(d, district)
                    }}
                    onBlur={() => setAdding(null)}
                    className="mt-2 w-full bg-bg border border-rule rounded px-2 py-1.5 text-sm focus:outline-none focus:border-ink-muted"
                  >
                    <option value="">—</option>
                    {free.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {(d.zones ?? []).length
                          ? ` · ${d.zones.join(', ')}`
                          : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    disabled={free.length === 0}
                    onClick={() => setAdding(district)}
                    className="mt-2 text-sm text-accent-text underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
                  >
                    + {t('Жолооч нэмэх')}
                  </button>
                ))}
            </section>
          )
        })}
      </div>

      {zoneless.length > 0 && (
        <section className="mt-8 border-t border-rule pt-6">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-3">
            {t('Бүсгүй жолооч')} ({zoneless.length})
          </p>
          <ul className="flex flex-wrap gap-2">
            {zoneless.map((d) => (
              <li
                key={d.id}
                className="border border-dashed border-rule rounded px-2.5 py-1 text-sm text-ink-muted"
              >
                {d.name}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            {t('Бүсгүй жолооч автомат хуваарилалтад орохгүй — гараар л өгнө')}
          </p>
        </section>
      )}
    </div>
  )
}
