export const dzd = (n: number | string | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} د.ج`

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ar-DZ-u-nu-latn', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

/** Keeps Arabic/Latin letters and digits; spaces become dashes. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export const randomSuffix = () => Math.random().toString(36).slice(2, 7)

export const toNumberOrNull = (v: string): number | null => {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
