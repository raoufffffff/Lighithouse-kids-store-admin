/**
 * Home page + header layout (what the home builder edits and the store renders).
 *
 * Like the product page builder, this is DATA, never HTML: a header config and a list of typed
 * sections rendered by the store's own components. `normalizeHomeLayout` is the sanitiser both the
 * store and the admin preview apply, so what you preview is what visitors get.
 *
 * KEEP IN SYNC with src/lib/home-layout.ts in the other repo.
 */

const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/$/, '')

export type LinkRef =
  | { type: 'home' }
  | { type: 'products' } // the products section anchor on the home page
  | { type: 'category'; ref: string } // category id
  | { type: 'product'; ref: string } // product id
  | { type: 'url'; ref: string }

export type NavLink = { label: string; link: LinkRef }

export type HeaderConfig = {
  style: 'light' | 'brand' | 'dark'
  showName: boolean
  logoSize: 'sm' | 'md' | 'lg'
  announcement: { enabled: boolean; text: string; link: LinkRef | null; tone: 'brand' | 'sun' | 'dark' }
  links: NavLink[]
  cta: NavLink | null
}

export type HomeSection =
  | { id: string; type: 'hero'; layout: 'split' | 'center' | 'banner'; badge: string; headline: string; subheadline: string; image: string | null; cta: NavLink | null }
  | { id: string; type: 'banner'; image: string; mobileImage: string | null; alt: string; link: LinkRef | null }
  | { id: string; type: 'products'; title: string; subtitle: string; source: 'all' | 'featured' | 'latest' | 'category' | 'manual'; categoryId: string; productIds: string[]; limit: number; columns: 2 | 3 | 4 }
  | { id: string; type: 'categories'; title: string; subtitle: string; source: 'all' | 'manual'; categoryIds: string[] }
  | { id: string; type: 'text'; title: string; body: string; align: 'start' | 'center' }
  | { id: string; type: 'perks'; items: { icon: string; title: string; text: string }[] }
  | { id: string; type: 'gallery'; title: string; columns: 2 | 3 | 4; items: { src: string; link: LinkRef | null }[] }
  | { id: string; type: 'cta'; headline: string; text: string; button: NavLink | null; tone: 'brand' | 'sun' | 'dark' }

export type HomeSectionType = HomeSection['type']
export type HomeLayout = { v: 1; header: HeaderConfig; sections: HomeSection[] }

export const HOME_SECTION_TYPES: { type: HomeSectionType; label: string; icon: string }[] = [
  { type: 'hero', label: 'واجهة رئيسية', icon: '🌟' },
  { type: 'banner', label: 'بانر صورة', icon: '🖼️' },
  { type: 'products', label: 'منتجات', icon: '🧸' },
  { type: 'categories', label: 'فئات', icon: '🗂️' },
  { type: 'gallery', label: 'معرض صور', icon: '📷' },
  { type: 'text', label: 'نص', icon: '📝' },
  { type: 'perks', label: 'مزايا', icon: '✅' },
  { type: 'cta', label: 'دعوة للشراء', icon: '📣' },
]

const MAX_SECTIONS = 20

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : ''
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt
const uuid = (v: unknown): string => {
  const s = str(v, 40)
  return /^[0-9a-f-]{36}$/i.test(s) ? s : ''
}

