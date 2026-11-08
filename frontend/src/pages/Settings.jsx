import { useEffect, useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LanguageContext'
import { useTheme } from '../context/ThemeContext'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { DM_TOKENS } from '../lib/dmMessage'

function OptionGroup({ label, options, value, onChange, note }) {
  return (
    <section className="mt-10 first:mt-0">
      <p className="text-xs uppercase tracking-wide text-ink-muted mb-3">
        {label}
      </p>
      <div className="inline-flex border border-rule rounded overflow-hidden">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-4 py-2 text-sm transition-colors ${
              value === o.value
                ? 'bg-surface text-ink'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {note && <p className="mt-3 text-sm text-ink-muted max-w-md">{note}</p>}
    </section>
  )
}

export default function Settings() {
  const { lang, setLang, t } = useLang()
  const { theme, setTheme } = useTheme()
  const { user } = useAuth()

  return (
    <div className="max-w-2xl">
      <h1 className="font-serif text-4xl font-medium">{t('Тохиргоо')}</h1>
      {user?.lastLoginAt && (
        <p className="mt-2 font-mono text-xs text-ink-muted tabular-nums">
          {t('Сүүлд нэвтэрсэн')}: {formatDateTime(user.lastLoginAt)}
        </p>
      )}

      <div className="mt-10 border-t border-rule pt-8">
        <OptionGroup
          label={t('Хэл')}
          value={lang}
          onChange={setLang}
          options={[
            { value: 'mn', label: 'Монгол' },
            { value: 'en', label: 'English' },
          ]}
          note={t(
            'Интерфэйсийн хэлийг сонгоно. Серверийн алдааны мессежүүд одоогоор зөвхөн монголоор ирдэг.',
          )}
        />

        <OptionGroup
          label={t('Тема')}
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'dark', label: t('Харанхуй') },
            { value: 'light', label: t('Цайвар') },
          ]}
        />
      </div>

      <LoginHistory t={t} />

      <SystemSettings t={t} />
    </div>
  )
}

/**
 * НЭВТРЭЛТИЙН ТҮҮХ (V5) — хүн бүр ӨӨРИЙНХӨӨ түүхийг харна.
 *
 * «Миний бүртгэлээр өөр хүн орсон уу» гэдгийг зөвхөн тухайн хүн
 * таньж чадна: танихгүй төхөөрөмж, танихгүй цаг харвал шууд мэднэ.
 * Тиймээс админд биш, хэрэглэгч бүрт харуулах нь үр дүнтэй.
 */
