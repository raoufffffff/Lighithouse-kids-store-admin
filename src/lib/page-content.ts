/**
 * Structured product-page content (what the page builder edits and the store renders).
 *
 * The page is DATA, never HTML: a list of typed sections. `normalizePageContent` is the same
 * sanitiser the store applies before rendering, so what you preview is what visitors get.
 *
 * KEEP IN SYNC with src/lib/page-content.ts in the store repo.
 */

export const ACCENTS = ['sky', 'rose', 'emerald', 'violet', 'amber'] as const
export type Accent = (typeof ACCENTS)[number]

export const ACCENT_META: Record<Accent, { label: string; color: string }> = {
  sky: { label: 'أزرق (الافتراضي)', color: '#24578a' },
  rose: { label: 'وردي', color: '#bf2f52' },
  emerald: { label: 'أخضر', color: '#1f8556' },
  violet: { label: 'بنفسجي', color: '#6443b8' },
  amber: { label: 'كهرماني', color: '#b87108' },
}

export type Section =
  | { id: string; type: 'hero'; badge: string; headline: string; subheadline: string }
  | { id: string; type: 'text'; title: string; body: string }
  | { id: string; type: 'benefits'; title: string; items: { icon: string; title: string; text: string }[] }
  | { id: string; type: 'steps'; title: string; items: { title: string; text: string }[] }
  | { id: string; type: 'specs'; title: string; items: { label: string; value: string }[] }
  | { id: string; type: 'faq'; title: string; items: { q: string; a: string }[] }
  | { id: string; type: 'trust'; items: { icon: string; text: string }[] }
  | { id: string; type: 'images'; images: string[] }
  | { id: string; type: 'cta'; headline: string; text: string; button: string }

export type SectionType = Section['type']

export type PageContent = { v: 1; accent: Accent; sections: Section[] }

export const SECTION_META: Record<SectionType, { label: string; icon: string; hint: string }> = {
  hero: { label: 'العنوان البيعي', icon: '🎯', hint: 'عنوان كبير وجملة تشويقية' },
  text: { label: 'نص', icon: '📝', hint: 'فقرة وصف حرّة' },
  benefits: { label: 'الفوائد', icon: '✨', hint: 'بطاقات بأيقونات' },
  steps: { label: 'طريقة الاستخدام', icon: '🔢', hint: 'خطوات مرقّمة' },
  specs: { label: 'المواصفات', icon: '📏', hint: 'جدول خاصية/قيمة' },
  faq: { label: 'أسئلة شائعة', icon: '❓', hint: 'سؤال وجواب قابل للطي' },
  trust: { label: 'شارات الثقة', icon: '🛡️', hint: 'علامات قصيرة مثل «ضمان»' },
  images: { label: 'صور', icon: '🖼️', hint: 'صور/GIF بعرض الصفحة' },
  cta: { label: 'دعوة للطلب', icon: '🛒', hint: 'زر ينقل الزائر لنموذج الطلب' },
}

export const SECTION_TYPES = Object.keys(SECTION_META) as SectionType[]