/** Same-origin paths or this project's public storage only. */
export function safeImg(v: unknown): string | null {
  const s = str(v, 700)
  if (!s) return null
  if (/^\/(?!\/)[\w\-./%]+$/.test(s) && !s.includes('..')) return s
  if (SUPABASE_URL && s.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`) && !s.includes('..')) return s
  return null
}

/** Links may only go to this site, https pages, phone numbers or WhatsApp. Never javascript: or data:. */
export function safeUrl(v: unknown): string | null {
  const s = str(v, 500)
  if (!s) return null
  if (/^\/(?!\/)[\w\-./%?=&#]*$/.test(s)) return s
  if (/^https:\/\/[^\s<>"']+$/i.test(s)) return s
  if (/^tel:\+?[\d]{6,15}$/.test(s)) return s
  return null
}

export function normalizeLink(raw: unknown): LinkRef | null {
  const r = obj(raw)
  switch (r.type) {
    case 'home':
      return { type: 'home' }
    case 'products':
      return { type: 'products' }
    case 'category': {
      const ref = uuid(r.ref)
      return ref ? { type: 'category', ref } : null
    }
    case 'product': {
      const ref = uuid(r.ref)
      return ref ? { type: 'product', ref } : null
    }
    case 'url': {
      const ref = safeUrl(r.ref)
      return ref ? { type: 'url', ref } : null
    }
    default:
      return null
  }
}

function navLink(raw: unknown): NavLink | null {
  const r = obj(raw)
  const label = str(r.label, 40)
  const link = normalizeLink(r.link)
  return label && link ? { label, link } : null
}

export const DEFAULT_HEADER: HeaderConfig = {
  style: 'light',
  showName: true,
  logoSize: 'md',
  announcement: { enabled: false, text: '', link: null, tone: 'brand' },
  links: [{ label: 'الألعاب', link: { type: 'products' } }],
  cta: null,
}

export function normalizeHeader(raw: unknown): HeaderConfig {
  const r = obj(raw)
  const a = obj(r.announcement)
  const text = str(a.text, 160)
  return {
    style: pick(r.style, ['light', 'brand', 'dark'] as const, 'light'),
    showName: r.showName !== false,
    logoSize: pick(r.logoSize, ['sm', 'md', 'lg'] as const, 'md'),
    announcement: {
      enabled: a.enabled === true && !!text,
      text,
      link: normalizeLink(a.link),
      tone: pick(a.tone, ['brand', 'sun', 'dark'] as const, 'brand'),
    },
    links: list(r.links, 6).map(navLink).filter((x): x is NavLink => !!x),
    cta: navLink(r.cta),
  }
}

function safeId(v: unknown, i: number): string {
  const s = str(v, 40).replace(/[^\w-]/g, '')
  return s || `s${i}`
}

function normalizeSection(raw: unknown, i: number): HomeSection | null {
  const r = obj(raw)
  const id = safeId(r.id, i)
  switch (r.type) {
    case 'hero': {
      const headline = str(r.headline, 140)
      if (!headline) return null
      return {
        id,
        type: 'hero',
        layout: pick(r.layout, ['split', 'center', 'banner'] as const, 'split'),
        badge: str(r.badge, 40),
        headline,
        subheadline: str(r.subheadline, 300),
        image: safeImg(r.image),
        cta: navLink(r.cta),
      }
    }
    case 'banner': {
      const image = safeImg(r.image)
      if (!image) return null
      return { id, type: 'banner', image, mobileImage: safeImg(r.mobileImage), alt: str(r.alt, 120), link: normalizeLink(r.link) }
    }
    case 'products': {
      const limit = Math.max(1, Math.min(24, Math.round(Number(r.limit)) || 8))
      return {
        id,
        type: 'products',
        title: str(r.title, 100),
        subtitle: str(r.subtitle, 200),
        source: pick(r.source, ['all', 'featured', 'latest', 'category', 'manual'] as const, 'all'),
        categoryId: uuid(r.categoryId),
        productIds: list(r.productIds, 24).map(uuid).filter(Boolean),
        limit,
        columns: ([2, 3, 4] as const).find((c) => c === Number(r.columns)) ?? 4,
      }
    }
    case 'categories':
      return {
        id,
        type: 'categories',
        title: str(r.title, 100),
        subtitle: str(r.subtitle, 200),
        source: pick(r.source, ['all', 'manual'] as const, 'all'),
        categoryIds: list(r.categoryIds, 24).map(uuid).filter(Boolean),
      }
    case 'text': {
      const body = str(r.body, 3000)
      if (!body) return null
      return { id, type: 'text', title: str(r.title, 100), body, align: pick(r.align, ['start', 'center'] as const, 'start') }
    }
    case 'perks': {
      const items = list(r.items, 8)
        .map((x) => {
          const o = obj(x)
          return { icon: str(o.icon, 8) || '✨', title: str(o.title, 60), text: str(o.text, 200) }
        })
        .filter((x) => x.title || x.text)
      return items.length ? { id, type: 'perks', items } : null
    }
    case 'gallery': {
      const items = list(r.items, 12)
        .map((x) => {
          const o = obj(x)
          const src = safeImg(o.src)
          return src ? { src, link: normalizeLink(o.link) } : null
        })
        .filter((x): x is { src: string; link: LinkRef | null } => !!x)
      return items.length
        ? { id, type: 'gallery', title: str(r.title, 100), columns: ([2, 3, 4] as const).find((c) => c === Number(r.columns)) ?? 3, items }
        : null
    }
    case 'cta': {
      const headline = str(r.headline, 140)
      if (!headline) return null
      return { id, type: 'cta', headline, text: str(r.text, 300), button: navLink(r.button), tone: pick(r.tone, ['brand', 'sun', 'dark'] as const, 'brand') }
    }
    default:
      return null
  }
}

/** Returns null when there is nothing usable (the store then keeps its built-in home page). */
export function normalizeHomeLayout(raw: unknown): HomeLayout | null {
  const r = obj(raw)
  if (r.v !== 1) return null
  const sections = list(r.sections, MAX_SECTIONS)
    .map(normalizeSection)
    .filter((x): x is HomeSection => !!x)
  if (sections.length === 0) return null
  // unique ids
  const seen = new Set<string>()
  sections.forEach((s, i) => {
    if (seen.has(s.id)) s.id = `${s.id}-${i}`
    seen.add(s.id)
  })
  return { v: 1, header: normalizeHeader(r.header), sections }
}

export type LinkContext = { products: { id: string; slug: string }[]; categories: { id: string; slug: string }[] }

/** Final href for a link, or null when its target no longer exists. */
export function resolveLink(link: LinkRef | null | undefined, ctx: LinkContext): string | null {
  if (!link) return null
  switch (link.type) {
    case 'home':
      return '/'
    case 'products':
      return '/#products'
    case 'url':
      return link.ref
    case 'product': {
      const p = ctx.products.find((x) => x.id === link.ref)
      return p ? `/p/${encodeURIComponent(p.slug)}` : null
    }
    case 'category': {
      const c = ctx.categories.find((x) => x.id === link.ref)
      return c ? `/c/${encodeURIComponent(c.slug)}` : null
    }
  }
}

export const newSectionId = () => `s${Math.random().toString(36).slice(2, 8)}`

export function makeSection(type: HomeSectionType): HomeSection {
  const id = newSectionId()
  switch (type) {
    case 'hero':
      return { id, type, layout: 'split', badge: '', headline: 'عنوان رئيسي جذّاب', subheadline: 'وصف قصير يشرح لماذا يختارك الزبون.', image: null, cta: { label: 'تصفّح الألعاب', link: { type: 'products' } } }
    case 'banner':
      return { id, type, image: '', mobileImage: null, alt: '', link: null } as unknown as HomeSection
    case 'products':
      return { id, type, title: 'ألعابنا', subtitle: '', source: 'all', categoryId: '', productIds: [], limit: 8, columns: 4 }
    case 'categories':
      return { id, type, title: 'تسوّق حسب الفئة', subtitle: '', source: 'all', categoryIds: [] }
    case 'text':
      return { id, type, title: '', body: 'اكتب هنا نصاً تعريفياً.', align: 'start' }
    case 'perks':
      return { id, type, items: [{ icon: '🚚', title: 'توصيل لكل الولايات', text: 'إلى باب المنزل أو المكتب' }, { icon: '💵', title: 'الدفع عند الاستلام', text: 'تعاين ثم تدفع' }] }
    case 'gallery':
      return { id, type, title: '', columns: 3, items: [] } as unknown as HomeSection
    case 'cta':
      return { id, type, headline: 'جاهز لتختار لعبة طفلك؟', text: '', button: { label: 'تسوّق الآن', link: { type: 'products' } }, tone: 'brand' }
  }
}
