import { useLang } from '../../context/LanguageContext'

/** Хүргэлтийн бүсийн жижиг badge: УБ / Орон нутаг */
export default function RegionBadge({ region }) {
  const { t } = useLang()
  const ub = region === 'ULAANBAATAR'
  return (
    <span
      className={`inline-flex font-mono text-[10px] uppercase tracking-wide border rounded px-1 py-0.5 ${
        ub
          ? 'text-ink-muted border-rule'
          : 'text-accent-text border-accent/40 bg-accent/10'
      }`}
    >
      {ub ? t('УБ') : t('Орон нутаг')}
    </span>
  )
}
