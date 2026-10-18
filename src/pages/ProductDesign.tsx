import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { transform } from 'sucrase'
import { ERRORS, TONES } from '../components/AiGenerateCard'
import PreviewFrame from '../components/PreviewFrame'
import { useToast } from '../components/Toast'
import { Button, Card, PageHeader, PageLoader, inputCls } from '../components/ui'
import { formatDate } from '../lib/format'
import { STORE_URL, refreshStore } from '../lib/store'
import { supabase } from '../lib/supabase'

/**
 * AI design: Gemini writes a full React/Tailwind page (TSX) around the store's locked checkout API.
 * The admin compiles it (sucrase), previews it live in the real store, and saves/publishes it in the
 * same columns the section builder uses (`page_draft` / `page_content`, shape `{ v: 2, tsx, js }`).
 */

type PageCode = { v: 2; tsx: string; js: string }
type VariantRow = { id: string; size: string | null; color: string | null; price: number | string | null; stock_quantity: number }
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
  lh_product_variants: VariantRow[]
}
type RateRow = { wilaya_code: number; wilaya_name: string; home_fee: number | string; desk_fee: number | string }
type VersionRow = { id: string; label: string | null; created_at: string }

const MIGRATION_HINT = 'قاعدة البيانات لا تحتوي بعد على أعمدة بناء الصفحات (هجرة lh_product_pages_draft_publish_versions).'

const asCode = (raw: unknown): PageCode | null => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  return r && r.v === 2 && typeof r.tsx === 'string' && typeof r.js === 'string' ? { v: 2, tsx: r.tsx, js: r.js } : null
}

function compile(tsx: string): { js: string; error: string } {
  try {
    const { code } = transform(tsx, { transforms: ['jsx', 'typescript', 'imports'], production: true })
    return { js: code, error: '' }
  } catch (e) {
    return { js: '', error: e instanceof Error ? e.message : String(e) }
  }
}

async function callDesign(body: Record<string, unknown>): Promise<{ data?: Record<string, unknown>; error?: string }> {
  const { data, error } = await supabase.functions.invoke('lh-design-page', { body })
  if (!error) return { data: data as Record<string, unknown> }
  let code = ''
  try {
    const ctx = (error as { context?: Response }).context
    code = ctx ? ((await ctx.json()) as { error?: string }).error ?? '' : ''
  } catch {
    /* ignore */
  }
  const unreachable = (error as { name?: string }).name === 'FunctionsFetchError' || /not found/i.test(error.message)
  return { error: ERRORS[code] ?? (unreachable ? 'تعذّر الوصول إلى دالة التصميم. تأكد من نشرها في Supabase.' : error.message) }
}

