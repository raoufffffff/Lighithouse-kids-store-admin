import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Button, Card, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { dzd } from '../lib/format'
import { refreshStore } from '../lib/store'
import { supabase } from '../lib/supabase'

type Offer = { qty: number; total: number; label: string; active: boolean }
type Variant = { color: string | null; size: string | null; stock_quantity: number; is_active: boolean }

export default function ProductOffers() {
  const { id } = useParams()
  const navigate = useNavigate()
  const notify = useToast()
  const [name, setName] = useState('')
  const [price, setPrice] = useState(0)
  const [variants, setVariants] = useState<Variant[]>([])
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const [p, o] = await Promise.all([
        supabase.from('lh_products').select('name,base_price,lh_product_variants(color,size,stock_quantity,is_active)').eq('id', id).maybeSingle(),
        supabase.from('lh_product_offers').select('qty,total_price,label,is_active').eq('product_id', id).order('qty'),
      ])
      if (!p.data) {
        notify('المنتج غير موجود', 'error')
        return navigate('/products', { replace: true })
      }
      if (o.error) {
        notify(/lh_product_offers|schema cache/i.test(o.error.message) ? 'طبّق هجرة العروض أولاً.' : o.error.message, 'error')
      }
      setName(p.data.name as string)
      setPrice(Number(p.data.base_price))
      setVariants(((p.data as unknown as { lh_product_variants: Variant[] }).lh_product_variants ?? []).filter((v) => v.is_active))
      setOffers(((o.data ?? []) as { qty: number; total_price: number; label: string | null; is_active: boolean }[]).map((r) => ({ qty: r.qty, total: Number(r.total_price), label: r.label ?? '', active: r.is_active })))
    })()
  }, [id, navigate, notify])

  if (!offers) return <PageLoader />

  const tracked = variants.length > 0
  const maxStock = tracked ? Math.max(...variants.map((v) => v.stock_quantity)) : Infinity
  const totalStock = variants.reduce((a, v) => a + v.stock_quantity, 0)
  const set = (i: number, patch: Partial<Offer>) => setOffers((os) => os!.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  const suggest = (qty: number, pct: number) => {
    if (offers.some((o) => o.qty === qty)) return
    setOffers((os) => [...os!, { qty, total: Math.round((price * qty * (1 - pct / 100)) / 50) * 50, label: '', active: true }].sort((a, b) => a.qty - b.qty))
  }

  const problems = (o: Offer): string[] => {
    const out: string[] = []
    if (o.qty < 2 || o.qty > 10) out.push('الكمية بين 2 و10')
    if (o.total <= 0) out.push('اكتب السعر الإجمالي')
    else if (o.total >= price * o.qty) out.push('السعر لا يقل عن السعر العادي، فلا يُعدّ عرضاً')
    if (offers.filter((x) => x.qty === o.qty).length > 1) out.push('كمية مكررة')
    return out
  }
  const stockNote = (o: Offer) => (tracked && o.qty > maxStock ? `لن يظهر للزبائن: أعلى مخزون لخيار واحد هو ${maxStock}` : '')

  const save = async () => {
    if (!id) return
    if (offers.some((o) => problems(o).length)) return notify('صحّح الأخطاء الظاهرة قبل الحفظ', 'error')
    setSaving(true)
    const keep = offers.map((o) => o.qty)
    const del = supabase.from('lh_product_offers').delete().eq('product_id', id)
    const r1 = keep.length ? await del.not('qty', 'in', `(${keep.join(',')})`) : await del
    const r2 = offers.length
      ? await supabase.from('lh_product_offers').upsert(
          offers.map((o) => ({ product_id: id, qty: o.qty, total_price: o.total, label: o.label.trim() || null, is_active: o.active })),
          { onConflict: 'product_id,qty' },
        )
      : { error: null }
    setSaving(false)
    const err = r1.error ?? r2.error
    if (err) return notify('فشل الحفظ: ' + err.message, 'error')
    const ok = await refreshStore()
    notify(ok ? 'تم الحفظ وتحديث المتجر ✓' : 'تم الحفظ. تعذّر تحديث المتجر تلقائياً.', ok ? 'success' : 'error')
  }

  return (
    <div>
      <PageHeader title={`🎁 عروض الكمية: ${name}`} subtitle={`السعر العادي ${dzd(price)}`} actions={<Link to="/products" className="text-sm font-bold text-brand-600">← المنتجات</Link>} />

      <Card title="ارتباط العروض بالمخزون" className="mb-4">
        {tracked ? (
          <ul className="space-y-1 text-sm text-slate-700">
            <li>المخزون الكلي: <b>{totalStock}</b> — أعلى مخزون لخيار واحد: <b>{maxStock}</b></li>
            <li className="text-xs text-slate-500">يظهر العرض للزبون فقط إذا كان مخزون الخيار (اللون/المقاس) الذي اختاره يكفي كميته، ويختفي تلقائياً عند نفاده. كل طلب يخصم من المخزون، ويعود المخزون عند إلغاء الطلب أو إرجاعه.</li>
          </ul>
        ) : (
          <p className="text-sm text-slate-500">هذا المنتج بلا خيارات، فلا مخزون مرتبط به وتظهر العروض دائماً.</p>
        )}
        {tracked && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {variants.map((v, i) => (
              <span key={i} className={`rounded-full px-2.5 py-1 font-bold ${v.stock_quantity > 0 ? 'bg-slate-100 text-slate-700' : 'bg-rose-100 text-rose-700'}`}>
                {[v.color, v.size].filter(Boolean).join(' / ') || 'افتراضي'}: {v.stock_quantity}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card title="العروض">
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span className="self-center text-slate-500">اقتراحات سريعة:</span>
          <button type="button" onClick={() => suggest(2, 10)} className="rounded-full bg-white px-3 py-1.5 font-bold text-brand-700 ring-1 ring-slate-200">2 بخصم 10%</button>
          <button type="button" onClick={() => suggest(3, 15)} className="rounded-full bg-white px-3 py-1.5 font-bold text-brand-700 ring-1 ring-slate-200">3 بخصم 15%</button>
          <button type="button" onClick={() => suggest(5, 20)} className="rounded-full bg-white px-3 py-1.5 font-bold text-brand-700 ring-1 ring-slate-200">5 بخصم 20%</button>
        </div>
        {offers.length === 0 && <p className="mb-3 text-sm text-slate-500">لا توجد عروض. استخدم الاقتراحات أو أضف عرضاً.</p>}
        <div className="space-y-3">
          {offers.map((o, i) => {
            const errs = problems(o)
            const note = stockNote(o)
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-[90px_150px_1fr_auto]">
                  <label className="text-xs font-bold text-slate-600">الكمية
                    <input type="number" min={2} max={10} className={inputCls} value={o.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} />
                  </label>
                  <label className="text-xs font-bold text-slate-600">السعر الإجمالي (د.ج)
                    <input type="number" min={1} className={inputCls} value={o.total || ''} onChange={(e) => set(i, { total: Number(e.target.value) })} />
                  </label>
                  <label className="text-xs font-bold text-slate-600">عنوان (اختياري)
                    <input className={inputCls} maxLength={40} placeholder={`${o.qty} قطع`} value={o.label} onChange={(e) => set(i, { label: e.target.value })} />
                  </label>
                  <div className="flex items-end gap-3 pb-1">
                    <Toggle checked={o.active} onChange={(v) => set(i, { active: v })} />
                    <button type="button" className="text-xs font-bold text-rose-600" onClick={() => setOffers((os) => os!.filter((_, j) => j !== i))}>حذف</button>
                  </div>
                </div>
                {o.total > 0 && o.total < price * o.qty && (
                  <p className="mt-2 text-xs text-emerald-700">توفير للزبون {dzd(price * o.qty - o.total)} ({Math.round((1 - o.total / (price * o.qty)) * 100)}%) — سعر القطعة {dzd(Math.round(o.total / o.qty))}</p>
                )}
                {errs.map((e) => <p key={e} className="mt-1 text-xs font-bold text-rose-600">{e}</p>)}
                {note && <p className="mt-1 text-xs font-bold text-amber-700">{note}</p>}
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => {
            const used = new Set(offers.map((o) => o.qty))
            let q = 2
            while (used.has(q) && q < 10) q++
            setOffers([...offers, { qty: q, total: 0, label: '', active: true }])
          }}>+ عرض جديد</Button>
          <Button onClick={save} loading={saving}>حفظ وتحديث المتجر</Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">السعر يُحسب في الخادم أيضاً، فلا يمكن للزائر تغييره. العرض لا يُطبَّق على خيارات لها سعر خاص.</p>
      </Card>
    </div>
  )
}
