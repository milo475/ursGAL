import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import MetricCard from '../components/dashboard/MetricCard'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Select from '../components/ui/Select'
import Spinner from '../components/ui/Spinner'
import Table from '../components/ui/Table'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LanguageContext'
import { api } from '../lib/api'
import { formatDateTime, formatMoney, formatMoneyRound } from '../lib/format'

const LIMIT = 20
/**
 * Ангиллууд одоо BACKEND-ээс ирнэ (GET /finance/categories).
 * Өмнө нь энд монгол текст байсан тул DB-д «Түрээс» гэж бичигдэж,
 * тайлан бүлэглэхэд тогтворгүй байв — одоо КОД хадгалагдана.
 */
/** Системийн авто ангиллуудын харагдах нэр */
/**
 * Backend-ийн автомат ангилалууд. Эдгээр нь FinanceService/PaymentsService/
 * ReturnsService-ийн бичдэг ЯГ утгууд — 'ORDER' гэсэн утгыг backend хэзээ ч
 * бичдэггүй байсан тул PAYMENT/REFUND бичилтүүд "авто" гэж танигдахгүй,
 * захиалга руу линкгүй харагддаг байв.
 */
const AUTO_CATEGORY = {
  PAYMENT: 'Захиалгын төлбөр',
  ORDER: 'Захиалгын төлбөр',
  REFUND: 'Үйлчлүүлэгчид буцаалт',
  DRIVER_PAYROLL: 'Жолоочийн цалин',
  SUPPLY: 'Бараа худалдан авалт',
  SALARY: 'Ажилтны цалин',
  RENT: 'Түрээс',
  PACKAGING: 'Савлагаа, баглаа боодол',
  TRANSPORT: 'Тээвэр, шатахуун',
  MARKETING: 'Маркетинг, сурталчилгаа',
  UTILITIES: 'Цахилгаан, ус, интернэт',
  BANK_FEE: 'Банкны шимтгэл',
  TAX: 'Татвар, хураамж',
  OTHER_INCOME: 'Бусад орлого',
  OTHER_EXPENSE: 'Бусад зарлага',
}

