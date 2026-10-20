import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, inputCls } from '../components/ui'
import { dzd } from '../lib/format'
import { supabase } from '../lib/supabase'

type Item = {
  id: string
  name: string
  quantity: number
  avg_cost: number
  lh_product_stock_links: { qty_per_unit: number; lh_products: { id: string; name: string } | null }[]
}
type Purchase = {
  id: string
  quantity: number
  unit_cost: number
  supplier: string | null
  purchased_at: string
  stock_item_id: string | null
  lh_stock_items: { name: string } | null
}
type Move = { id: string; delta: number; reason: string; order_number: number | null; created_at: string }

const REASONS: Record<string, string> = {
  purchase: 'شراء',
  purchase_removed: 'حذف شراء',
  order_confirmed: 'تأكيد طلب',
  order_released: 'إرجاع من طلب',
  order_edit: 'تعديل كمية طلب',
  adjust: 'تعديل يدوي',
}
const today = () => new Date().toISOString().slice(0, 10)

export default function Inventory() {
  const notify = useToast()
  const [items, setItems] = useState<Item[] | null>(null)
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [itemId, setItemId] = useState('')
  const [newName, setNewName] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [supplier, setSupplier] = useState('')
  const [date, setDate] = useState(today())
  const [saving, setSaving] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [moves, setMoves] = useState<Move[]>([])

  const load = useCallback(async () => {
    const [i, h] = await Promise.all([
      supabase.from('lh_stock_items').select('id,name,quantity,avg_cost,lh_product_stock_links(qty_per_unit,lh_products(id,name))').order('name').limit(500),
      supabase.from('lh_stock_purchases').select('id,quantity,unit_cost,supplier,purchased_at,stock_item_id,lh_stock_items(name)').not('stock_item_id', 'is', null).order('purchased_at', { ascending: false }).order('created_at', { ascending: false }).limit(200),
    ])
    if (i.error) notify(/lh_stock_items|schema cache/i.test(i.error.message) ? 'طبّق هجرة عناصر المخزون أولاً.' : i.error.message, 'error')
    setItems(((i.data ?? []) as unknown as Item[]).map((r) => ({ ...r, avg_cost: Number(r.avg_cost) })))
    setPurchases(((h.data ?? []) as unknown as Purchase[]).map((r) => ({ ...r, unit_cost: Number(r.unit_cost) })))
  }, [notify])
  useEffect(() => void load(), [load])

  const item = items?.find((x) => x.id === itemId)
  const q = Math.floor(Number(qty))
  const c = Number(cost)
  const preview = item && q > 0 && cost !== '' && c >= 0 ? (item.quantity <= 0 ? c : (item.quantity * item.avg_cost + q * c) / (item.quantity + q)) : null

  const add = async () => {
    if (!(q > 0) || cost === '' || !(c >= 0)) return notify('أدخل الكمية وسعر الشراء.', 'error')
    let id = itemId
    setSaving(true)
    if (id === '__new') {
      const name = newName.trim()
      if (!name) {
        setSaving(false)
        return notify('اكتب اسم العنصر الجديد.', 'error')
      }
      const r = await supabase.from('lh_stock_items').insert({ name }).select('id').single()
      if (r.error) {
        setSaving(false)
        return notify(/duplicate|unique/i.test(r.error.message) ? 'يوجد عنصر بنفس الاسم.' : r.error.message, 'error')
      }
      id = r.data.id
    }
    if (!id) {
      setSaving(false)
      return notify('اختر عنصر المخزون.', 'error')
    }
    const { error } = await supabase.from('lh_stock_purchases').insert({
      stock_item_id: id,
      quantity: q,
      unit_cost: c,
      supplier: supplier.trim() || null,
      purchased_at: date,
    })
    setSaving(false)
    if (error) return notify(error.message, 'error')
    notify('سُجّل الشراء وزاد المخزون.', 'success')
    setQty('')
    setCost('')
    setNewName('')
    setItemId(id)
    void load()
  }

  const removePurchase = async (id: string) => {
    if (!confirm('حذف هذه الدفعة؟ ستُخصم كميتها من المخزون (متوسط التكلفة يبقى كما هو).')) return
    const { error } = await supabase.from('lh_stock_purchases').delete().eq('id', id)
    if (error) return notify(error.message, 'error')
    void load()
  }

  const removeItem = async (it: Item) => {
    if (!confirm(`حذف العنصر «${it.name}» نهائياً مع مشترياته وحركاته؟ ينفصل عن المنتجات المرتبطة به.`)) return
    const { error } = await supabase.from('lh_stock_items').delete().eq('id', it.id)
    if (error) return notify(error.message, 'error')
    void load()
  }

  const adjust = async (it: Item) => {
    const v = prompt(`الكمية الفعلية الموجودة من «${it.name}» (الحالية في النظام: ${it.quantity})`, String(it.quantity))
    if (v == null) return
    const target = Math.floor(Number(v))
    if (!Number.isFinite(target) || target < 0) return notify('أدخل عدداً صحيحاً موجباً.', 'error')
    const delta = target - it.quantity
    if (delta === 0) return
    const u = await supabase.from('lh_stock_items').update({ quantity: target }).eq('id', it.id)
    if (u.error) return notify(u.error.message, 'error')
    await supabase.from('lh_stock_movements').insert({ stock_item_id: it.id, delta, reason: 'adjust' })
    notify('تم تعديل الكمية.', 'success')
    void load()
  }

  const toggle = async (id: string) => {
    if (openId === id) return setOpenId(null)
    setOpenId(id)
    setMoves([])
    const { data } = await supabase.from('lh_stock_movements').select('id,delta,reason,order_number,created_at').eq('stock_item_id', id).order('created_at', { ascending: false }).limit(30)
    setMoves((data ?? []) as Move[])
  }

  if (!items) return <PageLoader />
  const value = items.reduce((a, x) => a + x.quantity * x.avg_cost, 0)

  return (
    <div>
      <PageHeader title="🏬 المخزون" subtitle="عناصر المخزون تُشترى بأسعار مختلفة (متوسط مرجّح)، ويُربط كل منتج بعنصر أو أكثر. تنقص الكمية عند تأكيد الطلب وتعود عند إلغائه أو إرجاعه." />

      <Card title="شراء جديد" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="عنصر المخزون">
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
              <option value="">— اختر —</option>
              {items.map((p) => <option key={p.id} value={p.id}>{p.name} (الكمية {p.quantity})</option>)}
              <option value="__new">➕ عنصر جديد…</option>
            </select>
          </Field>
          {itemId === '__new' && (
            <Field label="اسم العنصر الجديد"><input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} /></Field>
          )}
          <Field label="الكمية"><input type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} /></Field>
          <Field label="سعر شراء القطعة (د.ج)"><input type="number" min={0} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} /></Field>
          <Field label="المورّد (اختياري)"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputCls} /></Field>
          <Field label="التاريخ"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        </div>
        {item && (
          <p className="mt-3 text-xs text-slate-600">
            متوسط التكلفة الحالي: <b>{dzd(item.avg_cost)}</b>
            {preview != null && <> ← بعد هذا الشراء: <b className="text-emerald-700">{dzd(Math.round(preview * 100) / 100)}</b></>}
          </p>
        )}
        <div className="mt-3"><Button onClick={add} loading={saving}>➕ تسجيل الشراء</Button></div>
      </Card>

      <Card title={`عناصر المخزون (القيمة الحالية: ${dzd(value)})`} className="mb-4">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">لا عناصر بعد. سجّل أول شراء لإنشاء عنصر.</p>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <button onClick={() => toggle(it.id)} className="text-start font-bold">{openId === it.id ? '▾' : '◂'} {it.name}</button>
                  <span className={`text-sm font-bold ${it.quantity <= 0 ? 'text-rose-600' : ''}`}>الكمية: {it.quantity}</span>
                  <span className="text-xs text-slate-600">متوسط التكلفة: {dzd(it.avg_cost)}</span>
                  <span className="text-xs text-slate-600">القيمة: {dzd(it.quantity * it.avg_cost)}</span>
                  <span className="mr-auto flex gap-3 text-xs">
                    <button onClick={() => adjust(it)} className="text-brand-700">✏️ جرد</button>
                    <button onClick={() => removeItem(it)} className="text-rose-600" aria-label="حذف">🗑️</button>
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {it.lh_product_stock_links.length === 0
                    ? 'غير مرتبط بأي منتج — اربطه من صفحة المنتج.'
                    : <>مرتبط بـ: {it.lh_product_stock_links.map((l, k) => (
                        <span key={k}>{k > 0 && '، '}{l.lh_products ? <Link className="text-brand-700 underline" to={`/products/${l.lh_products.id}`}>{l.lh_products.name}</Link> : '—'}{l.qty_per_unit > 1 && ` (×${l.qty_per_unit})`}</span>
                      ))}</>}
                </div>
                {openId === it.id && (
                  <div className="mt-2 border-t border-slate-100 pt-2 text-xs">
                    {moves.length === 0 ? <p className="text-slate-500">لا حركات.</p> : (
                      <table className="w-full">
                        <tbody>
                          {moves.map((m) => (
                            <tr key={m.id} className="border-t border-slate-50">
                              <td className="p-1 whitespace-nowrap text-slate-500">{new Date(m.created_at).toLocaleString('ar-DZ', { dateStyle: 'short', timeStyle: 'short' })}</td>
                              <td className="p-1">{REASONS[m.reason] ?? m.reason}{m.order_number != null && ` #${m.order_number}`}</td>
                              <td className={`p-1 font-bold ${m.delta < 0 ? 'text-rose-600' : 'text-emerald-700'}`} dir="ltr">{m.delta > 0 ? '+' : ''}{m.delta}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="سجل المشتريات">
        {purchases.length === 0 ? (
          <p className="text-sm text-slate-500">لا مشتريات مسجّلة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-xs text-slate-500"><th className="p-2 text-start">التاريخ</th><th className="p-2 text-start">العنصر</th><th className="p-2 text-start">الكمية</th><th className="p-2 text-start">سعر القطعة</th><th className="p-2 text-start">الإجمالي</th><th className="p-2 text-start">المورّد</th><th /></tr></thead>
              <tbody>
                {purchases.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-2 whitespace-nowrap">{r.purchased_at}</td>
                    <td className="p-2">{r.lh_stock_items?.name}</td>
                    <td className="p-2">{r.quantity}</td>
                    <td className="p-2">{dzd(r.unit_cost)}</td>
                    <td className="p-2 font-bold">{dzd(r.quantity * r.unit_cost)}</td>
                    <td className="p-2 text-slate-500">{r.supplier}</td>
                    <td className="p-2"><button onClick={() => removePurchase(r.id)} className="text-xs text-rose-600" aria-label="حذف">🗑️</button></td>
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
