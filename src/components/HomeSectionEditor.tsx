import { useState } from 'react'
import { useToast } from './Toast'
import { inputCls } from './ui'
import { ImageField, LinkField, Lbl, MultiPick, NavLinkField } from './HomeFields'
import type { Catalog } from './HomeFields'
import { uploadImages } from '../lib/upload'
import { assetUrl } from '../lib/store'
import type { HomeSection } from '../lib/home-layout'

type Props = { section: HomeSection; onChange: (s: HomeSection) => void; cat: Catalog }

const Row = ({ children }: { children: React.ReactNode }) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>

export default function HomeSectionEditor({ section: s, onChange, cat }: Props) {
  const notify = useToast()
  const [busy, setBusy] = useState(false)
  const set = <T extends HomeSection>(patch: Partial<T>) => onChange({ ...s, ...patch } as HomeSection)

  switch (s.type) {
    case 'hero':
      return (
        <div className="space-y-3">
          <Row>
            <Lbl text="الشارة (اختياري)"><input className={inputCls} maxLength={40} value={s.badge} onChange={(e) => set({ badge: e.target.value })} /></Lbl>
            <Lbl text="التخطيط">
              <select className={inputCls} value={s.layout} onChange={(e) => set({ layout: e.target.value as typeof s.layout })}>
                <option value="split">نص وصورة جنباً إلى جنب</option>
                <option value="center">نص في الوسط</option>
                <option value="banner">صورة خلفية كاملة</option>
              </select>
            </Lbl>
          </Row>
          <Lbl text="العنوان الرئيسي"><input className={inputCls} maxLength={140} value={s.headline} onChange={(e) => set({ headline: e.target.value })} /></Lbl>
          <Lbl text="الوصف"><textarea className={`${inputCls} min-h-[70px]`} maxLength={300} value={s.subheadline} onChange={(e) => set({ subheadline: e.target.value })} /></Lbl>
          {s.layout !== 'center' && <ImageField label="الصورة (وإلا يظهر الشعار)" value={s.image} onChange={(v) => set({ image: v })} />}
          <NavLinkField label="زر الدعوة" value={s.cta} onChange={(v) => set({ cta: v })} cat={cat} />
        </div>
      )
    case 'banner':
      return (
        <div className="space-y-3">
          <ImageField label="صورة البانر" value={s.image || null} onChange={(v) => set({ image: v ?? '' })} />
          <ImageField label="نسخة الهاتف (اختياري)" value={s.mobileImage} onChange={(v) => set({ mobileImage: v })} />
          <Lbl text="نص بديل للصورة"><input className={inputCls} maxLength={120} value={s.alt} onChange={(e) => set({ alt: e.target.value })} /></Lbl>
          <LinkField value={s.link} onChange={(v) => set({ link: v })} cat={cat} />
        </div>
      )
    case 'products':
      return (
        <div className="space-y-3">
          <Row>
            <Lbl text="العنوان"><input className={inputCls} maxLength={100} value={s.title} onChange={(e) => set({ title: e.target.value })} /></Lbl>
            <Lbl text="عنوان فرعي"><input className={inputCls} maxLength={200} value={s.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></Lbl>
          </Row>
          <Row>
            <Lbl text="المصدر">
              <select className={inputCls} value={s.source} onChange={(e) => set({ source: e.target.value as typeof s.source })}>
                <option value="all">كل المنتجات (المميزة أولاً)</option>
                <option value="featured">المنتجات المميزة</option>
                <option value="category">فئة محددة</option>
                <option value="manual">أختارها بنفسي</option>
              </select>
            </Lbl>
            <Lbl text="الأعمدة">
              <select className={inputCls} value={s.columns} onChange={(e) => set({ columns: Number(e.target.value) as 2 | 3 | 4 })}>
                <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
              </select>
            </Lbl>
          </Row>
          {s.source === 'category' && (
            <Lbl text="الفئة">
              <select className={inputCls} value={s.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                <option value="">— اختر —</option>
                {cat.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Lbl>
          )}
          {s.source === 'manual' && <MultiPick label="المنتجات" items={cat.products} value={s.productIds} onChange={(v) => set({ productIds: v })} />}
          <Lbl text="الحد الأقصى للعرض"><input type="number" min={1} max={24} className={inputCls} value={s.limit} onChange={(e) => set({ limit: Number(e.target.value) || 8 })} /></Lbl>
        </div>
      )
    case 'categories':
      return (
        <div className="space-y-3">
          <Row>
            <Lbl text="العنوان"><input className={inputCls} maxLength={100} value={s.title} onChange={(e) => set({ title: e.target.value })} /></Lbl>
            <Lbl text="عنوان فرعي"><input className={inputCls} maxLength={200} value={s.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></Lbl>
          </Row>
          <Lbl text="المصدر">
            <select className={inputCls} value={s.source} onChange={(e) => set({ source: e.target.value as typeof s.source })}>
              <option value="all">كل الفئات</option>
              <option value="manual">أختارها بنفسي</option>
            </select>
          </Lbl>
          {s.source === 'manual' && <MultiPick label="الفئات" items={cat.categories} value={s.categoryIds} onChange={(v) => set({ categoryIds: v })} />}
          <p className="text-xs text-slate-500">صورة الفئة هي صورتها المحفوظة، وإن لم توجد فصورة أول منتج فيها.</p>
        </div>
      )
    case 'text':
      return (
        <div className="space-y-3">
          <Lbl text="العنوان"><input className={inputCls} maxLength={100} value={s.title} onChange={(e) => set({ title: e.target.value })} /></Lbl>
          <Lbl text="النص"><textarea className={`${inputCls} min-h-[110px]`} maxLength={3000} value={s.body} onChange={(e) => set({ body: e.target.value })} /></Lbl>
          <Lbl text="المحاذاة">
            <select className={inputCls} value={s.align} onChange={(e) => set({ align: e.target.value as 'start' | 'center' })}>
              <option value="start">يمين</option><option value="center">وسط</option>
            </select>
          </Lbl>
        </div>
      )
    case 'perks':
      return (
        <div className="space-y-3">
          {s.items.map((it, i) => (
            <div key={i} className="grid grid-cols-[60px_1fr_auto] gap-2 rounded-lg bg-slate-50 p-2">
              <input className={inputCls} maxLength={8} value={it.icon} onChange={(e) => set({ items: s.items.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x)) })} />
              <div className="space-y-1">
                <input className={inputCls} maxLength={60} placeholder="العنوان" value={it.title} onChange={(e) => set({ items: s.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <input className={inputCls} maxLength={200} placeholder="الوصف" value={it.text} onChange={(e) => set({ items: s.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              </div>
              <button type="button" className="text-xs font-bold text-rose-600" onClick={() => set({ items: s.items.filter((_, j) => j !== i) })}>حذف</button>
            </div>
          ))}
          {s.items.length < 8 && (
            <button type="button" className="text-xs font-bold text-brand-600" onClick={() => set({ items: [...s.items, { icon: '✨', title: '', text: '' }] })}>+ ميزة</button>
          )}
        </div>
      )
    case 'gallery':
      return (
        <div className="space-y-3">
          <Row>
            <Lbl text="العنوان"><input className={inputCls} maxLength={100} value={s.title} onChange={(e) => set({ title: e.target.value })} /></Lbl>
            <Lbl text="الأعمدة">
              <select className={inputCls} value={s.columns} onChange={(e) => set({ columns: Number(e.target.value) as 2 | 3 | 4 })}>
                <option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
              </select>
            </Lbl>
          </Row>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {s.items.map((it, i) => (
              <div key={i} className="space-y-1 rounded-lg bg-slate-50 p-2">
                <img src={assetUrl(it.src)} alt="" className="aspect-square w-full rounded object-cover" />
                <LinkField label="رابط الصورة" value={it.link} onChange={(l) => set({ items: s.items.map((x, j) => (j === i ? { ...x, link: l } : x)) })} cat={cat} />
                <button type="button" className="text-xs font-bold text-rose-600" onClick={() => set({ items: s.items.filter((_, j) => j !== i) })}>حذف</button>
              </div>
            ))}
          </div>
          <label className="inline-block cursor-pointer rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-slate-300">
            {busy ? 'جارٍ الرفع…' : '+ إضافة صور'}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files
                setBusy(true)
                const urls = await uploadImages(f, 'home', (m) => notify(m, 'error'))
                setBusy(false)
                e.target.value = ''
                if (urls.length) set({ items: [...s.items, ...urls.map((src) => ({ src, link: null }))].slice(0, 12) })
              }}
            />
          </label>
        </div>
      )
    case 'cta':
      return (
        <div className="space-y-3">
          <Lbl text="العنوان"><input className={inputCls} maxLength={140} value={s.headline} onChange={(e) => set({ headline: e.target.value })} /></Lbl>
          <Lbl text="النص"><textarea className={`${inputCls} min-h-[60px]`} maxLength={300} value={s.text} onChange={(e) => set({ text: e.target.value })} /></Lbl>
          <Lbl text="اللون">
            <select className={inputCls} value={s.tone} onChange={(e) => set({ tone: e.target.value as typeof s.tone })}>
              <option value="brand">أزرق</option><option value="sun">أصفر</option><option value="dark">داكن</option>
            </select>
          </Lbl>
          <NavLinkField label="الزر" value={s.button} onChange={(v) => set({ button: v })} cat={cat} />
        </div>
      )
  }
}
