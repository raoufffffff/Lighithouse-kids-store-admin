import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, inputCls } from '../components/ui'
import { dzd, formatDate } from '../lib/format'
import { assetUrl } from '../lib/store'
import { supabase } from '../lib/supabase'
import { ORDER_STATUSES, statusMeta } from '../lib/types'
import type { Order, OrderItem, OrderStatus } from '../lib/types'

type Item = OrderItem & { product_id: string | null; variant_id: string | null }
type Rate = { wilaya_code: number; wilaya_name: string; home_fee: number; desk_fee: number }
type Cost = { home_cost: number; desk_cost: number }
type Draft = {
  customer_name: string
  customer_phone: string
  wilaya_code: string
  commune: string
  address: string
  delivery_type: 'home' | 'desk'
  delivery_fee: string
  discount: string
  qty: Record<string, string>
}

export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const notify = useToast()

  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [images, setImages] = useState<Record<string, string>>({})
  const [rates, setRates] = useState<Rate[]>([])
  const [costs, setCosts] = useState<Record<number, Cost>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState(false)
  const [params, setParams] = useSearchParams()
  const [wilaya, setWilaya] = useState('')
  const [status, setStatus] = useState<OrderStatus>('pending')
  const [tracking, setTracking] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const [o, it, rt, cs, pr] = await Promise.all([
        supabase.from('lh_orders').select('*').eq('id', id).maybeSingle(),
        supabase.from('lh_order_items').select('*').eq('order_id', id),
        supabase.from('lh_delivery_rates').select('wilaya_code,wilaya_name,home_fee,desk_fee').order('wilaya_code'),
        supabase.from('lh_delivery_costs').select('wilaya_code,home_cost,desk_cost'),
        supabase.from('lh_products').select('id,images'),
      ])
      if (cancelled) return
      if (o.error || !o.data) {
        notify('الطلب غير موجود', 'error')
        navigate('/orders', { replace: true })
        return
      }
      const ord = o.data as Order
      setOrder(ord)
      setItems((it.data ?? []) as Item[])
      setRates(((rt.data ?? []) as Rate[]).map((r) => ({ ...r, home_fee: Number(r.home_fee), desk_fee: Number(r.desk_fee) })))
      setCosts(Object.fromEntries((cs.data ?? []).map((c) => [c.wilaya_code as number, { home_cost: Number(c.home_cost), desk_cost: Number(c.desk_cost) }])))
      setImages(Object.fromEntries((pr.data ?? []).map((x) => [x.id as string, ((x.images as string[] | null) ?? [])[0] ?? ''])))
      setStatus(ord.status)
      setTracking(ord.tracking_number ?? '')
      setNotes(ord.notes ?? '')
      if (ord.wilaya_code) {
        const w = ((rt.data ?? []) as Rate[]).find((r) => r.wilaya_code === ord.wilaya_code)
        setWilaya(w?.wilaya_name ?? String(ord.wilaya_code))
      }
      if (params.get('edit') === '1') {
        setDraft(makeDraft(ord, (it.data ?? []) as Item[]))
        setEditing(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate, notify])

  if (!order) return <PageLoader />

  const save = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('lh_orders')
      .update({ status, tracking_number: tracking.trim() || null, notes: notes.trim() || null })
      .eq('id', order.id)
    setSaving(false)
    if (error) {
      notify('فشل الحفظ: ' + error.message, 'error')
      return
    }
    notify('تم حفظ الطلب')
    setOrder({ ...order, status, tracking_number: tracking.trim() || null, notes: notes.trim() || null })
  }

  const meta = statusMeta(order.status)

  const startEdit = () => {
    setDraft(makeDraft(order, items))
    setEditing(true)
  }
  const stopEdit = () => {
    setEditing(false)
    setDraft(null)
    if (params.has('edit')) setParams({}, { replace: true })
  }
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d))
  // Changing wilaya/type proposes the site price for it; the field stays editable.
  const suggestFee = (code: string, type: 'home' | 'desk') => {
    const r = rates.find((x) => String(x.wilaya_code) === code)
    return r ? String(type === 'home' ? r.home_fee : r.desk_fee) : null
  }

  const newItems = (d: Draft) =>
    items.map((i) => {
      const q = Math.max(1, Math.floor(Number(d.qty[i.id]) || i.quantity))
      return q === i.quantity ? i : { ...i, quantity: q, line_total: Number(i.unit_price) * q }
    })
  const draftSubtotal = draft ? newItems(draft).reduce((a, i) => a + Number(i.line_total), 0) : 0
  const draftTotal = draft ? Math.max(0, draftSubtotal - (Number(draft.discount) || 0) + (Number(draft.delivery_fee) || 0)) : 0

  const saveEdit = async () => {
    if (!draft) return
    if (draft.customer_name.trim().length < 2) return notify('أدخل اسم العميل', 'error')
    if (!/^0[567]\d{8}$/.test(draft.customer_phone.trim())) return notify('رقم الهاتف غير صحيح (مثال 0555123456)', 'error')
    setSaving(true)
    const upd = newItems(draft)
    const changed = upd.filter((i, k) => i.quantity !== items[k].quantity)
    // Stock follows the quantity change automatically (database trigger) while the order is confirmed.
    for (const i of changed) {
      const { error } = await supabase.from('lh_order_items').update({ quantity: i.quantity, line_total: i.line_total }).eq('id', i.id)
      if (error) {
        setSaving(false)
        return notify('فشل تعديل الكمية: ' + error.message, 'error')
      }
    }
    const fields = {
      customer_name: draft.customer_name.trim(),
      customer_phone: draft.customer_phone.trim(),
      wilaya_code: draft.wilaya_code ? Number(draft.wilaya_code) : null,
      commune: draft.commune.trim() || null,
      address: draft.address.trim() || null,
      delivery_type: draft.delivery_type,
      delivery_fee: Math.max(0, Number(draft.delivery_fee) || 0),
      discount: Math.max(0, Number(draft.discount) || 0),
      subtotal: draftSubtotal,
      total: draftTotal,
    }
    const { error } = await supabase.from('lh_orders').update(fields).eq('id', order.id)
    setSaving(false)
    if (error) return notify('فشل الحفظ: ' + error.message, 'error')
    setOrder({ ...order, ...fields })
    setItems(upd)
    setWilaya(rates.find((r) => r.wilaya_code === fields.wilaya_code)?.wilaya_name ?? (fields.wilaya_code ? String(fields.wilaya_code) : ''))
    notify('تم تعديل الطلب')
    stopEdit()
  }

  const removeOrder = async () => {
    if (!confirm(`حذف الطلب #${order.order_number} نهائياً؟ لا يمكن التراجع.${['confirmed', 'shipped', 'delivered'].includes(order.status) ? '\nسيُعاد المخزون تلقائياً.' : ''}`)) return
    if (!['cancelled', 'returned'].includes(order.status)) {
      const r = await supabase.from('lh_orders').update({ status: 'cancelled' }).eq('id', order.id)
      if (r.error) return notify('فشل الحذف: ' + r.error.message, 'error')
    }
    const { error } = await supabase.from('lh_orders').delete().eq('id', order.id)
    if (error) return notify('فشل الحذف: ' + error.message, 'error')
    notify('تم حذف الطلب')
    navigate('/orders', { replace: true })
  }

  const realCost = order.wilaya_code && costs[order.wilaya_code] ? (order.delivery_type === 'home' ? costs[order.wilaya_code].home_cost : costs[order.wilaya_code].desk_cost) : null

  return (
    <>
      <PageHeader
        title={`الطلب #${order.order_number}`}
        subtitle={formatDate(order.created_at)}
        actions={
          <>
            {!editing && <Button variant="secondary" onClick={startEdit}>✏️ تعديل</Button>}
            <Button variant="danger" onClick={removeOrder}>🗑 حذف</Button>
            <Link to="/orders">
              <Button variant="secondary">← الطلبات</Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="المنتجات">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                    <th className="p-2 font-semibold">المنتج</th>
                    <th className="p-2 font-semibold">السعر</th>
                    <th className="p-2 font-semibold">الكمية</th>
                    <th className="p-2 font-semibold">المجموع</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2">
                        <div className="flex items-center gap-3">
                          {i.product_id && images[i.product_id] ? (
                            <img src={assetUrl(images[i.product_id])} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover" />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl">🧸</div>
                          )}
                          <div>
                            <div className="font-semibold">{i.product_name}</div>
                            {i.variant_label && <div className="text-xs text-slate-500">{i.variant_label}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="p-2">{dzd(i.unit_price)}</td>
                      <td className="p-2">
                        {editing && draft ? (
                          <input type="number" min={1} className={`${inputCls} w-20`} value={draft.qty[i.id] ?? ''} onChange={(e) => patch({ qty: { ...draft.qty, [i.id]: e.target.value } })} />
                        ) : (
                          i.quantity
                        )}
                      </td>
                      <td className="p-2 font-semibold">
                        {editing && draft ? dzd(newItems(draft).find((x) => x.id === i.id)!.line_total) : dzd(i.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-4 space-y-1 border-t border-slate-200 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">المجموع الفرعي</dt>
                <dd>{dzd(editing && draft ? draftSubtotal : order.subtotal)}</dd>
              </div>
              {(editing ? Number(draft?.discount) > 0 : order.discount > 0) && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">الخصم</dt>
                  <dd>- {dzd(editing && draft ? Number(draft.discount) : order.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">التوصيل ({(editing && draft ? draft.delivery_type : order.delivery_type) === 'home' ? 'للمنزل' : 'للمكتب'})</dt>
                <dd>{dzd(editing && draft ? Number(draft.delivery_fee) || 0 : order.delivery_fee)}</dd>
              </div>
              <div className="flex justify-between text-base font-bold">
                <dt>الإجمالي (الدفع عند الاستلام)</dt>
                <dd>{dzd(editing && draft ? draftTotal : order.total)}</dd>
              </div>
              {!editing && realCost != null && (
                <div className="flex justify-between border-t border-dashed border-slate-200 pt-2 text-xs">
                  <dt className="text-slate-500">تكلفة التوصيل الحقيقية (شركة التوصيل)</dt>
                  <dd className={Number(order.delivery_fee) - realCost < 0 ? 'font-bold text-rose-600' : 'font-bold text-emerald-700'}>
                    {dzd(realCost)} ({Number(order.delivery_fee) - realCost < 0 ? 'خسارة ' : 'فرق '}
                    {dzd(Math.abs(Number(order.delivery_fee) - realCost))})
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card title="العميل والتوصيل">
            {editing && draft ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="الاسم"><input className={inputCls} value={draft.customer_name} onChange={(e) => patch({ customer_name: e.target.value })} /></Field>
                  <Field label="الهاتف"><input className={inputCls} dir="ltr" value={draft.customer_phone} onChange={(e) => patch({ customer_phone: e.target.value })} /></Field>
                  <Field label="الولاية">
                    <select
                      className={inputCls}
                      value={draft.wilaya_code}
                      onChange={(e) => {
                        const fee = suggestFee(e.target.value, draft.delivery_type)
                        patch({ wilaya_code: e.target.value, ...(fee != null ? { delivery_fee: fee } : {}) })
                      }}
                    >
                      <option value="">—</option>
                      {rates.map((r) => <option key={r.wilaya_code} value={r.wilaya_code}>{r.wilaya_code} - {r.wilaya_name}</option>)}
                    </select>
                  </Field>
                  <Field label="البلدية"><input className={inputCls} value={draft.commune} onChange={(e) => patch({ commune: e.target.value })} /></Field>
                  <Field label="نوع التوصيل">
                    <select
                      className={inputCls}
                      value={draft.delivery_type}
                      onChange={(e) => {
                        const t = e.target.value as 'home' | 'desk'
                        const fee = suggestFee(draft.wilaya_code, t)
                        patch({ delivery_type: t, ...(fee != null ? { delivery_fee: fee } : {}) })
                      }}
                    >
                      <option value="home">للمنزل</option>
                      <option value="desk">للمكتب</option>
                    </select>
                  </Field>
                  <Field label="سعر التوصيل (د.ج)"><input type="number" min={0} className={inputCls} value={draft.delivery_fee} onChange={(e) => patch({ delivery_fee: e.target.value })} /></Field>
                  <Field label="الخصم (د.ج)"><input type="number" min={0} className={inputCls} value={draft.discount} onChange={(e) => patch({ discount: e.target.value })} /></Field>
                </div>
                <Field label="العنوان"><input className={inputCls} value={draft.address} onChange={(e) => patch({ address: e.target.value })} /></Field>
                <div className="flex gap-2">
                  <Button onClick={saveEdit} loading={saving}>حفظ التعديلات</Button>
                  <Button variant="secondary" onClick={stopEdit}>إلغاء</Button>
                </div>
                <p className="text-xs text-slate-500">تغيير الولاية أو نوع التوصيل يقترح سعر الموقع تلقائياً ويمكنك تعديله. تعديل الكمية يعدّل المخزون معه إن كان الطلب مؤكداً.</p>
              </div>
            ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">الاسم</dt>
                <dd className="font-semibold">{order.customer_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الهاتف</dt>
                <dd className="font-semibold" dir="ltr">
                  <a href={`tel:${order.customer_phone}`} className="text-brand-600 hover:underline">
                    {order.customer_phone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الولاية</dt>
                <dd className="font-semibold">{wilaya || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">البلدية</dt>
                <dd className="font-semibold">{order.commune || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">العنوان</dt>
                <dd className="font-semibold">{order.address || '—'}</dd>
              </div>
            </dl>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="إدارة الطلب">
            <div className="space-y-4">
              <p className="text-sm">
                الحالة الحالية:{' '}
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${meta.badge}`}>{meta.label}</span>
              </p>
              <Field label="تغيير الحالة">
                <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
                  {ORDER_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="رقم التتبع">
                <input
                  className={inputCls}
                  dir="ltr"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                />
              </Field>
              <Field label="ملاحظات داخلية">
                <textarea className={inputCls} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Button onClick={save} loading={saving} className="w-full">
                حفظ
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

function makeDraft(o: Order, items: Item[]): Draft {
  return {
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    wilaya_code: o.wilaya_code ? String(o.wilaya_code) : '',
    commune: o.commune ?? '',
    address: o.address ?? '',
    delivery_type: o.delivery_type,
    delivery_fee: String(o.delivery_fee),
    discount: String(o.discount),
    qty: Object.fromEntries(items.map((i) => [i.id, String(i.quantity)])),
  }
}
