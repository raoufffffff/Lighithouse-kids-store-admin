import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Card, PageHeader, PageLoader, inputCls } from '../components/ui'
import { dzd, formatDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import { ORDER_STATUSES, statusMeta } from '../lib/types'
import type { Order, OrderStatus } from '../lib/types'

export default function Orders() {
  const notify = useToast()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [wilayas, setWilayas] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<'all' | OrderStatus>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const [o, w] = await Promise.all([
      supabase.from('lh_orders').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('lh_delivery_rates').select('wilaya_code,wilaya_name'),
    ])
    if (o.error) {
      notify('تعذّر تحميل الطلبات: ' + o.error.message, 'error')
      setOrders([])
      return
    }
    setOrders((o.data ?? []) as Order[])
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
        String(o.order_number).includes(q)
      )
    })
  }, [orders, status, search])

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
          placeholder="بحث بالاسم أو الهاتف أو رقم الطلب…"
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
                  <th className="p-2 font-semibold">العميل</th>
                  <th className="p-2 font-semibold">الولاية</th>
                  <th className="p-2 font-semibold">الإجمالي</th>
                  <th className="p-2 font-semibold">الحالة</th>
                  <th className="p-2 font-semibold">التاريخ</th>
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
                      <div className="font-semibold">{o.customer_name}</div>
                      <div className="text-xs text-slate-500" dir="ltr">
                        {o.customer_phone}
                      </div>
                    </td>
                    <td className="p-2 text-slate-600">
                      {o.wilaya_code ? wilayas[o.wilaya_code] ?? o.wilaya_code : '—'}
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
