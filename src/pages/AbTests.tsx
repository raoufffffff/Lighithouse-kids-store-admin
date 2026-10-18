import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { refreshStore, STORE_URL } from '../lib/store'
import { supabase } from '../lib/supabase'

type TestRow = { id: string; product_id: string; slug: string; name: string; is_active: boolean; product: { name: string } | null }
type VariantRow = { id: string; label: string; is_active: boolean; position: number }
type Stat = { variant_id: string; views: number; orders: number; revenue: number }

const link = (slug: string) => `${STORE_URL}/ab/${slug}`

/** Two-proportion z-test (two-sided) → confidence that the rates differ. */
function confidence(v1: number, o1: number, v2: number, o2: number): number | null {
  if (v1 < 1 || v2 < 1) return null
  const p1 = o1 / v1
  const p2 = o2 / v2
  const p = (o1 + o2) / (v1 + v2)
  const se = Math.sqrt(p * (1 - p) * (1 / v1 + 1 / v2))
  if (se === 0) return null
  const z = Math.abs(p1 - p2) / se
  // normal CDF approximation
  const t = 1 / (1 + 0.2316419 * z)
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return 1 - 2 * tail
}

export function AbList() {
  const notify = useToast()
  const [tests, setTests] = useState<TestRow[] | null>(null)
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [productId, setProductId] = useState('')
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [t, p] = await Promise.all([
      supabase.from('lh_ab_tests').select('id,product_id,slug,name,is_active,product:lh_products(name)').order('created_at', { ascending: false }),
      supabase.from('lh_products').select('id,name').order('name'),
    ])
    if (t.error) notify('تعذّر التحميل: ' + t.error.message, 'error')
    setTests((t.data ?? []) as unknown as TestRow[])
    setProducts((p.data ?? []) as { id: string; name: string }[])
  }, [notify])
  useEffect(() => void load(), [load])

  const create = async () => {
    const s = slug.trim().toLowerCase()
    if (!productId || !name.trim()) return notify('اختر المنتج واكتب اسماً للاختبار', 'error')
    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(s)) return notify('الرابط: أحرف إنجليزية صغيرة وأرقام وشرطات (3 أحرف فأكثر)', 'error')
    setBusy(true)
    const { error } = await supabase.from('lh_ab_tests').insert({ product_id: productId, slug: s, name: name.trim() })
    setBusy(false)
    if (error) return notify(error.code === '23505' ? 'هذا الرابط مستخدم' : 'فشل الإنشاء: ' + error.message, 'error')
    setSlug('')
    setName('')
    void load()
    notify('تم إنشاء الاختبار. أضف النسخ من «تصميم AI» للمنتج.')
  }

  if (!tests) return <PageLoader />
  return (
    <div>
      <PageHeader title="🧪 اختبارات A/B" subtitle="رابط واحد تشاركه في الإعلان، ويرى كل زائر إحدى النسخ عشوائياً." />
      <Card title="اختبار جديد" className="mb-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="المنتج">
            <select className={inputCls} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— اختر —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="اسم الاختبار">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="الرابط (slug)">
            <input className={inputCls} dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="car-test-1" />
          </Field>
        </div>
        <Button className="mt-3" onClick={create} loading={busy}>إنشاء</Button>
      </Card>
      <div className="space-y-3">
        {tests.length === 0 && <p className="text-sm text-slate-500">لا توجد اختبارات بعد.</p>}
        {tests.map((t) => (
          <Link key={t.id} to={`/ab/${t.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-600">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-slate-800">{t.name}</div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${t.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                {t.is_active ? 'يعمل' : 'متوقف'}
              </span>
            </div>
            <div className="text-xs text-slate-500">{t.product?.name} · <span dir="ltr">/ab/{t.slug}</span></div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function AbDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const notify = useToast()
  const [test, setTest] = useState<TestRow | null>(null)
  const [variants, setVariants] = useState<VariantRow[]>([])
  const [stats, setStats] = useState<Record<string, Stat>>({})

  const load = useCallback(async () => {
    if (!id) return
    const [t, v, s] = await Promise.all([
      supabase.from('lh_ab_tests').select('id,product_id,slug,name,is_active,product:lh_products(name)').eq('id', id).maybeSingle(),
      supabase.from('lh_ab_variants').select('id,label,is_active,position').eq('test_id', id).order('position').order('created_at'),
      supabase.rpc('lh_ab_stats', { p_test_id: id }),
    ])
    if (!t.data) {
      notify('الاختبار غير موجود', 'error')
      return navigate('/ab', { replace: true })
    }
    setTest(t.data as unknown as TestRow)
    setVariants((v.data ?? []) as VariantRow[])
    const map: Record<string, Stat> = {}
    for (const r of (s.data ?? []) as Stat[]) map[r.variant_id] = { ...r, views: Number(r.views), orders: Number(r.orders), revenue: Number(r.revenue) }
    setStats(map)
  }, [id, navigate, notify])
  useEffect(() => void load(), [load])

  const patchVariant = async (vid: string, patch: Partial<VariantRow>) => {
    const { error } = await supabase.from('lh_ab_variants').update(patch).eq('id', vid)
    if (error) return notify('فشل الحفظ: ' + error.message, 'error')
    await refreshStore()
    void load()
  }
  const del = async (vid: string) => {
    if (!confirm('حذف هذه النسخة وإحصاءاتها؟')) return
    const { error } = await supabase.from('lh_ab_variants').delete().eq('id', vid)
    if (error) return notify('فشل الحذف: ' + error.message, 'error')
    await refreshStore()
    void load()
  }
  const toggleTest = async (v: boolean) => {
    if (!test) return
    const { error } = await supabase.from('lh_ab_tests').update({ is_active: v }).eq('id', test.id)
    if (error) return notify('فشل الحفظ: ' + error.message, 'error')
    await refreshStore()
    void load()
  }
  const removeTest = async () => {
    if (!test || !confirm('حذف الاختبار كاملاً؟')) return
    await supabase.from('lh_ab_tests').delete().eq('id', test.id)
    await refreshStore()
    navigate('/ab', { replace: true })
  }

  if (!test) return <PageLoader />
  const url = link(test.slug)
  const rows = variants.map((v) => ({ v, s: stats[v.id] ?? { variant_id: v.id, views: 0, orders: 0, revenue: 0 } }))
  const best = rows.reduce<typeof rows[number] | null>((b, r) => (r.s.views > 0 && (!b || r.s.orders / r.s.views > b.s.orders / Math.max(1, b.s.views)) ? r : b), null)
  const totalViews = rows.reduce((a, r) => a + r.s.views, 0)

  return (
    <div>
      <PageHeader
        title={test.name}
        subtitle={test.product?.name}
        actions={<Link to="/ab" className="text-sm font-bold text-brand-600">← الاختبارات</Link>}
      />
      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <input readOnly dir="ltr" className={`${inputCls} flex-1`} value={url} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="secondary" onClick={() => navigator.clipboard.writeText(url).then(() => notify('تم نسخ الرابط'))}>نسخ الرابط</Button>
          <Toggle checked={test.is_active} onChange={toggleTest} label="يعمل" />
        </div>
        <p className="mt-2 text-xs text-slate-500">بعد أي تغيير في النسخ يُحدَّث المتجر تلقائياً. الزائر يرى النسخة نفسها في كل زيارة.</p>
      </Card>

      <Card title="النسخ والنتائج">
        {rows.length === 0 && (
          <p className="text-sm text-slate-500">
            لا توجد نسخ. افتح <Link className="font-bold text-brand-600" to={`/products/${test.product_id}/design`}>تصميم AI للمنتج</Link> واحفظ التصميم كنسخة في هذا الاختبار.
          </p>
        )}
        <div className="space-y-3">
          {rows.map(({ v, s }) => {
            const cr = s.views ? (s.orders / s.views) * 100 : 0
            const conf = best && best.v.id !== v.id ? confidence(best.s.views, best.s.orders, s.views, s.orders) : null
            return (
              <div key={v.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold">{v.label} {best?.v.id === v.id && totalViews > 0 && <span className="text-emerald-600">🏆</span>}</div>
                  <div className="flex items-center gap-3">
                    <Link className="text-xs font-bold text-brand-600" to={`/products/${test.product_id}/design?variant=${v.id}`}>تعديل التصميم</Link>
                    <Toggle checked={v.is_active} onChange={(x) => patchVariant(v.id, { is_active: x })} />
                    <button className="text-xs font-bold text-rose-600" onClick={() => del(v.id)}>حذف</button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-center text-sm">
                  <div><div className="text-xs text-slate-500">زيارات</div><b>{s.views}</b></div>
                  <div><div className="text-xs text-slate-500">طلبات</div><b>{s.orders}</b></div>
                  <div><div className="text-xs text-slate-500">التحويل</div><b>{cr.toFixed(1)}%</b></div>
                  <div><div className="text-xs text-slate-500">الإيراد</div><b>{s.revenue.toLocaleString('en')}</b></div>
                </div>
                {conf != null && s.views >= 30 && (
                  <p className="mt-2 text-xs text-slate-500">الفرق عن الأفضل: ثقة إحصائية {(conf * 100).toFixed(0)}%{conf < 0.95 ? ' (غير حاسمة بعد)' : ''}</p>
                )}
              </div>
            )
          })}
        </div>
        {totalViews < 200 && rows.length > 1 && (
          <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">العينة صغيرة (أقل من 200 زيارة). لا تستنتج قبل أن تتجمع بيانات كافية.</p>
        )}
        <Button variant="danger" className="mt-4" onClick={removeTest}>حذف الاختبار</Button>
      </Card>
    </div>
  )
}