/** 30 хоногийн орлого/зарлагын хос багана */
function DualBars({ byDay, t }) {
  const H = 110
  const max = Math.max(
    1,
    ...byDay.map((d) => Math.max(Number(d.income), Number(d.expense))),
  )
  const W = byDay.length * 16
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H + 14}`}
        className="w-full"
        style={{ maxHeight: 150 }}
        role="img"
        aria-label={t('30 хоногийн орлого, зарлага')}
      >
        {byDay.map((d, i) => {
          const hi = (Number(d.income) / max) * H
          const he = (Number(d.expense) / max) * H
          return (
            <g key={d.date}>
              <rect
                x={i * 16}
                y={H - hi}
                width={6}
                height={Math.max(hi, Number(d.income) > 0 ? 2 : 0.5)}
                style={{ fill: 'var(--color-accent)' }}
              />
              <rect
                x={i * 16 + 7}
                y={H - he}
                width={6}
                height={Math.max(he, Number(d.expense) > 0 ? 2 : 0.5)}
                style={{ fill: 'var(--color-alarm)', opacity: 0.75 }}
              />
              {(i === 0 || i === byDay.length - 1) && (
                <text
                  x={i * 16 + 6}
                  y={H + 11}
                  textAnchor="middle"
                  className="fill-ink-muted"
                  style={{ fontSize: 7, fontFamily: 'monospace' }}
                >
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <p className="mt-2 flex items-center gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent inline-block" />
          {t('finance.income')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-alarm/75 inline-block" />
          {t('finance.expense')}
        </span>
      </p>
    </div>
  )
}

export default function Finance() {
  const { t } = useLang()
  const { hasPerm } = useAuth()
  const toast = useToast()

  const tabs = [
    ...(hasPerm('finance.view_income') ? ['INCOME'] : []),
    ...(hasPerm('finance.view_expense') ? ['EXPENSE'] : []),
    ...(hasPerm('finance.view_receivables') ? ['RECEIVABLES'] : []),
  ]
  const [tab, setTab] = useState(tabs[0])
  const [summary, setSummary] = useState(null)
  const [position, setPosition] = useState(null)
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState(null)
  const [formOpen, setFormOpen] = useState(false)

  const canViewBoth =
    hasPerm('finance.view_income') && hasPerm('finance.view_expense')
  const canCreate =
    tab !== 'RECEIVABLES' &&
    hasPerm(
      tab === 'INCOME' ? 'finance.create_income' : 'finance.create_expense',
    )

  const loadSummary = useCallback(() => {
    if (!canViewBoth) return
    api('/finance/summary?days=30').then(setSummary).catch(() => {})
    api('/finance/position').then(setPosition).catch(() => {})
  }, [canViewBoth])

  const loadEntries = useCallback(() => {
    setError(null)
    if (tab === 'RECEIVABLES') {
      api('/finance/receivables')
        .then((d) => setData({ receivables: d }))
        .catch((e) => setError(e))
      return
    }
    api(`/finance/entries?type=${tab}&page=${page}&limit=${LIMIT}`)
      .then(setData)
      .catch((e) => setError(e))
  }, [tab, page])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])
  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const columns = [
    {
      key: 'entryDate',
      header: t('Огноо'),
      render: (e) => (
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {formatDateTime(e.entryDate)}
        </span>
      ),
    },
    {
      key: 'category',
      header: t('Ангилал'),
      render: (e) => (
        <span
          className={`inline-flex font-mono text-[10px] uppercase tracking-wide border rounded px-1 py-0.5 ${
            AUTO_CATEGORY[e.category]
              ? 'text-accent-text border-accent/40 bg-accent/10'
              : 'text-ink-muted border-rule'
          }`}
        >
          {t(AUTO_CATEGORY[e.category] ?? e.category)}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('Дүн'),
      align: 'right',
      render: (e) => (
        <span className="font-mono tabular-nums">{formatMoney(e.amount)}</span>
      ),
    },
    {
      key: 'note',
      header: t('Тэмдэглэл'),
      render: (e) => (
        <span className="text-sm text-ink-muted">{e.note ?? '—'}</span>
      ),
    },
    {
      key: 'ref',
      header: '',
      render: (e) =>
        e.refOrderId && e.category !== 'DRIVER_PAYROLL' ? (
          <Link
            to={`/orders/${e.refOrderId}`}
            className="text-xs text-accent-text hover:underline underline-offset-2"
          >
            {t('Захиалга харах')}
          </Link>
        ) : e.category === 'DRIVER_PAYROLL' ? (
          <Link
            to="/finance/payroll"
            className="text-xs text-accent-text hover:underline underline-offset-2"
          >
            {t('Тооцоо харах')}
          </Link>
        ) : null,
    },
    {
      key: 'createdBy',
      header: t('Бүртгэсэн'),
      render: (e) => (
        <span className="text-ink-muted text-sm">
          {e.createdBy?.fullName ?? '—'}
        </span>
      ),
    },
  ]

  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="font-serif text-4xl font-medium">{t('Санхүү')}</h1>
        <span className="flex items-center gap-4">
          <Link
            to="/finance/report"
            className="text-sm text-accent-text hover:underline underline-offset-2"
          >
            {t('Орлого тайлан')} →
          </Link>
        {hasPerm('finance.driver_payroll') && (
          <Link
            to="/finance/payroll"
            className="text-sm text-accent-text hover:underline underline-offset-2"
          >
            {t('Жолоочийн цалин')} →
          </Link>
        )}
        </span>
      </div>

      {/* 30 хоногийн тойм */}
      {canViewBoth && summary && (
        <section className="mt-8 border-t border-rule pt-6">
          <div className="grid md:grid-cols-[auto_1fr] gap-8 items-start">
            <div className="grid grid-cols-2 gap-y-6 md:flex md:gap-y-0 [&>*]:min-w-0 md:[&>*]:basis-44 md:[&>*]:shrink-0 md:divide-x divide-rule">
              <MetricCard
                label={t('Нийт орлого')}
                value={formatMoneyRound(summary.income)}
              />
              <MetricCard
                label={t('Нийт зарлага')}
                value={formatMoneyRound(summary.expense)}
              />
              <MetricCard label={t('Зөрүү')} value={formatMoneyRound(summary.net)} />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
                {t('Сүүлийн 30 хоног')}
              </p>
              <DualBars byDay={summary.byDay} t={t} />
            </div>
          </div>
        </section>
      )}

      {/* САНХҮҮГИЙН БАЙРЛАЛ (V5) — мөнгөн урсгал «хэд орж гарсныг»
          хэлдэг ч «хэн бидэнд өртэй, агуулахад хэдийн бараа байгааг»
          хэлдэггүй. Нягтланд хэрэгтэй нөгөө тал нь энэ. */}
      {position && (
        <section className="mt-8 border-t border-rule pt-6">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-4">
            {t('Санхүүгийн байрлал')}
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              ['Мөнгө', position.cash, null],
              ['Авлага', position.receivable, 'Үйлчлүүлэгч бидэнд өртэй'],
              ['Бараа материал', position.inventory, 'Агуулахын өртөг'],
              ['Өглөг', position.payable, 'Бид нийлүүлэгчид өртэй'],
            ].map(([label, value, note]) => (
              <div
                key={label}
                className="border border-rule rounded-lg px-4 py-3 min-w-0"
              >
                <p className="text-sm text-ink-muted">{t(label)}</p>
                <p className="mt-1 font-mono tabular-nums text-lg truncate">
                  {formatMoneyRound(value)}
                </p>
                {note && (
                  <p className="mt-0.5 text-xs text-ink-muted">{t(note)}</p>
                )}
              </div>
            ))}
            <div className="border border-ink rounded-lg px-4 py-3 min-w-0">
              <p className="text-sm text-ink-muted">{t('Цэвэр байрлал')}</p>
              <p className="mt-1 font-mono tabular-nums text-lg truncate">
                {formatMoneyRound(position.net)}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {t('мөнгө + авлага + бараа − өглөг')}
              </p>
            </div>
          </div>
          {position.productsWithoutCost > 0 && (
            <p className="mt-3 text-sm text-alarm">
              ⚠ {position.productsWithoutCost}{' '}
              {t('бараа өртөггүй тул бараа материал ба ашиг дутуу гарна')}
            </p>
          )}
        </section>
      )}

      {/* Табууд + нэмэх */}
      <div className="mt-10 flex items-center gap-1 border-b border-rule pb-3">
        {tabs.map((ty) => (
          <button
            key={ty}
            type="button"
            onClick={() => {
              setTab(ty)
              setPage(1)
            }}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              tab === ty ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t(
              ty === 'INCOME'
                ? 'finance.income'
                : ty === 'EXPENSE'
                  ? 'finance.expense'
                  : 'Авлага',
            )}
          </button>
        ))}
        {canCreate && (
          <Button onClick={() => setFormOpen(true)} className="ml-auto">
            {t('+ Гүйлгээ нэмэх')}
          </Button>
        )}
      </div>

      <div className="mt-6">
        {error ? (
          <EmptyState
            title={t('Жагсаалт ачаалж чадсангүй')}
            note={error.message}
            action={<Button onClick={loadEntries}>{t('Дахин оролдох')}</Button>}
          />
        ) : !data ? (
          <div className="py-16 text-center">
            <Spinner size={22} />
          </div>
        ) : tab === 'RECEIVABLES' && data.receivables ? (
          <Receivables data={data.receivables} t={t} />
        ) : (
          <Table
            columns={columns}
            rows={data.items ?? []}
            page={data.page}
            limit={data.limit}
            total={data.total}
            onPageChange={setPage}
            empty={t('Гүйлгээ олдсонгүй')}
          />
        )}
      </div>

      {formOpen && (
        <EntryForm
          type={tab}
          onClose={() => setFormOpen(false)}
          onDone={() => {
            setFormOpen(false)
            loadEntries()
            loadSummary()
          }}
          t={t}
          toast={toast}
        />
      )}
    </div>
  )
}

/** Авлага: төлөгдөөгүй хүргэгдсэн захиалгууд — хамгийн удаан нь эхэндээ */
function Receivables({ data, t }) {
  const navigate = useNavigate()
  const rows = [...data.items].sort(
    (a, b) => b.daysOutstanding - a.daysOutstanding,
  )
  const columns = [
    {
      key: 'orderNo',
      header: t('№'),
      render: (r) => <span className="font-mono text-sm">{r.orderNo}</span>,
    },
    { key: 'customerName', header: t('Хүлээн авагч') },
    {
      key: 'phone',
      header: t('Утас'),
      render: (r) => <span className="font-mono tabular-nums">{r.phone}</span>,
    },
    {
      key: 'total',
      header: t('Нийт'),
      align: 'right',
      render: (r) => (
        <span className="font-mono tabular-nums text-ink-muted">
          {formatMoney(r.totalAmount)}
        </span>
      ),
    },
    {
      key: 'paid',
      header: t('Төлсөн'),
      align: 'right',
      render: (r) => (
        <span className="font-mono tabular-nums text-ink-muted">
          {formatMoney(r.paidAmount)}
        </span>
      ),
    },
    {
      key: 'remaining',
      header: t('pay.remaining'),
      align: 'right',
      render: (r) => (
        <span className="font-mono tabular-nums text-alarm">
          {formatMoney(r.remaining)}
        </span>
      ),
    },
    {
      key: 'days',
      header: t('Хоног'),
      align: 'right',
      render: (r) => (
        <span
          className={`font-mono tabular-nums ${r.daysOutstanding >= 7 ? 'text-alarm' : ''}`}
        >
          {r.daysOutstanding}
        </span>
      ),
    },
  ]
  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-y-6 md:flex md:gap-y-0 [&>*]:min-w-0 md:[&>*]:basis-44 md:[&>*]:shrink-0 md:divide-x divide-rule">
        <MetricCard
          label={t('Нийт авлага')}
          value={formatMoneyRound(data.totalRemaining)}
          sub={t('{n} захиалга', { n: data.count })}
        />
      </div>
      <Table
        columns={columns}
        rows={rows}
        onRowClick={(r) => navigate(`/orders/${r.id}`)}
        empty={t('Авлага байхгүй — бүх төлбөр цугларсан')}
      />
    </div>
  )
}

/** Гараар гүйлгээ бүртгэх modal */
function EntryForm({ type, onClose, onDone, t, toast }) {
  const [cats, setCats] = useState(null)
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/finance/categories')
      .then((c) => {
        setCats(c[type])
        setCategory(c[type][0]?.code ?? '')
      })
      .catch(() => setCats([]))
  }, [type])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await api('/finance/entries', {
        method: 'POST',
        body: {
          type,
          category,
          amount: amount.trim(),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(entryDate ? { entryDate: new Date(entryDate).toISOString() } : {}),
        },
      })
      toast.show(t('Гүйлгээ нэмэгдлээ'))
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t(type === 'INCOME' ? 'Шинэ орлого' : 'Шинэ зарлага')}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          id="fe-category"
          label={t('Ангилал')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {(cats ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {t(c.label)}
            </option>
          ))}
        </Select>
        <Input
          id="fe-amount"
          label={t('Дүн')}
          required
          inputMode="decimal"
          pattern="\d{1,10}(\.\d{1,2})?"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="50000"
          className="font-mono"
        />
        <Input
          id="fe-date"
          label={t('Огноо')}
          type="date"
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
        />
        <Input
          id="fe-note"
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
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('Болих')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('Хадгалах')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
