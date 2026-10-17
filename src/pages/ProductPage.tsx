import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PreviewFrame from '../components/PreviewFrame'
import SectionEditor from '../components/SectionEditor'
import { useToast } from '../components/Toast'
import { Button, Card, PageHeader, PageLoader } from '../components/ui'
import { formatDate } from '../lib/format'
import {
  ACCENTS,
  ACCENT_META,
  SECTION_META,
  SECTION_TYPES,
  canon,
  loadForEditing,
  newSection,
  normalizePageContent,
  normalizeSingleSection,
  starterFromProduct,
} from '../lib/page-content'
import type { PageContent, Section, SectionType } from '../lib/page-content'
import { PRODUCTS_BUCKET, supabase } from '../lib/supabase'
import { STORE_URL, refreshStore } from '../lib/store'

type VariantRow = {
  id: string
  size: string | null
  color: string | null
  price: number | string | null
  stock_quantity: number
}

type ProductRow = {
  id: string
  name: string
  slug: string
  description: string | null
  base_price: number | string
  compare_at_price: number | string | null
  images: string[] | null
  landing_images: string[] | null
  landing_position: string
  page_draft: unknown
  page_content: unknown
  page_published_at: string | null
  lh_product_variants: VariantRow[]
}

type RateRow = { wilaya_code: number; wilaya_name: string; home_fee: number | string; desk_fee: number | string }
type VersionRow = { id: string; label: string | null; created_at: string }

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MIGRATION_HINT =
  'قاعدة البيانات لا تحتوي بعد على أعمدة بناء الصفحات. نفّذ هجرة lh_product_pages_draft_publish_versions في Supabase ثم أعد التحميل.'

