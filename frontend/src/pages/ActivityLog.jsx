import { useCallback, useEffect, useState } from 'react'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Spinner from '../components/ui/Spinner'
import Table from '../components/ui/Table'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'

const LIMIT = 20

/** Entity-ийн монгол нэрс (interceptor controller нэрээс үүсгэдэг) */
const ENTITY_LABELS = {
  orders: 'Захиалга',
  products: 'Бараа',
  categories: 'Ангилал',
  stock: 'Агуулах',
  users: 'Хэрэглэгч',
  permissions: 'Эрхийн тохиргоо',
  delivery: 'Хүргэлт',
  finance: 'Санхүү',
  notifications: 'Мэдэгдэл',
  // Аюулгүй байдлын үйл явдал (V5) — амжилтгүй нэвтрэлт, 403
  security: 'Аюулгүй байдал',
}

function actionKind(action) {
  // Аюулгүй байдлын үйл явдлыг тус тусад нь ялгана (V5) — «нэвтэрч
  // чадсангүй» ба «эрхээсээ хэтэрсэн» хоёр огт өөр утгатай
  if (action === 'LOGIN_FAILED') return 'loginFailed'
  if (action === 'LOGIN_LOCKED') return 'locked'
  if (action === 'FORBIDDEN') return 'forbidden'
  if (action === 'permission_change') return 'permission'
  if (action.startsWith('POST')) return 'create'
  if (action.startsWith('DELETE')) return 'delete'
  return 'update'
}

const ACTION_STYLE = {
  create: 'text-safe border-safe/40 bg-safe/12',
  update: 'text-accent-text border-accent/40 bg-accent/10',
  delete: 'text-alarm border-alarm/40 bg-alarm/10',
  permission: 'text-status-preparing border-status-preparing/40 bg-status-preparing/12',
  loginFailed: 'text-alarm border-alarm/40 bg-alarm/12',
  forbidden: 'text-alarm border-alarm/40 bg-alarm/12',
  locked: 'text-bg border-alarm bg-alarm',
}
const ACTION_LABEL = {
  create: 'action.create',
  update: 'action.update',
  delete: 'action.delete',
  permission: 'action.permission',
  loginFailed: 'Нэвтэрч чадсангүй',
  forbidden: 'Эрх хэтрүүлсэн',
  locked: 'Бүртгэл түгжигдсэн',
}

