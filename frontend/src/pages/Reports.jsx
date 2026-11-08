import { useState } from 'react'
import { Boxes, Download, Truck, Wallet } from 'lucide-react'
import Button from '../components/ui/Button'
import Select from '../components/ui/Select'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LanguageContext'
import { apiBlob } from '../lib/api'

const REPORTS = [
  {
    key: 'delivery',
    title: 'Хүргэлтийн тайлан',
    note: 'Захиалга, хаяг, жолооч, хүргэсэн огноо',
    icon: Truck,
    perm: 'reports.delivery',
  },
  {
    key: 'inventory',
    title: 'Агуулахын тайлан',
    note: 'Үлдэгдлийн бүх хөдөлгөөн',
    icon: Boxes,
    perm: 'reports.inventory',
  },
  {
    key: 'finance',
    title: 'Санхүүгийн тайлан',
    note: 'Орлого, зарлагын гүйлгээнүүд',
    icon: Wallet,
    perm: 'reports.finance',
  },
]

const RANGES = [7, 30, 90]

function fromFor(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (days - 1))
  return d.toISOString()
}

function ReportCard({ report, t, toast }) {
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const { blob, filename } = await apiBlob(
        `/reports/${report.key}.csv?from=${encodeURIComponent(fromFor(days))}`,
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast.show(t('Тайлан татагдлаа'))
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 flex flex-col">
      <div className="flex items-center gap-3">
        <report.icon size={20} className="text-accent-text shrink-0" />
        <p className="font-medium">{t(report.title)}</p>
      </div>
      <p className="mt-1.5 text-sm text-ink-muted flex-1">{t(report.note)}</p>
      <div className="mt-4 flex items-end gap-3">
        <Select
          id={`rp-${report.key}`}
          label={t('Интервал')}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="flex-1"
        >
          {RANGES.map((n) => (
            <option key={n} value={n}>
              {t('Сүүлийн {n} хоног', { n })}
            </option>
          ))}
        </Select>
        <Button onClick={download} loading={busy}>
          <Download size={15} />
          {t('CSV татах')}
        </Button>
      </div>
    </div>
  )
}

export default function Reports() {
  const { t } = useLang()
  const { hasPerm } = useAuth()
  const toast = useToast()

  const visible = REPORTS.filter((r) => hasPerm(r.perm))

  return (
    <div className="max-w-4xl">
      <h1 className="font-serif text-4xl font-medium">{t('Тайлан')}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {t('CSV файлууд Excel-д кирилл үсгээрээ зөв нээгдэнэ (UTF-8 BOM)')}
      </p>
      <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((r) => (
          <ReportCard key={r.key} report={r} t={t} toast={toast} />
        ))}
      </div>
    </div>
  )
}
