import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Card, PageHeader, PageLoader, inputCls } from '../components/ui'
import { dzd, formatDate } from '../lib/format'
import { assetUrl } from '../lib/store'
import { supabase } from '../lib/supabase'
import { ORDER_STATUSES, statusMeta } from '../lib/types'
import type { Order, OrderStatus } from '../lib/types'

type ListItem = { product_id: string | null; product_name: string; variant_label: string | null; quantity: number }
type OrderRow = Order & { lh_order_items: ListItem[] }

export default function Orders() {
  const notify = useToast()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<OrderRow[] | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const [wilayas, setWilayas] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<'all' | OrderStatus>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const [o, w, pr] = await Promise.all([
      supabase
        .from('lh_orders')
        .select('*, lh_order_items(product_id,product_name,variant_label,quantity)')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('lh_delivery_rates').select('wilaya_code,wilaya_name'),
      supabase.from('lh_products').select('id,images'),
    ])
    if (o.error) {
      notify('تعذّر تحميل الطلبات: ' + o.error.message, 'error')
      setOrders([])
      return
    }
    setOrders((o.data ?? []) as OrderRow[])
    setImages(Object.fromEntries((pr.data ?? []).map((x) => [x.id as string, ((x.images as string[] | null) ?? [])[0] ?? ''])))
    setWilayas(
      Object.fromEntries((w.data ?? []).map((r) => [r.wilaya_code as number, r.wilaya_name as string])),
    )
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders?.length ?? 0 }
    for (const o of orders ?? []) c[o.status] = (c[o.status] ?? 0) + 1
    return c
  }, [orders])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (orders ?? []).filter((o) => {
      if (status !== 'all' && o.status !== status) return false
      if (!q) return true
      return (
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.includes(q) ||
        o.lh_order_items.some((i) => i.product_name.toLowerCase().includes(q)) ||
        (o.commune ?? '').toLowerCase().includes(q) ||
        String(o.order_number).includes(q)
      )
    })
  }, [orders, status, search])

  const remove = async (order: OrderRow) => {
    if (!confirm(`حذف الطلب #${order.order_number} نهائياً؟ لا يمكن التراجع.${['confirmed', 'shipped', 'delivered'].includes(order.status) ? '\nسيُعاد المخزون تلقائياً.' : ''}`)) return
    // Cancelling first puts the reserved stock back (DB trigger), then the row is removed.
    if (!['cancelled', 'returned'].includes(order.status)) {
      const r = await supabase.from('lh_orders').update({ status: 'cancelled' }).eq('id', order.id)
      if (r.error) return notify('فشل الحذف: ' + r.error.message, 'error')
    }
    const { error } = await supabase.from('lh_orders').delete().eq('id', order.id)
    if (error) return notify('فشل الحذف: ' + error.message, 'error')
    setOrders((list) => list?.filter((o) => o.id !== order.id) ?? list)
    notify('تم حذف الطلب')
  }

  const changeStatus = async (order: Order, next: OrderStatus) => {
    const prev = order.status
    setOrders((list) => list?.map((o) => (o.id === order.id ? { ...o, status: next } : o)) ?? list)
    const { error } = await supabase.from('lh_orders').update({ status: next }).eq('id', order.id)
    if (error) {
      notify('فشل تغيير الحالة: ' + error.message, 'error')
      setOrders((list) => list?.map((o) => (o.id === order.id ? { ...o, status: prev } : o)) ?? list)
    }
  }

  return (
    <>
      <PageHeader title="الطلبات" subtitle={orders ? `${orders.length} طلب` : undefined} />

      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          {[{ value: 'all', label: 'الكل' }, ...ORDER_STATUSES].map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value as typeof status)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                status === s.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s.label} ({counts[s.value] ?? 0})
            </button>
          ))}
        </div>
        <input
          className={`${inputCls} mb-4 max-w-xs`}
          placeholder="بحث بالاسم أو الهاتف أو المنتج أو البلدية أو رقم الطلب…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {!orders ? (
          <PageLoader />
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">لا توجد طلبات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                  <th className="p-2 font-semibold">#</th>
                  <th className="p-2 font-semibold">المنتج</th>
                  <th className="p-2 font-semibold">العميل</th>
                  <th className="p-2 font-semibold">الولاية / البلدية</th>
                  <th className="p-2 font-semibold">الإجمالي</th>
                  <th className="p-2 font-semibold">الحالة</th>
                  <th className="p-2 font-semibold">التاريخ</th>
                  <th className="p-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="p-2 font-bold">
                      <Link to={`/orders/${o.id}`} className="text-brand-600 hover:underline">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1.5">
                        {o.lh_order_items.slice(0, 2).map((i, k) => {
                          const img = i.product_id ? images[i.product_id] : ''
                          return (
                            <div key={k} className="flex items-center gap-2">
                              {img ? (
                                <img src={assetUrl(img)} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover" />
                              ) : (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg">🧸</div>
                              )}
                              <div className="min-w-0">
                                <div className="max-w-[180px] truncate text-xs font-semibold text-slate-800">{i.product_name}</div>
                                <div className="text-[11px] text-slate-500">
                                  × {i.quantity}
                                  {i.variant_label ? ` · ${i.variant_label}` : ''}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        {o.lh_order_items.length > 2 && <div className="text-[11px] text-slate-500">+{o.lh_order_items.length - 2} منتجات أخرى</div>}
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="font-semibold">{o.customer_name}</div>
                      <div className="text-xs text-slate-500" dir="ltr">
                        {o.customer_phone}
                      </div>
                    </td>
                    <td className="p-2 text-slate-600">
                      <div className="font-semibold text-slate-700">
                        {o.wilaya_code ? wilayas[o.wilaya_code] ?? o.wilaya_code : '—'}
                      </div>
                      <div className="text-xs text-slate-600">{o.commune || '—'}</div>
                      <div className="text-xs text-slate-400">
                        {o.delivery_type === 'home' ? 'للمنزل' : 'للمكتب'}
                      </div>
                    </td>
                    <td className="p-2 font-semibold">{dzd(o.total)}</td>
                    <td className="p-2">
                      <select
                        value={o.status}
                        onChange={(e) => changeStatus(o, e.target.value as OrderStatus)}
                        className={`rounded-full border-0 px-3 py-1 text-xs font-bold ${statusMeta(o.status).badge}`}
                      >
                        {ORDER_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-xs text-slate-500">{formatDate(o.created_at)}</td>
                    <td className="whitespace-nowrap p-2">
                      <button onClick={() => navigate(`/orders/${o.id}?edit=1`)} className="rounded-lg px-2 py-1 text-xs font-bold text-brand-600 hover:bg-brand-50">
                        ✏️ تعديل
                      </button>
                      <button onClick={() => remove(o)} className="rounded-lg px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50">
                        🗑 حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