export default function ProductPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const notify = useToast()

  const [loading, setLoading] = useState(true)
  const [product, setProduct] = useState<ProductRow | null>(null)
  const [rates, setRates] = useState<RateRow[]>([])
  const [versions, setVersions] = useState<VersionRow[]>([])

  const [content, setContent] = useState<PageContent | null>(null)
  const [saved, setSaved] = useState<PageContent | null>(null)
  const [published, setPublished] = useState<unknown>(null)

  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'save' | 'publish' | 'unpublish' | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')

  const loadVersions = useCallback(async () => {
    if (!id) return
    const { data } = await supabase
      .from('lh_product_page_versions')
      .select('id,label,created_at')
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(30)
    setVersions((data ?? []) as VersionRow[])
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const [p, r] = await Promise.all([
        supabase
          .from('lh_products')
          .select(
            'id,name,slug,description,base_price,compare_at_price,images,landing_images,landing_position,' +
              'page_draft,page_content,page_published_at,lh_product_variants(id,size,color,price,stock_quantity)',
          )
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('lh_delivery_rates')
          .select('wilaya_code,wilaya_name,home_fee,desk_fee')
          .eq('is_active', true)
          .order('wilaya_code'),
      ])
      if (cancelled) return
      if (p.error) {
        const missing = p.error.code === '42703' || /page_(draft|content)/.test(p.error.message)
        notify(missing ? MIGRATION_HINT : 'تعذّر تحميل المنتج: ' + p.error.message, 'error')
        navigate('/products', { replace: true })
        return
      }
      if (!p.data) {
        notify('المنتج غير موجود', 'error')
        navigate('/products', { replace: true })
        return
      }
      const row = p.data as unknown as ProductRow
      const draft = loadForEditing(row.page_draft)
      setProduct(row)
      setRates((r.data ?? []) as RateRow[])
      setPublished(row.page_content)
      setSaved(draft)
      setContent(draft ?? loadForEditing(row.page_content))
      setLoading(false)
      void loadVersions()
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate, notify, loadVersions])

  /* ---------- derived state ---------- */

  const dirty = useMemo(() => canon(content) !== canon(saved), [content, saved])
  const publishedCanon = useMemo(() => canon(normalizePageContent(published)), [published])
  const workingCanon = useMemo(() => canon(normalizePageContent(content)), [content])
  const renderable = useMemo(() => normalizePageContent(content) !== null, [content])
  const isPublished = published != null
  const differsFromPublished = workingCanon !== publishedCanon

  const status = useMemo(() => {
    if (!content) return { text: 'لم يُنشأ بعد', cls: 'bg-slate-200 text-slate-700' }
    if (dirty) return { text: 'تعديلات غير محفوظة', cls: 'bg-amber-100 text-amber-800' }
    if (!isPublished) return { text: 'مسودة — غير منشورة', cls: 'bg-sky-100 text-sky-800' }
    if (differsFromPublished) return { text: 'مسودة تختلف عن المنشور', cls: 'bg-sky-100 text-sky-800' }
    return { text: 'منشور ✓', cls: 'bg-emerald-100 text-emerald-800' }
  }, [content, dirty, isPublished, differsFromPublished])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const payload = useMemo(() => {
    if (!product) return {}
    return {
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        base_price: Number(product.base_price),
        compare_at_price: product.compare_at_price != null ? Number(product.compare_at_price) : null,
        images: product.images ?? [],
        landing_images: product.landing_images ?? [],
        landing_position: product.landing_position,
        variants: product.lh_product_variants.map((v) => ({
          id: v.id,
          size: v.size,
          color: v.color,
          price: v.price != null ? Number(v.price) : null,
          stock_quantity: v.stock_quantity,
        })),
      },
      rates: rates.map((r) => ({
        code: r.wilaya_code,
        name: r.wilaya_name,
        home: Number(r.home_fee),
        desk: Number(r.desk_fee),
      })),
      content,
    }
  }, [product, rates, content])

  /* ---------- section editing ---------- */

  const patch = (fn: (c: PageContent) => PageContent) => setContent((c) => (c ? fn(c) : c))

  const updateSection = (sid: string, s: Section) =>
    patch((c) => ({ ...c, sections: c.sections.map((x) => (x.id === sid ? s : x)) }))

  const moveSection = (i: number, dir: -1 | 1) =>
    patch((c) => {
      const j = i + dir
      if (j < 0 || j >= c.sections.length) return c
      const next = c.sections.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...c, sections: next }
    })

  const removeSection = (sid: string) => {
    if (!confirm('حذف هذا القسم؟')) return
    patch((c) => ({ ...c, sections: c.sections.filter((x) => x.id !== sid) }))
  }

  const duplicateSection = (sid: string) =>
    patch((c) => {
      const i = c.sections.findIndex((x) => x.id === sid)
      if (i < 0) return c
      const copy = { ...structuredClone(c.sections[i]), id: crypto.randomUUID().slice(0, 8) } as Section
      const next = c.sections.slice()
      next.splice(i + 1, 0, copy)
      return { ...c, sections: next }
    })

  const addSection = (type: SectionType) => {
    const s = newSection(type)
    patch((c) => ({ ...c, sections: [...c.sections, s] }))
    setOpen((o) => new Set(o).add(s.id))
  }

  const toggleOpen = (sid: string) =>
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(sid)) n.delete(sid)
      else n.add(sid)
      return n
    })

  const upload = async (files: FileList | null): Promise<string[]> => {
    const added: string[] = []
    if (!files) return added
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        notify(`«${file.name}» ليس صورة`, 'error')
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        notify(`«${file.name}» أكبر من 5 ميغابايت`, 'error')
        continue
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `landing/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from(PRODUCTS_BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
      if (error) {
        notify('فشل رفع الصورة: ' + error.message, 'error')
        continue
      }
      added.push(supabase.storage.from(PRODUCTS_BUCKET).getPublicUrl(path).data.publicUrl)
    }
    return added
  }

  /* ---------- persistence ---------- */

  const saveDraft = async (quiet = false): Promise<boolean> => {
    if (!id || !content) return false
    const { error } = await supabase.from('lh_products').update({ page_draft: content }).eq('id', id)
    if (error) {
      notify('فشل حفظ المسودة: ' + error.message, 'error')
      return false
    }
    setSaved(content)
    if (!quiet) notify('تم حفظ المسودة')
    return true
  }

  const onSave = async () => {
    setBusy('save')
    await saveDraft()
    setBusy(null)
  }

  const onPublish = async () => {
    if (!id || !content) return
    if (!renderable) {
      notify('أضف قسماً واحداً على الأقل يحتوي نصاً أو صوراً قبل النشر', 'error')
      return
    }
    const empties = content.sections.filter((s) => normalizeSingleSection(s) === null).length
    const warn = empties ? `\n\nتنبيه: ${empties} قسم فارغ لن يظهر للزوار.` : ''
    if (!confirm('نشر الصفحة الآن؟ ستظهر للزوار فوراً.' + warn)) return

    setBusy('publish')
    const okSave = await saveDraft(true)
    if (!okSave) return setBusy(null)

    const { error } = await supabase.rpc('lh_publish_product_page', { p_product_id: id })
    if (error) {
      const missing = /lh_publish_product_page|schema cache|does not exist/i.test(error.message)
      notify(missing ? MIGRATION_HINT : 'فشل النشر: ' + error.message, 'error')
      return setBusy(null)
    }
    setPublished(content)
    const refreshed = await refreshStore()
    notify(
      refreshed ? 'تم النشر وتحديث المتجر ✓' : 'تم النشر. تعذّر تحديث المتجر تلقائياً، وستظهر الصفحة بعد التحديث التالي.',
      refreshed ? 'success' : 'error',
    )
    void loadVersions()
    setBusy(null)
  }

  const onUnpublish = async () => {
    if (!id) return
    if (!confirm('إلغاء نشر الصفحة؟ سيعود المنتج إلى القالب القديم (الوصف + صور الهبوط).')) return
    setBusy('unpublish')
    const { error } = await supabase
      .from('lh_products')
      .update({ page_content: null, page_published_at: null })
      .eq('id', id)
    if (error) {
      notify('فشل إلغاء النشر: ' + error.message, 'error')
      return setBusy(null)
    }
    setPublished(null)
    await refreshStore()
    notify('أُلغي النشر، وعاد المنتج للقالب القديم')
    setBusy(null)
  }

  const restoreVersion = async (versionId: string) => {
    const { data, error } = await supabase
      .from('lh_product_page_versions')
      .select('content')
      .eq('id', versionId)
      .maybeSingle()
    const restored = error ? null : loadForEditing(data?.content)
    if (!restored) {
      notify('تعذّر تحميل هذه النسخة', 'error')
      return
    }
    setContent(restored)
    setShowVersions(false)
    notify('حُمّلت النسخة في المحرّر. احفظها كمسودة أو انشرها.')
  }

  /* ---------- render ---------- */

  if (loading || !product) return <PageLoader />

  const startFromProduct = () =>
    setContent(
      starterFromProduct({
        name: product.name,
        description: product.description,
        landing_images: product.landing_images ?? [],
        landing_position: product.landing_position === 'above' ? 'above' : 'below',
      }),
    )

  return (
    <>
      <PageHeader
        title="تصميم صفحة المنتج"
        subtitle={product.name}
        actions={
          <>
            <Link to={`/products/${product.id}`}>
              <Button variant="secondary">بيانات المنتج</Button>
            </Link>
            <Link to="/products">
              <Button variant="ghost">← المنتجات</Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.cls}`}>{status.text}</span>
        <div className="mr-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setShowVersions(true)} disabled={versions.length === 0}>
            🕘 الإصدارات ({versions.length})
          </Button>
          <Button variant="secondary" onClick={onSave} loading={busy === 'save'} disabled={!content || !dirty || busy !== null}>
            حفظ المسودة
          </Button>
          <Button
            onClick={onPublish}
            loading={busy === 'publish'}
            disabled={!content || !renderable || (!dirty && !differsFromPublished) || busy !== null}
          >
            نشر
          </Button>
        </div>
        {(dirty || isPublished) && (
          <div className="flex w-full flex-wrap gap-3 border-t border-slate-100 pt-2 text-xs font-semibold">
            {dirty && (
              <button
                className="text-slate-500 hover:text-slate-800"
                onClick={() => {
                  if (confirm('تجاهل كل التعديلات غير المحفوظة؟')) setContent(saved)
                }}
              >
                تجاهل التعديلات غير المحفوظة
              </button>
            )}
            {isPublished && differsFromPublished && (
              <button
                className="text-slate-500 hover:text-slate-800"
                onClick={() => {
                  if (confirm('استبدال المسودة بالنسخة المنشورة؟')) setContent(loadForEditing(published))
                }}
              >
                استرجاع النسخة المنشورة
              </button>
            )}
            {isPublished && (
              <button
                className="text-rose-600 hover:text-rose-800 disabled:opacity-50"
                disabled={busy !== null}
                onClick={onUnpublish}
              >
                إلغاء النشر (العودة للقالب القديم)
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mb-3 flex gap-2 lg:hidden">
        {(['edit', 'preview'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${
              tab === t ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {t === 'edit' ? '✏️ تحرير' : '👁️ معاينة'}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
        <div className={`${tab === 'edit' ? '' : 'hidden'} space-y-4 lg:block`}>
          {!content ? (
            <Card title="ابدأ تصميم الصفحة">
              <p className="mb-4 text-sm text-slate-600">
                الصفحة الحالية تستخدم القالب القديم. ابدأ بمسودة جديدة، ولن يتغيّر شيء عند الزوار حتى تضغط «نشر».
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={startFromProduct}>ابدأ من محتوى المنتج الحالي</Button>
                <Button variant="secondary" onClick={() => setContent({ v: 1, accent: 'sky', sections: [] })}>
                  صفحة فارغة
                </Button>
              </div>
            </Card>
          ) : (
            <>
              <Card title="لون الصفحة">
                <div className="flex flex-wrap gap-3">
                  {ACCENTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      title={ACCENT_META[a].label}
                      aria-label={ACCENT_META[a].label}
                      onClick={() => patch((c) => ({ ...c, accent: a }))}
                      className={`h-9 w-9 rounded-full ring-offset-2 transition ${
                        content.accent === a ? 'ring-2 ring-slate-900' : 'ring-1 ring-slate-300'
                      }`}
                      style={{ background: ACCENT_META[a].color }}
                    />
                  ))}
                </div>
              </Card>

              {content.sections.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  لا توجد أقسام بعد. أضف أول قسم من الأسفل.
                </p>
              )}

              {content.sections.map((s, i) => {
                const meta = SECTION_META[s.type]
                const isOpen = open.has(s.id)
                const empty = normalizeSingleSection(s) === null
                return (
                  <section key={s.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleOpen(s.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-right"
                        aria-expanded={isOpen}
                      >
                        <span className="text-lg" aria-hidden>
                          {meta.icon}
                        </span>
                        <span className="truncate text-sm font-bold text-slate-800">{meta.label}</span>
                        {empty && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                            فارغ — لن يظهر
                          </span>
                        )}
                        <span className="mr-auto text-slate-400">{isOpen ? '▲' : '▼'}</span>
                      </button>
                      <div className="flex shrink-0">
                        <button type="button" title="أعلى" disabled={i === 0} onClick={() => moveSection(i, -1)} className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30">
                          ↑
                        </button>
                        <button type="button" title="أسفل" disabled={i === content.sections.length - 1} onClick={() => moveSection(i, 1)} className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30">
                          ↓
                        </button>
                        <button type="button" title="نسخ" onClick={() => duplicateSection(s.id)} className="h-8 w-8 rounded-md text-slate-600 hover:bg-slate-100">
                          ⧉
                        </button>
                        <button type="button" title="حذف" onClick={() => removeSection(s.id)} className="h-8 w-8 rounded-md text-rose-600 hover:bg-rose-50">
                          ✕
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="border-t border-slate-100 p-4">
                        <SectionEditor
                          section={s}
                          onChange={(next) => updateSection(s.id, next)}
                          upload={upload}
                          landingImages={product.landing_images ?? []}
                          description={product.description}
                        />
                      </div>
                    )}
                  </section>
                )
              })}

              <Card title="إضافة قسم">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {SECTION_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => addSection(t)}
                      className="rounded-lg border border-slate-200 p-2.5 text-right transition hover:border-brand-500 hover:bg-brand-50"
                    >
                      <div className="text-sm font-bold text-slate-800">
                        <span aria-hidden>{SECTION_META[t].icon}</span> {SECTION_META[t].label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{SECTION_META[t].hint}</div>
                    </button>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>

        <div className={`${tab === 'preview' ? '' : 'hidden'} h-[78vh] lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)]`}>
          <PreviewFrame storeUrl={STORE_URL} payload={payload} />
        </div>
      </div>

      {showVersions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowVersions(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">الإصدارات المنشورة</h2>
              <button onClick={() => setShowVersions(false)} className="text-slate-500" aria-label="إغلاق">
                ✕
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {versions.map((v, i) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <div className="font-semibold text-slate-800">{v.label || formatDate(v.created_at)}</div>
                    {v.label && <div className="text-xs text-slate-500">{formatDate(v.created_at)}</div>}
                    {i === 0 && <div className="text-xs font-bold text-emerald-600">الأحدث</div>}
                  </div>
                  <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => restoreVersion(v.id)}>
                    استعادة
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              الاستعادة تضع النسخة في المحرّر فقط؛ لا يتغيّر شيء عند الزوار حتى تنشرها.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