export default function ProductDesign() {
  const { id } = useParams()
  const variantId = useSearchParams()[0].get('variant')
  const navigate = useNavigate()
  const notify = useToast()

  const [loading, setLoading] = useState(true)
  const [product, setProduct] = useState<ProductRow | null>(null)
  const [rates, setRates] = useState<RateRow[]>([])
  const [versions, setVersions] = useState<VersionRow[]>([])

  const [tsx, setTsx] = useState('')
  const [savedTsx, setSavedTsx] = useState('')
  const [publishedTsx, setPublishedTsx] = useState<string | null>(null)
  const [otherKind, setOtherKind] = useState<'draft' | 'published' | null>(null) // a section-builder page exists
  const [undo, setUndo] = useState<string[]>([])

  const [tone, setTone] = useState<(typeof TONES)[number]['id']>('friendly')
  const [brief, setBrief] = useState('')
  const [editReq, setEditReq] = useState('')
  const [busy, setBusy] = useState<'suggest' | 'generate' | 'edit' | 'banner' | 'save' | 'publish' | 'unpublish' | null>(null)
  const [aiError, setAiError] = useState('')
  const [banners, setBanners] = useState<string[]>([])
  const [bannerStep, setBannerStep] = useState('')
  const [runtimeError, setRuntimeError] = useState('')
  const [showCode, setShowCode] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [abTests, setAbTests] = useState<{ id: string; name: string }[]>([])
  const [abTest, setAbTest] = useState('')
  const [abLabel, setAbLabel] = useState('')
  const [variantLabel, setVariantLabel] = useState('')

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
            'id,name,slug,description,base_price,compare_at_price,images,landing_images,landing_position,page_draft,page_content,lh_product_variants(id,size,color,price,stock_quantity)',
          )
          .eq('id', id)
          .maybeSingle(),
        supabase.from('lh_delivery_rates').select('wilaya_code,wilaya_name,home_fee,desk_fee').eq('is_active', true).order('wilaya_code'),
      ])
      if (cancelled) return
      if (p.error || !p.data) {
        const missing = p.error && (p.error.code === '42703' || /page_(draft|content)/.test(p.error.message))
        notify(missing ? MIGRATION_HINT : p.error ? 'تعذّر تحميل المنتج: ' + p.error.message : 'المنتج غير موجود', 'error')
        navigate('/products', { replace: true })
        return
      }
      const row = p.data as unknown as ProductRow
      const draft = asCode(row.page_draft)
      const pub = asCode(row.page_content)
      setProduct(row)
      setRates((r.data ?? []) as RateRow[])
      setPublishedTsx(pub ? pub.tsx : null)
      setSavedTsx(draft?.tsx ?? '')
      setTsx(draft?.tsx ?? pub?.tsx ?? '')
      if (!draft && row.page_draft != null) setOtherKind('draft')
      else if (!pub && row.page_content != null) setOtherKind('published')
      const at = await supabase.from('lh_ab_tests').select('id,name').eq('product_id', id).order('created_at', { ascending: false })
      if (!cancelled) setAbTests((at.data ?? []) as { id: string; name: string }[])
      if (variantId) {
        const vr = await supabase.from('lh_ab_variants').select('label,content').eq('id', variantId).maybeSingle()
        const vc = vr.data ? asCode(vr.data.content) : null
        if (!cancelled && vc) {
          setTsx(vc.tsx)
          setSavedTsx(vc.tsx)
          setVariantLabel(vr.data!.label as string)
        }
      }
      setLoading(false)
      void loadVersions()
    })()
    return () => {
      cancelled = true
    }
  }, [id, variantId, navigate, notify, loadVersions])

  /* live compile (debounced) */
  const [compiled, setCompiled] = useState<{ js: string; error: string }>({ js: '', error: '' })
  useEffect(() => {
    if (!tsx.trim()) return setCompiled({ js: '', error: '' })
    const t = setTimeout(() => setCompiled(compile(tsx)), 300)
    return () => clearTimeout(t)
  }, [tsx])
  useEffect(() => setRuntimeError(''), [compiled.js])

  const dirty = tsx !== savedTsx
  const isPublished = publishedTsx != null
  const differs = tsx !== (publishedTsx ?? '')
  const ready = tsx.trim() !== '' && !compiled.error && compiled.js !== ''

  const status = !tsx.trim()
    ? { text: 'لم يُصمَّم بعد', cls: 'bg-slate-200 text-slate-700' }
    : dirty
      ? { text: 'تعديلات غير محفوظة', cls: 'bg-amber-100 text-amber-800' }
      : !isPublished
        ? { text: 'مسودة — غير منشورة', cls: 'bg-sky-100 text-sky-800' }
        : differs
          ? { text: 'مسودة تختلف عن المنشور', cls: 'bg-sky-100 text-sky-800' }
          : { text: 'منشور ✓', cls: 'bg-emerald-100 text-emerald-800' }

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
      rates: rates.map((r) => ({ code: r.wilaya_code, name: r.wilaya_name, home: Number(r.home_fee), desk: Number(r.desk_fee) })),
      content: compiled.js && !compiled.error ? { v: 2, js: compiled.js } : null,
    }
  }, [product, rates, compiled])

  const onPreviewError = useCallback((m: string) => setRuntimeError(m), [])
  const replaceTsx = (next: string) => {
    setUndo((u) => (tsx.trim() ? [...u.slice(-9), tsx] : u))
    setTsx(next)
    setRuntimeError('')
  }

  /* ---------- AI ---------- */

  const suggest = async () => {
    if (!id) return
    setBusy('suggest')
    setAiError('')
    const r = await callDesign({ mode: 'suggest', product_id: id })
    if (r.error) setAiError(r.error)
    else if (typeof r.data?.suggestion === 'string') setBrief(r.data.suggestion)
    setBusy(null)
  }

  const makeBanners = async () => {
    if (!id) return
    setBusy('banner')
    setAiError('')
    setBanners([])
    const call = async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke('lh-design-banner', { body: { product_id: id, ...body } })
      if (!error) return { data: data as Record<string, string> }
      let code = ''
      try {
        const ctx = (error as { context?: Response }).context
        code = ctx ? ((await ctx.json()) as { error?: string }).error ?? '' : ''
      } catch {
        /* ignore */
      }
      const unreachable = (error as { name?: string }).name === 'FunctionsFetchError' || /not found/i.test(error.message)
      return { error: ERRORS[code] ?? (unreachable ? 'تعذّر الوصول إلى دالة البانر. تأكد من نشرها في Supabase.' : error.message) }
    }
    try {
      setBannerStep('تحليل المنتج وكتابة خطة الصور…')
      const b = await call({ mode: 'brief', notes: brief })
      if (b.error || !b.data) return setAiError(b.error ?? '')
      setBannerStep('توليد الصورة الأولى (قد تستغرق دقيقة)…')
      const one = await call({ mode: 'image', index: 0, prompt: b.data.intro, style_guide: b.data.style_guide })
      if (one.error || !one.data) return setAiError(one.error ?? '')
      setBanners([one.data.url])
      setBannerStep('توليد الصورة الثانية بنفس الأسلوب…')
      const two = await call({ mode: 'image', index: 1, prompt: b.data.conversion, style_guide: b.data.style_guide, reference_url: one.data.url })
      if (two.error || !two.data) return setAiError(two.error ?? '')
      setBanners([one.data.url, two.data.url])
      notify('جاهز. اضغط «صمّم الصفحة» لتُبنى الصفحة حول البانر.')
    } finally {
      setBannerStep('')
      setBusy(null)
    }
  }

  const generate = async () => {
    if (!id) return
    if (tsx.trim() && !confirm('سيحلّ التصميم الجديد محلّ الحالي (يمكنك التراجع بعده). المتابعة؟')) return
    setBusy('generate')
    setAiError('')
    const r = await callDesign({ mode: 'generate', product_id: id, tone, request: brief, banners })
    if (r.error) setAiError(r.error)
    else if (typeof r.data?.tsx === 'string') {
      replaceTsx(r.data.tsx)
      setTab('preview')
      notify('صُمّمت الصفحة. راجعها في المعاينة ثم احفظ أو انشر.')
    }
    setBusy(null)
  }

  const edit = async () => {
    if (!id || !editReq.trim()) return
    setBusy('edit')
    setAiError('')
    const r = await callDesign({ mode: 'edit', product_id: id, request: editReq, current_tsx: tsx })
    if (r.error) setAiError(r.error)
    else if (typeof r.data?.tsx === 'string') {
      replaceTsx(r.data.tsx)
      setEditReq('')
      setTab('preview')
    }
    setBusy(null)
  }

  /* ---------- persistence ---------- */

  const saveDraft = async (quiet = false): Promise<boolean> => {
    if (!id || !ready || variantId) return false
    if (otherKind === 'draft' && !confirm('توجد مسودة بأسلوب الأقسام لهذا المنتج وسيستبدلها هذا التصميم. المتابعة؟')) return false
    const content: PageCode = { v: 2, tsx, js: compiled.js }
    const { error } = await supabase.from('lh_products').update({ page_draft: content }).eq('id', id)
    if (error) {
      notify('فشل حفظ المسودة: ' + error.message, 'error')
      return false
    }
    setSavedTsx(tsx)
    setOtherKind((k) => (k === 'draft' ? null : k))
    if (!quiet) notify('تم حفظ المسودة')
    return true
  }

  const saveAsVariant = async () => {
    if (!ready) return
    if (!abTest || !abLabel.trim()) return notify('اختر الاختبار واكتب اسماً للنسخة', 'error')
    setBusy('save')
    const content: PageCode = { v: 2, tsx, js: compiled.js }
    const { count } = await supabase.from('lh_ab_variants').select('id', { count: 'exact', head: true }).eq('test_id', abTest)
    const { error } = await supabase.from('lh_ab_variants').insert({ test_id: abTest, label: abLabel.trim(), content, position: count ?? 0 })
    if (error) notify('فشل الحفظ: ' + error.message, 'error')
    else {
      await refreshStore()
      setAbLabel('')
      notify('أُضيفت النسخة إلى الاختبار ✓')
    }
    setBusy(null)
  }

  const saveVariant = async () => {
    if (!variantId || !ready) return
    setBusy('save')
    const content: PageCode = { v: 2, tsx, js: compiled.js }
    const { error } = await supabase.from('lh_ab_variants').update({ content }).eq('id', variantId)
    if (error) notify('فشل الحفظ: ' + error.message, 'error')
    else {
      setSavedTsx(tsx)
      await refreshStore()
      notify('تم حفظ النسخة وتحديث المتجر ✓')
    }
    setBusy(null)
  }

  const onSave = async () => {
    setBusy('save')
    await saveDraft()
    setBusy(null)
  }

  const onPublish = async () => {
    if (!id || !ready || variantId) return
    if (!confirm('نشر الصفحة الآن؟ ستظهر للزوار فوراً.')) return
    setBusy('publish')
    if (!(await saveDraft(true))) return setBusy(null)
    const { error } = await supabase.rpc('lh_publish_product_page', { p_product_id: id })
    if (error) {
      notify(/lh_publish_product_page|schema cache|does not exist/i.test(error.message) ? MIGRATION_HINT : 'فشل النشر: ' + error.message, 'error')
      return setBusy(null)
    }
    setPublishedTsx(tsx)
    setOtherKind(null)
    const refreshed = await refreshStore()
    notify(refreshed ? 'تم النشر وتحديث المتجر ✓' : 'تم النشر. تعذّر تحديث المتجر تلقائياً.', refreshed ? 'success' : 'error')
    void loadVersions()
    setBusy(null)
  }

  const onUnpublish = async () => {
    if (!id || !confirm('إلغاء النشر؟ سيعود المنتج إلى القالب القديم.')) return
    setBusy('unpublish')
    const { error } = await supabase.from('lh_products').update({ page_content: null, page_published_at: null }).eq('id', id)
    if (error) {
      notify('فشل إلغاء النشر: ' + error.message, 'error')
      return setBusy(null)
    }
    setPublishedTsx(null)
    await refreshStore()
    notify('أُلغي النشر')
    setBusy(null)
  }

  const restoreVersion = async (versionId: string) => {
    const { data } = await supabase.from('lh_product_page_versions').select('content').eq('id', versionId).maybeSingle()
    const code = asCode(data?.content)
    if (!code) return notify('هذه النسخة بأسلوب الأقسام ولا يمكن فتحها هنا', 'error')
    replaceTsx(code.tsx)
    setShowVersions(false)
    notify('حُمّلت النسخة في المحرّر. احفظها أو انشرها.')
  }

  if (loading || !product) return <PageLoader />

  const problem = compiled.error || runtimeError

  return (
    <>
      <PageHeader
        title="تصميم صفحة المنتج بالذكاء الاصطناعي"
        subtitle={product.name}
        actions={
          <>
            <Link to={`/products/${product.id}/page`}>
              <Button variant="secondary">محرّر الأقسام</Button>
            </Link>
            <Link to="/products">
              <Button variant="ghost">← المنتجات</Button>
            </Link>
          </>
        }
      />

      {otherKind && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {otherKind === 'published'
            ? 'المنشور حالياً صفحة بأسلوب الأقسام. نشر تصميم الذكاء الاصطناعي سيستبدلها (تبقى في سجل الإصدارات).'
            : 'توجد مسودة بأسلوب الأقسام لهذا المنتج. حفظ هذا التصميم سيستبدلها.'}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.cls}`}>{status.text}</span>
        <div className="mr-auto flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setShowVersions(true)} disabled={versions.length === 0}>
            🕘 الإصدارات ({versions.length})
          </Button>
          <Button variant="secondary" onClick={onSave} loading={busy === 'save'} disabled={!ready || !dirty || busy !== null}>
            حفظ المسودة
          </Button>
          <Button onClick={onPublish} loading={busy === 'publish'} disabled={!ready || (!dirty && !differs) || busy !== null}>
            نشر
          </Button>
        </div>
        {(dirty || isPublished) && (
          <div className="flex w-full flex-wrap gap-3 border-t border-slate-100 pt-2 text-xs font-semibold">
            {dirty && (
              <button className="text-slate-500 hover:text-slate-800" onClick={() => confirm('تجاهل التعديلات غير المحفوظة؟') && setTsx(savedTsx)}>
                تجاهل التعديلات غير المحفوظة
              </button>
            )}
            {isPublished && (
              <button className="text-rose-600 hover:text-rose-800 disabled:opacity-50" disabled={busy !== null} onClick={onUnpublish}>
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
            className={`flex-1 rounded-lg py-2 text-sm font-bold ${tab === t ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
          >
            {t === 'edit' ? '✏️ تحرير' : '👁️ معاينة'}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
        <div className={`${tab === 'edit' ? '' : 'hidden'} space-y-4 lg:block`}>
          <Card title="✨ صمّم بالذكاء الاصطناعي (Gemini)">
            <div className="mb-3 flex flex-wrap gap-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTone(t.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${tone === t.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              className={`${inputCls} mb-2 min-h-[110px]`}
              maxLength={1500}
              placeholder="وصف التصميم الذي تريده (ألوان، طابع، أقسام…) — أو اضغط «اقترح توجيهاً» ليحلل الذكاء الاصطناعي المنتج وصورته."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={suggest} loading={busy === 'suggest'} disabled={busy !== null}>
                💡 اقترح توجيهاً
              </Button>
              <Button onClick={generate} loading={busy === 'generate'} disabled={busy !== null}>
                {tsx.trim() ? 'صمّم من جديد' : 'صمّم الصفحة'}
              </Button>
            </div>
            {busy === 'generate' && <p className="mt-2 text-xs text-slate-500">يستغرق التصميم عادةً من 20 إلى 60 ثانية…</p>}
            {aiError && <p className="mt-3 rounded-lg bg-rose-50 p-2.5 text-xs font-semibold text-rose-700">{aiError}</p>}
          </Card>

          <Card title="🖼️ بانر إعلاني بالذكاء الاصطناعي">
            <p className="mb-3 text-xs text-slate-500">
              يولّد صورتين طويلتين بنص عربي مدمج (تُعرضان متتاليتين أعلى الصفحة) ثم تُبنى الصفحة حولهما. كل صورة تستغرق نحو دقيقة. تحقّق دائماً من النص العربي داخل الصور.
            </p>
            {banners.length > 0 && (
              <div className="mb-3 flex gap-2">
                {banners.map((u) => (
                  <img key={u} src={u} alt="بانر" className="h-40 w-auto rounded-lg border border-slate-200" />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={makeBanners} loading={busy === 'banner'} disabled={busy !== null}>
                {banners.length ? 'ولّد بانراً جديداً' : 'ولّد البانر'}
              </Button>
              {banners.length === 2 && (
                <Button onClick={generate} loading={busy === 'generate'} disabled={busy !== null}>صمّم الصفحة حول البانر</Button>
              )}
              {banners.length > 0 && busy === null && (
                <button type="button" className="text-xs font-bold text-rose-600" onClick={() => setBanners([])}>إزالة</button>
              )}
            </div>
            {bannerStep && <p className="mt-2 text-xs text-slate-500">{bannerStep}</p>}
          </Card>

          {tsx.trim() && (
            <Card title="💬 عدّل بالمحادثة">
              <textarea
                className={`${inputCls} mb-2 min-h-[70px]`}
                maxLength={1500}
                placeholder="مثال: اجعل زر الطلب أكبر وبلون أخضر، وأضف قسماً للأسئلة الشائعة"
                value={editReq}
                onChange={(e) => setEditReq(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={edit} loading={busy === 'edit'} disabled={busy !== null || !editReq.trim()}>
                  نفّذ التعديل
                </Button>
                <Button variant="secondary" disabled={undo.length === 0 || busy !== null} onClick={() => {
                  const prev = undo[undo.length - 1]
                  setUndo((u) => u.slice(0, -1))
                  setTsx(prev)
                }}>
                  ↩ تراجع ({undo.length})
                </Button>
              </div>
            </Card>
          )}

          {variantId ? (
            <Card title={`🧪 تعديل نسخة اختبار: ${variantLabel}`}>
              <p className="mb-3 text-xs text-slate-500">أنت تعدّل نسخة من اختبار A/B، وليس صفحة المنتج. الحفظ هنا لا يمسّ الصفحة المنشورة.</p>
              <div className="flex gap-2">
                <Button onClick={saveVariant} loading={busy === 'save'} disabled={!ready || busy !== null}>حفظ في النسخة</Button>
                <Link to={`/ab`} className="self-center text-sm font-bold text-brand-600">← الاختبارات</Link>
              </div>
            </Card>
          ) : (
            tsx.trim() && (
              <Card title="🧪 احفظ كنسخة اختبار A/B">
                {abTests.length === 0 ? (
                  <p className="text-xs text-slate-500">أنشئ أولاً اختباراً لهذا المنتج من <Link className="font-bold text-brand-600" to="/ab">صفحة الاختبارات</Link>.</p>
                ) : (
                  <div className="space-y-2">
                    <select className={inputCls} value={abTest} onChange={(e) => setAbTest(e.target.value)}>
                      <option value="">— اختر الاختبار —</option>
                      {abTests.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                    <input className={inputCls} maxLength={60} placeholder="اسم النسخة (مثل: تصميم أخضر)" value={abLabel} onChange={(e) => setAbLabel(e.target.value)} />
                    <Button variant="secondary" onClick={saveAsVariant} disabled={!ready || busy !== null}>أضف كنسخة جديدة</Button>
                  </div>
                )}
              </Card>
            )
          )}

          {problem && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800" dir="auto">
              {compiled.error ? 'خطأ في الكود: ' : 'تعذّر تشغيل الصفحة في المتجر (سيظهر للزوار القالب القديم): '}
              {problem}
            </p>
          )}

          <Card title="الكود (للمتقدمين)">
            <button type="button" className="text-xs font-bold text-brand-600" onClick={() => setShowCode((v) => !v)}>
              {showCode ? 'إخفاء الكود' : 'إظهار الكود وتعديله يدوياً'}
            </button>
            {showCode && (
              <textarea
                  dir="ltr"
                  spellCheck={false}
                  className={`${inputCls} mt-2 min-h-[320px] font-mono text-xs`}
                  value={tsx}
                  onChange={(e) => setTsx(e.target.value)}
                />
            )}
          </Card>
        </div>

        <div className={`${tab === 'preview' ? '' : 'hidden'} h-[78vh] lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)]`}>
          <PreviewFrame storeUrl={STORE_URL} payload={payload} onPreviewError={onPreviewError} />
        </div>
      </div>

      {showVersions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowVersions(false)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold">الإصدارات المنشورة</h3>
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm">
                  <span>
                    {formatDate(v.created_at)}
                    {v.label ? ` — ${v.label}` : ''}
                  </span>
                  <Button variant="secondary" className="!px-3 !py-1" onClick={() => restoreVersion(v.id)}>
                    استرجاع
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