const MAX_SECTIONS = 30
const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/$/, '')

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : ''
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Same-origin paths (served by the store) or this project's public storage only. */
export function safeImage(v: unknown): string | null {
  const s = str(v, 700)
  if (!s) return null
  if (/^\/(?!\/)[\w\-./%]+$/.test(s) && !s.includes('..')) return s
  if (SUPABASE_URL && s.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`) && !s.includes('..')) return s
  return null
}

function safeId(v: unknown, i: number): string {
  const s = str(v, 40).replace(/[^\w-]/g, '')
  return s || `s${i}`
}

function normalizeSection(raw: unknown, i: number): Section | null {
  const r = obj(raw)
  const id = safeId(r.id, i)
  switch (r.type) {
    case 'hero': {
      const headline = str(r.headline, 120)
      if (!headline) return null
      return { id, type: 'hero', badge: str(r.badge, 40), headline, subheadline: str(r.subheadline, 300) }
    }
    case 'text': {
      const body = str(r.body, 4000)
      if (!body) return null
      return { id, type: 'text', title: str(r.title, 100), body }
    }
    case 'benefits': {
      const items = list(r.items, 12)
        .map((x) => {
          const o = obj(x)
          return { icon: str(o.icon, 8) || '✨', title: str(o.title, 80), text: str(o.text, 300) }
        })
        .filter((x) => x.title || x.text)
      return items.length ? { id, type: 'benefits', title: str(r.title, 100), items } : null
    }
    case 'steps': {
      const items = list(r.items, 12)
        .map((x) => {
          const o = obj(x)
          return { title: str(o.title, 80), text: str(o.text, 300) }
        })
        .filter((x) => x.title || x.text)
      return items.length ? { id, type: 'steps', title: str(r.title, 100), items } : null
    }
    case 'specs': {
      const items = list(r.items, 20)
        .map((x) => {
          const o = obj(x)
          return { label: str(o.label, 60), value: str(o.value, 160) }
        })
        .filter((x) => x.label && x.value)
      return items.length ? { id, type: 'specs', title: str(r.title, 100), items } : null
    }
    case 'faq': {
      const items = list(r.items, 15)
        .map((x) => {
          const o = obj(x)
          return { q: str(o.q, 160), a: str(o.a, 600) }
        })
        .filter((x) => x.q && x.a)
      return items.length ? { id, type: 'faq', title: str(r.title, 100), items } : null
    }
    case 'trust': {
      const items = list(r.items, 6)
        .map((x) => {
          const o = obj(x)
          return { icon: str(o.icon, 8) || '✅', text: str(o.text, 80) }
        })
        .filter((x) => x.text)
      return items.length ? { id, type: 'trust', items } : null
    }
    case 'images': {
      const images = list(r.images, 30)
        .map(safeImage)
        .filter((x): x is string => x !== null)
      return images.length ? { id, type: 'images', images } : null
    }
    case 'cta': {
      const headline = str(r.headline, 120)
      if (!headline) return null
      return { id, type: 'cta', headline, text: str(r.text, 240), button: str(r.button, 40) || 'اطلب الآن' }
    }
    default:
      return null
  }
}

export function normalizeSingleSection(raw: unknown, i = 0): Section | null {
  return normalizeSection(raw, i)
}

/** Returns null when nothing renderable is left (the store then uses its classic layout). */
export function normalizePageContent(raw: unknown): PageContent | null {
  const r = obj(raw)
  if (r.v !== 1) return null
  const seen = new Set<string>()
  const sections: Section[] = []
  list(r.sections, MAX_SECTIONS).forEach((x, i) => {
    const s = normalizeSection(x, i)
    if (!s) return
    let id = s.id
    while (seen.has(id)) id = `${s.id}_${seen.size}`
    seen.add(id)
    sections.push({ ...s, id } as Section)
  })
  if (sections.length === 0) return null
  const accent = (ACCENTS as readonly string[]).includes(r.accent as string) ? (r.accent as Accent) : 'sky'
  return { v: 1, accent, sections }
}

/**
 * Loads stored JSON for EDITING: keeps empty items/sections the user is still filling in
 * (only the structure is validated), unlike `normalizePageContent` which is for rendering.
 */
export function loadForEditing(raw: unknown): PageContent | null {
  const r = obj(raw)
  if (r.v !== 1 || !Array.isArray(r.sections)) return null
  const accent = (ACCENTS as readonly string[]).includes(r.accent as string) ? (r.accent as Accent) : 'sky'
  const sections: Section[] = []
  const seen = new Set<string>()
  list(r.sections, MAX_SECTIONS).forEach((x, i) => {
    const o = obj(x)
    if (!(SECTION_TYPES as string[]).includes(o.type as string)) return
    const base = newSection(o.type as SectionType)
    const merged = { ...base, ...o } as Record<string, unknown>
    let id = safeId(o.id, i)
    while (seen.has(id)) id = `${id}_${seen.size}`
    seen.add(id)
    merged.id = id
    sections.push(fillStrings(merged) as unknown as Section)
  })
  return { v: 1, accent, sections }
}

/** Coerces every field to the type the editor expects, preserving user text as-is. */
function fillStrings(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { id: s.id, type: s.type }
  for (const [k, v] of Object.entries(s)) {
    if (k === 'id' || k === 'type') continue
    if (k === 'items') out[k] = list(v, 30).map((it) => Object.fromEntries(Object.entries(obj(it)).map(([a, b]) => [a, typeof b === 'string' ? b : ''])))
    else if (k === 'images') out[k] = list(v, 30).filter((x): x is string => typeof x === 'string')
    else out[k] = typeof v === 'string' ? v : ''
  }
  return out
}

const rid = () => crypto.randomUUID().slice(0, 8)

export function newSection(type: SectionType): Section {
  const id = rid()
  switch (type) {
    case 'hero':
      return { id, type, badge: '', headline: '', subheadline: '' }
    case 'text':
      return { id, type, title: '', body: '' }
    case 'benefits':
      return { id, type, title: 'لماذا سيحبّه طفلك؟', items: [{ icon: '✨', title: '', text: '' }] }
    case 'steps':
      return { id, type, title: 'كيف يُستخدم؟', items: [{ title: '', text: '' }] }
    case 'specs':
      return { id, type, title: 'المواصفات', items: [{ label: '', value: '' }] }
    case 'faq':
      return { id, type, title: 'أسئلة شائعة', items: [{ q: '', a: '' }] }
    case 'trust':
      return { id, type, items: [{ icon: '✅', text: '' }] }
    case 'images':
      return { id, type, images: [] }
    case 'cta':
      return { id, type, headline: 'جاهز لتطلبه؟', text: '', button: 'اطلب الآن' }
  }
}

export type ProductSeed = {
  name: string
  description: string | null
  landing_images: string[]
  landing_position: 'above' | 'below'
}

/** A first draft assembled from what the product already has (description + landing images). */
export function starterFromProduct(p: ProductSeed): PageContent {
  const sections: Section[] = [
    { id: rid(), type: 'hero', badge: '', headline: p.name, subheadline: '' },
  ]
  const text: Section | null = p.description?.trim()
    ? { id: rid(), type: 'text', title: 'عن اللعبة', body: p.description.trim() }
    : null
  const images: Section | null = p.landing_images.length
    ? { id: rid(), type: 'images', images: p.landing_images }
    : null
  const ordered: (Section | null)[] = p.landing_position === 'above' ? [images, text] : [text, images]
  for (const s of ordered) if (s) sections.push(s)
  return { v: 1, accent: 'sky', sections }
}

/** Order-independent JSON, so comparing content that went through Postgres jsonb is reliable. */
export function canon(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (x && typeof x === 'object') {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, walk(val)]),
      )
    }
    return x
  }
  return JSON.stringify(walk(v))
}