export default function ActivityLog() {
  const { t } = useLang()
  const [tab, setTab] = useState('log') // log | errors

  const [entity, setEntity] = useState('')
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [users, setUsers] = useState(null)
  const [error, setError] = useState(null)

  // Хэрэглэгчийн шүүлтүүр — users.manage байхгүй бол чимээгүй нуугдана
  useEffect(() => {
    api('/users')
      .then(setUsers)
      .catch(() => setUsers(null))
  }, [])

  const load = useCallback(() => {
    setError(null)
    const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (entity) q.set('entity', entity)
    if (userId) q.set('userId', userId)
    if (from) q.set('from', new Date(from).toISOString())
    if (to) q.set('to', new Date(`${to}T23:59:59`).toISOString())
    api(`/activity-log?${q}`)
      .then(setData)
      .catch((e) => setError(e))
  }, [entity, userId, from, to, page])

  useEffect(() => {
    load()
  }, [load])

  const columns = [
    {
      key: 'createdAt',
      header: t('Огноо'),
      render: (r) => (
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
    { key: 'userName', header: t('Хэрэглэгч') },
    {
      key: 'action',
      header: t('Үйлдэл'),
      render: (r) => {
        const kind = actionKind(r.action)
        return (
          <span
            title={r.action}
            className={`inline-flex font-mono text-[10px] uppercase tracking-wide border rounded px-1 py-0.5 ${ACTION_STYLE[kind]}`}
          >
            {t(ACTION_LABEL[kind])}
          </span>
        )
      },
    },
    {
      key: 'entity',
      header: t('Объект'),
      render: (r) => (
        <span className="text-sm">
          {t(ENTITY_LABELS[r.entity] ?? r.entity)}
          {r.entityId && (
            <span className="font-mono text-[10px] text-ink-muted ml-1.5">
              {r.entityId.slice(0, 8)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'meta',
      header: t('Дэлгэрэнгүй'),
      render: (r) =>
        r.meta ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-ink-muted hover:text-ink select-none">
              JSON
            </summary>
            <pre className="mt-1 p-2 bg-bg border border-rule rounded font-mono text-[11px] max-w-xs overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(r.meta, null, 2)}
            </pre>
          </details>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
  ]

  return (
    <div>
      <h1 className="font-serif text-4xl font-medium">{t('Үйлдлийн түүх')}</h1>

      {/* Таб: үйлдлийн түүх / системийн алдаа (V4-14) */}
      <div className="mt-6 flex gap-1 border-b border-rule pb-3">
        {[
          ['log', 'Үйлдлийн түүх'],
          ['errors', 'Системийн алдаа'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              tab === key ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {tab === 'errors' ? (
        <ErrorsTab t={t} />
      ) : (
        <>
      {/* Шүүлтүүрүүд */}
      <div className="mt-6 flex items-end gap-3 flex-wrap border-b border-rule pb-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5">
            {t('Объект')}
          </span>
          <select
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value)
              setPage(1)
            }}
            className="bg-bg border border-rule rounded px-2 py-2 text-sm focus:outline-none focus:border-ink-muted"
          >
            <option value="">{t('Бүгд')}</option>
            {Object.entries(ENTITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        {users && (
          <label className="block">
            <span className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5">
              {t('Хэрэглэгч')}
            </span>
            <select
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value)
                setPage(1)
              }}
              className="bg-bg border border-rule rounded px-2 py-2 text-sm focus:outline-none focus:border-ink-muted"
            >
              <option value="">{t('Бүгд')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        <Input
          id="al-from"
          label={t('Эхлэх')}
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value)
            setPage(1)
          }}
        />
        <Input
          id="al-to"
          label={t('Дуусах')}
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value)
            setPage(1)
          }}
        />
      </div>

      <div className="mt-6">
        {error ? (
          <EmptyState
            title={t('Жагсаалт ачаалж чадсангүй')}
            note={error.message}
            action={<Button onClick={load}>{t('Дахин оролдох')}</Button>}
          />
        ) : !data ? (
          <div className="py-16 text-center">
            <Spinner size={22} />
          </div>
        ) : (
          <Table
            columns={columns}
            rows={data.items}
            page={data.page}
            limit={data.limit}
            total={data.total}
            onPageChange={setPage}
            empty={t('Бичилт олдсонгүй')}
          />
        )}
      </div>
        </>
      )}
    </div>
  )
}

/** Системийн алдааны таб (V4-14): өдрөөр сонгож, stack эвхэгдэнэ */
function ErrorsTab({ t }) {
  const todayStr = () => {
    const d = new Date()
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 10)
  }
  const [date, setDate] = useState(todayStr)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    setData(null)
    api(`/admin/errors?date=${date}`)
      .then(setData)
      .catch((e) => setError(e))
  }, [date])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="mt-6">
      <div className="flex items-end gap-3 flex-wrap">
        <Input
          id="err-date"
          label={t('Огноо')}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {data && (
          <p className="pb-2.5 text-sm text-ink-muted">
            {t('{n} алдаа', { n: data.count })}
          </p>
        )}
      </div>

      <div className="mt-4">
        {error ? (
          <EmptyState
            title={t('Жагсаалт ачаалж чадсангүй')}
            note={error.message}
            action={<Button onClick={load}>{t('Дахин оролдох')}</Button>}
          />
        ) : !data ? (
          <div className="py-16 text-center">
            <Spinner size={22} />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState title={t('Энэ өдөр серверийн алдаа бүртгэгдээгүй ✅')} />
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {data.items.map((e2, i) => (
              <li key={`${e2.timestamp}-${i}`} className="py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-xs text-ink-muted tabular-nums">
                    {formatDateTime(e2.timestamp)}
                  </span>
                  <span className="font-mono text-[10px] uppercase border border-alarm/40 bg-alarm/10 text-alarm rounded px-1 py-0.5">
                    {e2.method}
                  </span>
                  <span className="font-mono text-xs">{e2.path}</span>
                </div>
                <p className="mt-1 text-sm text-alarm">{e2.message}</p>
                {e2.stack && (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-ink-muted hover:text-ink select-none">
                      Stack
                    </summary>
                    <pre className="mt-1 p-2 bg-bg border border-rule rounded font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
                      {e2.stack}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
