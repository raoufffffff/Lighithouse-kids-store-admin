import { useState } from 'react'
import { useToast } from './Toast'
import { inputCls } from './ui'
import { assetUrl } from '../lib/store'
import { uploadImages } from '../lib/upload'
import type { LinkRef, NavLink } from '../lib/home-layout'

export type Catalog = {
  products: { id: string; name: string; slug: string; images: string[] }[]
  categories: { id: string; name: string; slug: string }[]
}

const labelCls = 'block text-xs font-bold text-slate-600'

export function Lbl({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className={labelCls}>
      <span className="mb-1 block">{text}</span>
      {children}
    </label>
  )
}

export function ImageField({ value, onChange, label = 'صورة', folder = 'home' }: { value: string | null; onChange: (v: string | null) => void; label?: string; folder?: string }) {
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <div>
      <span className={`${labelCls} mb-1 block`}>{label}</span>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={assetUrl(value)} alt="" className="h-16 w-24 rounded-lg border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">بلا صورة</div>
        )}
        <div className="flex flex-col gap-1">
          <label className="cursor-pointer rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-slate-300 hover:bg-slate-50">
            {busy ? 'جارٍ الرفع…' : value ? 'استبدال' : 'رفع صورة'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files
                setBusy(true)
                const [url] = await uploadImages(f, folder, (m) => notify(m, 'error'))
                setBusy(false)
                e.target.value = ''
                if (url) onChange(url)
              }}
            />
          </label>
          {value && <button type="button" className="text-xs font-bold text-rose-600" onClick={() => onChange(null)}>إزالة</button>}
        </div>
      </div>
    </div>
  )
}

const LINK_TYPES = [
  { v: 'none', l: 'بلا رابط' },
  { v: 'home', l: 'الصفحة الرئيسية' },
  { v: 'products', l: 'قسم المنتجات' },
  { v: 'category', l: 'فئة' },
  { v: 'product', l: 'منتج' },
  { v: 'url', l: 'رابط خارجي' },
] as const

export function LinkField({ value, onChange, cat, label = 'الرابط' }: { value: LinkRef | null; onChange: (v: LinkRef | null) => void; cat: Catalog; label?: string }) {
  const type = value?.type ?? 'none'
  const set = (t: string) => {
    if (t === 'none') return onChange(null)
    if (t === 'home' || t === 'products') return onChange({ type: t })
    if (t === 'category') return onChange({ type: 'category', ref: cat.categories[0]?.id ?? '' })
    if (t === 'product') return onChange({ type: 'product', ref: cat.products[0]?.id ?? '' })
    onChange({ type: 'url', ref: 'https://' })
  }
  return (
    <div>
      <span className={`${labelCls} mb-1 block`}>{label}</span>
      <div className="flex flex-wrap gap-2">
        <select className={`${inputCls} !w-auto`} value={type} onChange={(e) => set(e.target.value)}>
          {LINK_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        {value?.type === 'category' && (
          <select className={`${inputCls} !w-auto`} value={value.ref} onChange={(e) => onChange({ type: 'category', ref: e.target.value })}>
            {cat.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {value?.type === 'product' && (
          <select className={`${inputCls} !w-auto max-w-[220px]`} value={value.ref} onChange={(e) => onChange({ type: 'product', ref: e.target.value })}>
            {cat.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {value?.type === 'url' && (
          <input dir="ltr" className={`${inputCls} flex-1`} value={value.ref} onChange={(e) => onChange({ type: 'url', ref: e.target.value })} placeholder="https://… أو tel:+213…" />
        )}
      </div>
    </div>
  )
}

export function NavLinkField({ value, onChange, cat, label }: { value: NavLink | null; onChange: (v: NavLink | null) => void; cat: Catalog; label: string }) {
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <span className={labelCls}>{label}</span>
        {value ? (
          <button type="button" className="text-xs font-bold text-rose-600" onClick={() => onChange(null)}>إزالة</button>
        ) : (
          <button type="button" className="text-xs font-bold text-brand-600" onClick={() => onChange({ label: 'اضغط هنا', link: { type: 'products' } })}>+ إضافة</button>
        )}
      </div>
      {value && (
        <>
          <input className={inputCls} maxLength={40} value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} placeholder="نص الزر" />
          <LinkField value={value.link} onChange={(l) => onChange({ ...value, link: l ?? { type: 'home' } })} cat={cat} />
        </>
      )}
    </div>
  )
}

/** Multi-select as a checklist (keeps the chosen order = click order). */
export function MultiPick({ items, value, onChange, label }: { items: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div>
      <span className={`${labelCls} mb-1 block`}>{label} ({value.length})</span>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {items.length === 0 && <p className="text-xs text-slate-400">لا توجد عناصر.</p>}
        {items.map((it) => (
          <label key={it.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(it.id)} onChange={() => toggle(it.id)} />
            <span dir="auto">{it.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
