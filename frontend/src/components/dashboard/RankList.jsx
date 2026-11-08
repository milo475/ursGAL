/**
 * TOP жагсаалт (жишээ: DR өндөр жолооч нар).
 * items: [{ id, name, value (баруун талд mono), sub? (нэрний доор жижиг) }]
 */
export default function RankList({ items, empty = '—' }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-ink-muted">{empty}</p>
  }

  return (
    <ol className="divide-y divide-rule">
      {items.map((item, i) => (
        <li key={item.id} className="flex items-center gap-3 py-2.5">
          <span
            className={`font-mono text-sm w-6 h-6 shrink-0 rounded-full border flex items-center justify-center ${
              i === 0
                ? 'text-accent-text border-accent/50 bg-accent/12'
                : 'text-ink-muted border-rule'
            }`}
          >
            {i + 1}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block truncate">{item.name}</span>
            {item.sub && (
              <span className="block text-xs text-ink-muted truncate">
                {item.sub}
              </span>
            )}
          </span>
          <span className="font-mono text-sm tabular-nums shrink-0">
            {item.value}
          </span>
        </li>
      ))}
    </ol>
  )
}
