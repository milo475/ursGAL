import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'

const GROUP_LABELS = {
  ORDERS: 'Захиалга',
  // Түлхүүр нь customers.* хэвээр. Бүлэг нь нийлүүлэгч компани БА
  // худалдан авагчийн түүх хоёуланг хамардаг (доорх нэрсийг үзнэ үү)
  CUSTOMERS: 'Харилцагчийн мэдээлэл',
  DRIVERS: 'Жолооч',
  SUPPLIES: 'Нийлүүлэлт',
  INVENTORY: 'Агуулах',
  FINANCE: 'Санхүү',
  REPORTS: 'Тайлан',
  SYSTEM: 'Систем',
}

const ROLE_LABELS = {
  ADMIN: 'Админ',
  MANAGER: 'Менежер',
  OPERATOR: 'Харилцагч', // бараа нийлүүлдэг түнш — захиалга шивэх эрхтэй
  DRIVER: 'Жолооч',
  WAREHOUSE: 'Нярав',
  SELLER: 'Борлуулагч',
}

/**
 * Permission Panel — role default + хэрэглэгчийн override.
 * edits: { [key]: bool | null } — null нь "override устгаж default руу".
 */
export default function UserPermissions() {
  const { id } = useParams()
  const toast = useToast()
  const { t } = useLang()

  const [panel, setPanel] = useState(null)
  const [error, setError] = useState(null)
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setError(null)
    api(`/users/${id}/permissions`)
      .then((d) => {
        setPanel(d)
        setEdits({})
      })
      .catch((e) => setError(e))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return (
      <EmptyState
        title={t('Өгөгдөл ачаалж чадсангүй')}
        note={error.message}
        action={<Button onClick={load}>{t('Дахин оролдох')}</Button>}
      />
    )
  }
  if (!panel) {
    return (
      <div className="py-16 text-center">
        <Spinner size={22} />
      </div>
    )
  }

  const isAdmin = panel.role === 'ADMIN'

  // Одоо харагдаж буй override (локал засвар давуу)
  const overrideOf = (item) =>
    item.key in edits ? edits[item.key] : item.override
  const shownOf = (item) => overrideOf(item) ?? item.roleDefault

  function toggle(item) {
    const desired = !shownOf(item)
    setEdits((e) => ({
      ...e,
      // default-тайгаа таарвал override хэрэггүй — null
      [item.key]: desired === item.roleDefault ? null : desired,
    }))
  }

  function resetToDefault(item) {
    setEdits((e) => ({ ...e, [item.key]: null }))
  }

  // Сервэрийн төлвөөс бодитой ялгаатай өөрчлөлтүүд л илгээгдэнэ
  const changes = []
  for (const g of panel.groups) {
    for (const item of g.items) {
      if (!(item.key in edits)) continue
      if (edits[item.key] === item.override) continue
      if (edits[item.key] === null && item.override === null) continue
      changes.push({ key: item.key, allowed: edits[item.key] })
    }
  }

  async function save() {
    setSaving(true)
    try {
      const fresh = await api(`/users/${id}/permissions`, {
        method: 'PUT',
        body: { changes },
      })
      setPanel(fresh)
      setEdits({})
      toast.show(t('Эрхийн тохиргоо хадгалагдлаа'))
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <Link to="/users" className="text-sm text-ink-muted hover:text-ink">
        {t('← Хэрэглэгчид')}
      </Link>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <h1 className="font-serif text-4xl font-medium">{panel.name}</h1>
        <span className="font-mono text-[11px] uppercase tracking-wide border rounded px-1.5 py-0.5 text-accent-text border-accent/40 bg-accent/12">
          {t(ROLE_LABELS[panel.role] ?? panel.role)}
        </span>
      </div>

      {isAdmin && (
        <p className="mt-4 text-sm text-ink-muted border border-rule rounded px-4 py-3">
          {t('Админд бүх эрх үргэлж нээлттэй — өөрчлөх боломжгүй.')}
        </p>
      )}

      <div className="mt-8 grid md:grid-cols-2 gap-x-10 gap-y-8">
        {panel.groups.map((g) => (
          <section key={g.group}>
            <h2 className="text-xs uppercase tracking-wide text-ink-muted border-b border-rule pb-2">
              {t(GROUP_LABELS[g.group] ?? g.group)}
            </h2>
            <ul className="mt-2">
              {g.items.map((item) => {
                const override = overrideOf(item)
                const differs = !isAdmin && override !== null
                return (
                  <li key={item.key}>
                    <label
                      className={`flex items-center gap-3 py-1.5 px-2 -mx-2 rounded border transition-colors cursor-pointer ${
                        differs
                          ? 'border-accent/50 bg-accent/8'
                          : 'border-transparent hover:bg-surface'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={shownOf(item)}
                        disabled={isAdmin || saving}
                        onChange={() => toggle(item)}
                        className="size-4 accent-current text-accent-text shrink-0"
                      />
                      <span className="flex-1 min-w-0 text-sm">
                        {t(item.label)}
                        <span className="block font-mono text-[10px] text-ink-muted">
                          {item.key}
                        </span>
                      </span>
                      {differs && (
                        <>
                          <span className="font-mono text-[11px] text-ink-muted shrink-0">
                            default: {item.roleDefault ? '✓' : '✗'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              resetToDefault(item)
                            }}
                            className="text-[11px] text-accent-text underline underline-offset-2 shrink-0"
                          >
                            {t('Default руу буцаах')}
                          </button>
                        </>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {!isAdmin && (
        <div className="mt-10 border-t border-rule pt-6 flex items-center justify-end gap-4">
          {changes.length > 0 && (
            <span className="text-sm text-ink-muted">
              {t('{n} өөрчлөлт', { n: changes.length })}
            </span>
          )}
          <Button
            onClick={save}
            loading={saving}
            disabled={changes.length === 0}
            className="px-10"
          >
            {t('Хадгалах')}
          </Button>
        </div>
      )}
    </div>
  )
}
