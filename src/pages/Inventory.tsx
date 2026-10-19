import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, inputCls } from '../components/ui'
import { dzd } from '../lib/format'
import { supabase } from '../lib/supabase'

type Variant = { id: string; size: string | null; color: string | null; stock_quantity: number }
type Product = { id: string; name: string; cost_price: number | null; lh_product_variants: Variant[] }
type Purchase = {
  id: string
  product_id: string
  variant_id: string | null
  quantity: number
  unit_cost: number
  supplier: string | null
  purchased_at: string
  lh_products: { name: string } | null
  lh_product_variants: { size: string | null; color: string | null } | null
}

const vLabel = (v: { size: string | null; color: string | null } | null) => [v?.size, v?.color].filter(Boolean).join(' / ') || 'الافتراضي'
const today = () => new Date().toISOString().slice(0, 10)

export default function Inventory() {
  const notify = useToast()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [date, setDate] = useState(today())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [p, h] = await Promise.all([
      supabase.from('lh_products').select('id,name,cost_price,lh_product_variants(id,size,color,stock_quantity)').order('name').limit(500),
      supabase.from('lh_stock_purchases').select('id,product_id,variant_id,quantity,unit_cost,supplier,purchased_at,lh_products(name),lh_product_variants(size,color)').order('purchased_at', { ascending: false }).order('created_at', { ascending: false }).limit(200),
    ])
    if (p.error) notify(p.error.message, 'error')
    setProducts((p.data ?? []) as unknown as Product[])
    setPurchases(((h.data ?? []) as unknown as Purchase[]).map((r) => ({ ...r, unit_cost: Number(r.unit_cost) })))
  }, [notify])
  useEffect(() => void load(), [load])

  const product = products?.find((p) => p.id === productId)
  const variants = product?.lh_product_variants ?? []
  useEffect(() => {
    setVariantId(variants.length === 1 ? variants[0].id : '')
  }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Preview of the new average cost.
  const preview = useMemo(() => {
    const q = Number(qty)
    const c = Number(cost)
    if (!product || !(q > 0) || cost === '' || !(c >= 0)) return null
    const stock = variants.reduce((a, v) => a + v.stock_quantity, 0)
    const cur = product.cost_price
    return cur == null || stock <= 0 ? c : (stock * cur + q * c) / (stock + q)
  }, [product, variants, qty, cost])

  const add = async () => {
    const q = Math.floor(Number(qty))
    const c = Number(cost)
    if (!product) return notify('اختر المنتج.', 'error')
    if (variants.length > 0 && !variantId) return notify('اختر المقاس/اللون.', 'error')
    if (!(q > 0) || cost === '' || !(c >= 0)) return notify('أدخل الكمية وسعر الشراء.', 'error')
    setSaving(true)
    const { error } = await supabase.from('lh_stock_purchases').insert({
      product_id: product.id,
      variant_id: variantId || null,
      quantity: q,
      unit_cost: c,
      supplier: supplier.trim() || null,
      purchased_at: date,
    })
    setSaving(false)
    if (error) return notify(/lh_stock_purchases|schema cache/i.test(error.message) ? 'طبّق هجرة المخزون أولاً.' : error.message, 'error')
    notify('سُجّل الشراء وزاد المخزون.', 'success')
    setQty('')
    setCost('')
    void load()
  }

  const remove = async (id: string) => {
    if (!confirm('حذف هذه الدفعة؟ ستُخصم كميتها من المخزون (سعر التكلفة المتوسط يبقى كما هو).')) return
    const { error } = await supabase.from('lh_stock_purchases').delete().eq('id', id)
    if (error) return notify(error.message, 'error')
    void load()
  }

  if (!products) return <PageLoader />
  const value = products.reduce((a, p) => a + (p.cost_price ?? 0) * p.lh_product_variants.reduce((s, v) => s + v.stock_quantity, 0), 0)

  return (
    <div>
      <PageHeader title="🏬 المخزون" subtitle="سجّل كل شراء جديد: المنتج نفسه يمكن شراؤه بسعر مختلف في كل مرة، فيُحسب سعر التكلفة بالمتوسط المرجّح للكمية الموجودة والمشتراة." />

      <Card title="شراء جديد" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="المنتج">
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
              <option value="">— اختر —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {variants.length > 0 && (
            <Field label="المقاس / اللون">
              <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className={inputCls}>
                <option value="">— اختر —</option>
                {variants.map((v) => <option key={v.id} value={v.id}>{vLabel(v)} (المخزون {v.stock_quantity})</option>)}
              </select>
            </Field>
          )}
          <Field label="الكمية"><input type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} /></Field>
          <Field label="سعر شراء القطعة (د.ج)"><input type="number" min={0} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} /></Field>
          <Field label="المورّد (اختياري)"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputCls} /></Field>
          <Field label="التاريخ"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        </div>
        {product && (
          <p className="mt-3 text-xs text-slate-600">
            التكلفة الحالية: <b>{product.cost_price != null ? dzd(product.cost_price) : 'غير محددة'}</b>
            {preview != null && <> ← بعد هذا الشراء: <b className="text-emerald-700">{dzd(Math.round(preview * 100) / 100)}</b></>}
          </p>
        )}
        <div className="mt-3"><Button onClick={add} loading={saving}>➕ تسجيل الشراء</Button></div>
      </Card>

      <Card title={`المخزون الحالي (قيمته بسعر التكلفة: ${dzd(value)})`} className="mb-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="text-xs text-slate-500"><th className="p-2 text-start">المنتج</th><th className="p-2 text-start">المتغيرات</th><th className="p-2 text-start">الإجمالي</th><th className="p-2 text-start">متوسط التكلفة</th></tr></thead>
            <tbody>
              {products.map((p) => {
                const total = p.lh_product_variants.reduce((a, v) => a + v.stock_quantity, 0)
                return (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    <td className="p-2 font-semibold">{p.name}</td>
                    <td className="p-2 text-xs text-slate-600">{p.lh_product_variants.length === 0 ? '—' : p.lh_product_variants.map((v) => <div key={v.id}>{vLabel(v)}: <b className={v.stock_quantity <= 0 ? 'text-rose-600' : ''}>{v.stock_quantity}</b></div>)}</td>
                    <td className="p-2 font-bold">{total}</td>
                    <td className="p-2">{p.cost_price != null ? dzd(p.cost_price) : '⚠️ —'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="سجل المشتريات">
        {purchases.length === 0 ? (
          <p className="text-sm text-slate-500">لا مشتريات مسجّلة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-xs text-slate-500"><th className="p-2 text-start">التاريخ</th><th className="p-2 text-start">المنتج</th><th className="p-2 text-start">الكمية</th><th className="p-2 text-start">سعر القطعة</th><th className="p-2 text-start">الإجمالي</th><th className="p-2 text-start">المورّد</th><th /></tr></thead>
              <tbody>
                {purchases.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-2 whitespace-nowrap">{r.purchased_at}</td>
                    <td className="p-2">{r.lh_products?.name}{r.variant_id && <span className="text-xs text-slate-500"> ({vLabel(r.lh_product_variants)})</span>}</td>
                    <td className="p-2">{r.quantity}</td>
                    <td className="p-2">{dzd(r.unit_cost)}</td>
                    <td className="p-2 font-bold">{dzd(r.quantity * r.unit_cost)}</td>
                    <td className="p-2 text-slate-500">{r.supplier}</td>
                    <td className="p-2"><button onClick={() => remove(r.id)} className="text-xs text-rose-600" aria-label="حذف">🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
