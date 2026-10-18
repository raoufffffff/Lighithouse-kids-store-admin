import { useCallback, useEffect, useMemo, useState } from 'react'
import { ERRORS, TONES } from '../components/AiGenerateCard'
import { Lbl, NavLinkField } from '../components/HomeFields'
import type { Catalog } from '../components/HomeFields'
import HomeSectionEditor from '../components/HomeSectionEditor'
import PreviewFrame from '../components/PreviewFrame'
import { useToast } from '../components/Toast'
import { Button, Card, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { DEFAULT_HEADER, HOME_SECTION_TYPES, makeSection, normalizeHomeLayout } from '../lib/home-layout'
import type { HeaderConfig, HomeLayout, HomeSection, HomeSectionType } from '../lib/home-layout'
import { STORE_URL, refreshStore } from '../lib/store'
import { supabase } from '../lib/supabase'

type ProductRow = {
  id: string; name: string; slug: string; base_price: number; compare_at_price: number | null
  images: string[] | null; is_featured: boolean; category_id: string | null
}
type CategoryRow = { id: string; name: string; slug: string; image_url: string | null }
type StoreInfo = { name: string; tagline: string; logo_url: string }

const starter = (): HomeLayout => ({
  v: 1,
  header: DEFAULT_HEADER,
  sections: [makeSection('hero'), makeSection('perks'), makeSection('products')],
})

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export default function HomeBuilder() {
  const notify = useToast()
  const [loading, setLoading] = useState(true)
  const [layout, setLayout] = useState<HomeLayout>(starter)
  const [saved, setSaved] = useState<HomeLayout | null>(null) // draft as stored
  const [published, setPublished] = useState<HomeLayout | null>(null)
  const [store, setStore] = useState<StoreInfo>({ name: 'المتجر', tagline: '', logo_url: '' })
  const [products, setProducts] = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [headerOpen, setHeaderOpen] = useState(false)
  const [busy, setBusy] = useState<'' | 'save' | 'publish' | 'unpublish' | 'ai'>('')
  const [history, setHistory] = useState<HomeLayout[]>([])
  const [tone, setTone] = useState<(typeof TONES)[number]['id']>('friendly')
  const [brief, setBrief] = useState('')
  const [aiError, setAiError] = useState('')
  const [addType, setAddType] = useState<HomeSectionType>('banner')

  useEffect(() => {
    ;(async () => {
      const [s, p, c] = await Promise.all([
        supabase.from('lh_store_settings').select('key,value').in('key', ['store', 'home_layout', 'home_layout_draft']),
        supabase.from('lh_products').select('id,name,slug,base_price,compare_at_price,images,is_featured,category_id').eq('is_active', true).order('created_at', { ascending: false }),
        supabase.from('lh_categories').select('id,name,slug,image_url').eq('is_active', true).order('sort_order').order('name'),
      ])
      if (s.error || p.error || c.error) notify('تعذّر التحميل: ' + (s.error ?? p.error ?? c.error)?.message, 'error')
      const map = new Map((s.data ?? []).map((r) => [r.key as string, r.value]))
      const st = (map.get('store') ?? {}) as Partial<StoreInfo>
      setStore({ name: st.name || 'المتجر', tagline: st.tagline ?? '', logo_url: st.logo_url ?? '' })
      setProducts((p.data ?? []) as ProductRow[])
      setCategories((c.data ?? []) as CategoryRow[])
      const pub = normalizeHomeLayout(map.get('home_layout'))
      const draft = normalizeHomeLayout(map.get('home_layout_draft'))
      setPublished(pub)
      setSaved(draft)
      setLayout(draft ?? pub ?? starter())
      setLoading(false)
    })()
  }, [notify])

  const cat: Catalog = useMemo(
    () => ({
      products: products.map((x) => ({ id: x.id, name: x.name, slug: x.slug, images: x.images ?? [] })),
      categories: categories.map((x) => ({ id: x.id, name: x.name, slug: x.slug })),
    }),
    [products, categories],
  )

  const payload = useMemo(
    () => ({
      layout,
      store,
      products: products.map((x) => ({
        ...x,
        images: (x.images ?? []).slice(0, 3),
        category: categories.find((c) => c.id === x.category_id)?.name ?? null,
      })),
      categories,
    }),
    [layout, store, products, categories],
  )

  const change = useCallback((next: HomeLayout) => setLayout(next), [])
  const setHeader = (patch: Partial<HeaderConfig>) => change({ ...layout, header: { ...layout.header, ...patch } })
  const setSection = (i: number, s: HomeSection) => change({ ...layout, sections: layout.sections.map((x, j) => (j === i ? s : x)) })
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= layout.sections.length) return
    const arr = [...layout.sections]
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    change({ ...layout, sections: arr })
  }
  const remove = (i: number) => {
    if (!confirm('حذف هذا القسم؟')) return
    change({ ...layout, sections: layout.sections.filter((_, j) => j !== i) })
  }
  const add = () => {
    const s = makeSection(addType)
    change({ ...layout, sections: [...layout.sections, s] })
    setOpen(s.id)
  }

  const dirty = saved ? !sameJson(layout, saved) : true
  const isLive = published != null && sameJson(published, layout)

  const writeKey = async (key: 'home_layout' | 'home_layout_draft', value: HomeLayout) => {
    const { error } = await supabase
      .from('lh_store_settings')
      .upsert({ key, value, is_public: key === 'home_layout' }, { onConflict: 'key' })
    return error
  }

  const saveDraft = async () => {
    setBusy('save')
    const error = await writeKey('home_layout_draft', layout)
    setBusy('')
    if (error) return notify('تعذّر الحفظ: ' + error.message, 'error')
    setSaved(layout)
    notify('تم حفظ المسودة (لم تُنشر بعد)')
  }

  const publish = async () => {
    const clean = normalizeHomeLayout(layout)
    if (!clean) return notify('أضف قسماً صالحاً واحداً على الأقل (بعض الأقسام فارغة).', 'error')
    if (!confirm('نشر هذه الصفحة الرئيسية للزوار؟')) return
    setBusy('publish')
    const e1 = await writeKey('home_layout', clean)
    const e2 = e1 ? null : await writeKey('home_layout_draft', clean)
    if (e1 || e2) {
      setBusy('')
      return notify('تعذّر النشر: ' + (e1 ?? e2)!.message, 'error')
    }
    const ok = await refreshStore()
    setBusy('')
    setLayout(clean)
    setSaved(clean)
    setPublished(clean)
    notify(ok ? 'تم النشر وتحديث المتجر ✅' : 'تم النشر، لكن تعذّر تحديث المتجر تلقائياً؛ سيظهر بعد التحديث الدوري.')
  }

  const unpublish = async () => {
    if (!confirm('العودة إلى التصميم الافتراضي للمتجر؟ تبقى مسودتك محفوظة.')) return
    setBusy('unpublish')
    const { error } = await supabase.from('lh_store_settings').delete().eq('key', 'home_layout')
    if (error) {
      setBusy('')
      return notify('تعذّر الإلغاء: ' + error.message, 'error')
    }
    await writeKey('home_layout_draft', layout)
    await refreshStore()
    setBusy('')
    setPublished(null)
    setSaved(layout)
    notify('عاد المتجر إلى التصميم الافتراضي')
  }

  const runAi = async (mode: 'generate' | 'edit') => {
    if (mode === 'edit' && !brief.trim()) return setAiError('اكتب التعديل المطلوب أولاً.')
    if (mode === 'generate' && !confirm('سيحلّ التوليد محلّ التصميم الحالي (يمكنك التراجع). المتابعة؟')) return
    setBusy('ai')
    setAiError('')
    try {
      const { data, error } = await supabase.functions.invoke('lh-design-home', {
        body: { mode, tone, brief, layout: mode === 'edit' ? layout : undefined },
      })
      if (error) {
        let code = ''
        try {
          const ctx = (error as { context?: Response }).context
          code = ctx ? ((await ctx.json()) as { error?: string }).error ?? '' : ''
        } catch { /* ignore */ }
        const unreachable = (error as { name?: string }).name === 'FunctionsFetchError' || /not found/i.test(error.message)
        return setAiError(ERRORS[code] ?? (unreachable ? 'تعذّر الوصول إلى دالة lh-design-home. تأكد من نشرها في Supabase.' : error.message))
      }
      const next = normalizeHomeLayout((data as { layout?: unknown })?.layout)
      if (!next) return setAiError(ERRORS.ai_bad_output)
      setHistory((h) => [...h.slice(-9), layout])
      setLayout(next)
      setOpen(null)
      notify('تم! راجع المعاينة، ويمكنك التراجع أو التعديل.')
    } finally {
      setBusy('')
    }
  }

  if (loading) return <PageLoader />
  const h = layout.header

  return (
    <div>
      <PageHeader
        title="الصفحة الرئيسية والهيدر"
        subtitle={published ? (isLive ? 'التصميم المنشور = المعروض هنا' : 'يوجد تصميم منشور؛ تعديلاتك لم تُنشر بعد') : 'المتجر يعرض الآن التصميم الافتراضي'}
        actions={
          <>
            {published && <Button variant="ghost" loading={busy === 'unpublish'} onClick={unpublish}>إلغاء النشر</Button>}
            <Button variant="secondary" loading={busy === 'save'} onClick={saveDraft} disabled={!dirty}>حفظ مسودة</Button>
            <Button loading={busy === 'publish'} onClick={publish} disabled={isLive}>نشر</Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="✨ المساعد الذكي">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button key={t.id} type="button" onClick={() => setTone(t.id)}
                    className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${tone === t.id ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea className={`${inputCls} min-h-[70px]`} maxLength={600} value={brief} onChange={(e) => setBrief(e.target.value)}
                placeholder="مثال: واجهة مرحة لألعاب الأطفال، أضف قسم عروض العيد وقسم فئات، واجعل الهيدر بلون العلامة…" />
              {aiError && <p className="rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-700">{aiError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button loading={busy === 'ai'} onClick={() => runAi('generate')}>🪄 صمّم لي صفحة كاملة</Button>
                <Button variant="secondary" loading={busy === 'ai'} onClick={() => runAi('edit')}>✏️ عدّل التصميم الحالي</Button>
                {history.length > 0 && (
                  <Button variant="ghost" onClick={() => { setLayout(history[history.length - 1]); setHistory(history.slice(0, -1)) }}>↩ تراجع</Button>
                )}
              </div>
              <p className="text-xs text-slate-500">يستخدم الذكاء الاصطناعي منتجاتك وفئاتك الحقيقية فقط، ولا ينشر شيئاً قبل أن تضغط «نشر».</p>
            </div>
          </Card>

          <Card>
            <button type="button" className="flex w-full items-center justify-between text-start" onClick={() => setHeaderOpen(!headerOpen)}>
              <span className="text-base font-bold text-slate-800">🧭 الهيدر</span>
              <span className="text-slate-400">{headerOpen ? '▲' : '▼'}</span>
            </button>
            {headerOpen && (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Lbl text="النمط">
                    <select className={inputCls} value={h.style} onChange={(e) => setHeader({ style: e.target.value as HeaderConfig['style'] })}>
                      <option value="light">فاتح</option><option value="brand">بلون العلامة</option><option value="dark">داكن</option>
                    </select>
                  </Lbl>
                  <Lbl text="حجم الشعار">
                    <select className={inputCls} value={h.logoSize} onChange={(e) => setHeader({ logoSize: e.target.value as HeaderConfig['logoSize'] })}>
                      <option value="sm">صغير</option><option value="md">متوسط</option><option value="lg">كبير</option>
                    </select>
                  </Lbl>
                  <div className="flex items-end pb-2"><Toggle checked={h.showName} onChange={(v) => setHeader({ showName: v })} label="إظهار اسم المتجر" /></div>
                </div>

                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <Toggle checked={h.announcement.enabled} onChange={(v) => setHeader({ announcement: { ...h.announcement, enabled: v } })} label="شريط إعلان أعلى الصفحة" />
                  {h.announcement.enabled && (
                    <>
                      <input className={inputCls} maxLength={160} placeholder="نص الإعلان" value={h.announcement.text} onChange={(e) => setHeader({ announcement: { ...h.announcement, text: e.target.value } })} />
                      <Lbl text="لون الشريط">
                        <select className={inputCls} value={h.announcement.tone} onChange={(e) => setHeader({ announcement: { ...h.announcement, tone: e.target.value as 'brand' | 'sun' | 'dark' } })}>
                          <option value="brand">أزرق</option><option value="sun">أصفر</option><option value="dark">داكن</option>
                        </select>
                      </Lbl>
                    </>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-600">روابط القائمة (حتى 6)</p>
                  {h.links.map((l, i) => (
                    <div key={i} className="rounded-lg bg-slate-50 p-2">
                      <NavLinkField label={`رابط ${i + 1}`} value={l} cat={cat}
                        onChange={(v) => setHeader({ links: v ? h.links.map((x, j) => (j === i ? v : x)) : h.links.filter((_, j) => j !== i) })} />
                    </div>
                  ))}
                  {h.links.length < 6 && (
                    <button type="button" className="text-xs font-bold text-brand-600"
                      onClick={() => setHeader({ links: [...h.links, { label: 'رابط جديد', link: { type: 'products' } }] })}>+ إضافة رابط</button>
                  )}
                </div>

                <NavLinkField label="زر بارز في الهيدر (اختياري)" value={h.cta} cat={cat} onChange={(v) => setHeader({ cta: v })} />
              </div>
            )}
          </Card>

          <div className="space-y-3">
            {layout.sections.map((s, i) => {
              const meta = HOME_SECTION_TYPES.find((t) => t.type === s.type)
              const isOpen = open === s.id
              return (
                <Card key={s.id}>
                  <div className="flex items-center gap-2">
                    <button type="button" className="flex flex-1 items-center gap-2 text-start" onClick={() => setOpen(isOpen ? null : s.id)}>
                      <span className="text-xl">{meta?.icon}</span>
                      <span className="font-bold text-slate-800">{meta?.label}</span>
                      <span className="text-xs text-slate-400">#{i + 1}</span>
                    </button>
                    <button type="button" className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30" disabled={i === layout.sections.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="rounded px-2 py-1 text-rose-600 hover:bg-rose-50" onClick={() => remove(i)}>🗑</button>
                  </div>
                  {isOpen && <div className="mt-4 border-t border-slate-100 pt-4"><HomeSectionEditor section={s} onChange={(n) => setSection(i, n)} cat={cat} /></div>}
                </Card>
              )
            })}
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputCls} max-w-[240px]`} value={addType} onChange={(e) => setAddType(e.target.value as HomeSectionType)}>
                {HOME_SECTION_TYPES.map((t) => <option key={t.type} value={t.type}>{t.icon} {t.label}</option>)}
              </select>
              <Button variant="secondary" onClick={add} disabled={layout.sections.length >= 20}>+ إضافة قسم</Button>
            </div>
          </Card>
        </div>

        <div className="xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)]">
          <PreviewFrame storeUrl={STORE_URL} payload={payload} path="/preview-home" />
        </div>
      </div>
    </div>
  )
}