function LoginHistory({ t }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    api('/auth/login-history')
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  if (!rows?.length) return null

  return (
    <section className="mt-12 border-t border-rule pt-8">
      <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">
        {t('Миний нэвтрэлтүүд')}
      </p>
      <p className="text-sm text-ink-muted mb-4">
        {t(
          'Танихгүй төхөөрөмж эсвэл цаг харвал нууц үгээ солиод админд мэдэгдээрэй.',
        )}
      </p>
      <ul className="border border-rule rounded-lg divide-y divide-rule">
        {rows.map((r) => (
          <li
            key={r.id}
            className="px-4 py-2.5 flex items-baseline justify-between gap-4 flex-wrap"
          >
            <span className="text-sm">{r.device}</span>
            <span className="font-mono text-xs text-ink-muted tabular-nums">
              {formatDateTime(r.at)}
              {r.ip ? ` · ${r.ip}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Системийн тохиргоо — settings.edit эрхтэйд л харагдана */
function SystemSettings({ t }) {
  const { hasPerm } = useAuth()
  const toast = useToast()
  const canEdit = hasPerm('settings.edit')

  const [values, setValues] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!canEdit) return
    api('/settings')
      .then(setValues)
      .catch(() => {})
  }, [canEdit])

  if (!canEdit || !values) return null

  async function save() {
    setSaving(true)
    try {
      const fresh = await api('/settings', { method: 'PUT', body: values })
      setValues(fresh)
      toast.show(t('Тохиргоо хадгалагдлаа'))
    } catch (e) {
      toast.show(e.message, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-12 border-t border-rule pt-8 max-w-xl">
      <p className="text-xs uppercase tracking-wide text-ink-muted mb-4">
        {t('Системийн тохиргоо')}
      </p>
      <div className="space-y-4">
        <Input
          id="st-company"
          label={t('Компанийн нэр')}
          value={values.companyName}
          onChange={(e) =>
            setValues((v) => ({ ...v, companyName: e.target.value }))
          }
        />
        <Input
          id="st-phone"
          label={t('Компанийн утас')}
          value={values.companyPhone}
          onChange={(e) =>
            setValues((v) => ({ ...v, companyPhone: e.target.value }))
          }
          className="font-mono"
        />
      </div>

      {/* Банкны данс (V5) — нийтийн захиалгын хуудас ба DM-ийн хариунд
          орно. Хоосон бол мессежид «удахгүй илгээнэ» гэж гарна. */}
      <p className="mt-10 text-xs uppercase tracking-wide text-ink-muted mb-4">
        {t('Төлбөр хүлээн авах данс')}
      </p>
      <div className="space-y-4">
        <Input
          id="st-bank"
          label={t('Банк')}
          value={values.bankName}
          onChange={(e) =>
            setValues((v) => ({ ...v, bankName: e.target.value }))
          }
        />
        <Input
          id="st-acct"
          label={t('Дансны дугаар')}
          value={values.bankAccount}
          onChange={(e) =>
            setValues((v) => ({ ...v, bankAccount: e.target.value }))
          }
          className="font-mono"
        />
        <Input
          id="st-holder"
          label={t('Данс эзэмшигч')}
          value={values.bankHolder}
          onChange={(e) =>
            setValues((v) => ({ ...v, bankHolder: e.target.value }))
          }
        />
      </div>

      {/* Хугацааны анхааруулга (V5) */}
      <p className="mt-10 text-xs uppercase tracking-wide text-ink-muted mb-4">
        {t('Хугацааны хяналт')}
      </p>
      <Input
        id="st-expiry"
        label={t('Дуусахаас хэдэн хоногийн өмнө анхааруулах')}
        type="number"
        min="1"
        value={values.expiryWarnDays}
        onChange={(e) =>
          setValues((v) => ({ ...v, expiryWarnDays: e.target.value }))
        }
        className="font-mono"
      />

      {/* Давтан захиалгын сануулга (V5) */}
      <p className="mt-10 text-xs uppercase tracking-wide text-ink-muted mb-4">
        {t('Давтан захиалгын сануулга')}
      </p>
      <div className="space-y-4">
        <Input
          id="st-days"
          label={t('Барааны ердийн хэрэглээ (хоног)')}
          type="number"
          min="1"
          value={values.defaultDaysSupply}
          onChange={(e) =>
            setValues((v) => ({ ...v, defaultDaysSupply: e.target.value }))
          }
          className="font-mono"
        />
        <p className="-mt-2 text-xs text-ink-muted">
          {t(
            'Бараанд тусад нь заагаагүй бол нэг ширхэг нь хэдэн хоног хүрэх вэ.',
          )}
        </p>
        <Input
          id="st-lead"
          label={t('Дуусахаас хэдэн хоногийн өмнө сануулах')}
          type="number"
          min="0"
          value={values.reorderLeadDays}
          onChange={(e) =>
            setValues((v) => ({ ...v, reorderLeadDays: e.target.value }))
          }
          className="font-mono"
        />
        <Input
          id="st-overdue"
          label={t('Хэдэн хоног хоцорсныг жагсаалтаас хасах')}
          type="number"
          min="1"
          value={values.reorderMaxOverdue}
          onChange={(e) =>
            setValues((v) => ({ ...v, reorderMaxOverdue: e.target.value }))
          }
          className="font-mono"
        />
        <p className="-mt-2 text-xs text-ink-muted">
          {t('Үүнээс их хоцорсон хүнийг эргэж ирэхгүй гэж үзнэ.')}
        </p>
      </div>
      <label
        htmlFor="st-remind"
        className="block mt-4 text-xs uppercase tracking-wide text-ink-muted mb-1.5"
      >
        {t('Сануулгын загвар')}
      </label>
      <textarea
        id="st-remind"
        rows={9}
        value={values.reorderTemplate}
        onChange={(e) =>
          setValues((v) => ({ ...v, reorderTemplate: e.target.value }))
        }
        className="w-full bg-bg border border-rule rounded px-3 py-2 text-sm leading-relaxed resize-y focus:outline-none focus:border-ink-muted"
      />
      <p className="mt-2 text-xs text-ink-muted">
        <span className="font-mono text-accent-text">
          {'{нэр} {бараа} {хоног} {утас} {компани}'}
        </span>
      </p>

      {/* DM-ийн хариу загвар (V5) */}
      <p className="mt-10 text-xs uppercase tracking-wide text-ink-muted mb-4">
        {t('Үйлчлүүлэгч рүү илгээх хариу')}
      </p>
      <label
        htmlFor="st-dm"
        className="block text-xs uppercase tracking-wide text-ink-muted mb-1.5"
      >
        {t('Мессежийн загвар')}
      </label>
      <textarea
        id="st-dm"
        rows={14}
        value={values.dmTemplate}
        onChange={(e) =>
          setValues((v) => ({ ...v, dmTemplate: e.target.value }))
        }
        className="w-full bg-bg border border-rule rounded px-3 py-2 text-sm leading-relaxed resize-y focus:outline-none focus:border-ink-muted"
      />
      <div className="mt-3 border border-rule rounded p-3">
        <p className="text-xs text-ink-muted mb-2">
          {t('Дараах түлхүүрүүд бодит утгаар солигдоно')}:
        </p>
        <dl className="space-y-1">
          {DM_TOKENS.map(([token, note]) => (
            <div key={token} className="flex gap-2 text-xs">
              <dt className="font-mono text-accent-text shrink-0">{token}</dt>
              <dd className="text-ink-muted">{t(note)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <Button onClick={save} loading={saving} className="w-full mt-8">
        {t('Хадгалах')}
      </Button>
    </section>
  )
}

