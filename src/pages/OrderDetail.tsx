import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, inputCls } from '../components/ui'
import { dzd, formatDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import { ORDER_STATUSES, statusMeta } from '../lib/types'
import type { Order, OrderItem, OrderStatus } from '../lib/types'

export default function OrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const notify = useToast()

  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [wilaya, setWilaya] = useState('')
  const [status, setStatus] = useState<OrderStatus>('pending')
  const [tracking, setTracking] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const [o, it] = await Promise.all([
        supabase.from('lh_orders').select('*').eq('id', id).maybeSingle(),
        supabase.from('lh_order_items').select('*').eq('order_id', id),
      ])
      if (cancelled) return
      if (o.error || !o.data) {
        notify('الطلب غير موجود', 'error')
        navigate('/orders', { replace: true })
        return
      }
      const ord = o.data as Order
      setOrder(ord)
      setItems((it.data ?? []) as OrderItem[])
      setStatus(ord.status)
      setTracking(ord.tracking_number ?? '')
      setNotes(ord.notes ?? '')
      if (ord.wilaya_code) {
        const { data: w } = await supabase
          .from('lh_delivery_rates')
          .select('wilaya_name')
          .eq('wilaya_code', ord.wilaya_code)
          .maybeSingle()
        if (!cancelled) setWilaya(w?.wilaya_name ?? String(ord.wilaya_code))
      }
    })()
    return () => {
      cancelled = true
    }
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

  return (
    <>
      <PageHeader
        title={`الطلب #${order.order_number}`}
        subtitle={formatDate(order.created_at)}
        actions={
          <Link to="/orders">
            <Button variant="secondary">← الطلبات</Button>
          </Link>
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
                        <div className="font-semibold">{i.product_name}</div>
                        {i.variant_label && <div className="text-xs text-slate-500">{i.variant_label}</div>}
                      </td>
                      <td className="p-2">{dzd(i.unit_price)}</td>
                      <td className="p-2">{i.quantity}</td>
                      <td className="p-2 font-semibold">{dzd(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-4 space-y-1 border-t border-slate-200 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">المجموع الفرعي</dt>
                <dd>{dzd(order.subtotal)}</dd>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">الخصم</dt>
                  <dd>- {dzd(order.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">التوصيل ({order.delivery_type === 'home' ? 'للمنزل' : 'للمكتب'})</dt>
                <dd>{dzd(order.delivery_fee)}</dd>
              </div>
              <div className="flex justify-between text-base font-bold">
                <dt>الإجمالي (الدفع عند الاستلام)</dt>
                <dd>{dzd(order.total)}</dd>
              </div>
            </dl>
          </Card>

          <Card title="العميل والتوصيل">
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
