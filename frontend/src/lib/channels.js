/**
 * Захиалга ирсэн суваг (V5). Захиалга IG/FB-ийн DM-ээр ирж, ажилтан
 * шивдэг тул эх сурвалжийг тэмдэглэж маркетингийн үр дүнг хэмждэг.
 */
export const CHANNELS = [
  ['INSTAGRAM', 'Instagram', 'text-accent-text border-accent/40 bg-accent/12'],
  ['FACEBOOK', 'Facebook', 'text-safe border-safe/40 bg-safe/12'],
  ['PHONE', 'Утас', 'text-status-preparing border-status-preparing/40 bg-status-preparing/12'],
  ['OTHER', 'Бусад', 'text-ink-muted border-rule'],
]

export const channelLabel = (c) =>
  CHANNELS.find(([k]) => k === c)?.[1] ?? c

export const channelStyle = (c) =>
  CHANNELS.find(([k]) => k === c)?.[2] ?? 'text-ink-muted border-rule'
