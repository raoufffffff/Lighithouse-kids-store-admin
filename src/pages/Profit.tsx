import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { Card, PageHeader, PageLoader } from '../components/ui'
import { dzd } from '../lib/format'
import { supabase } from '../lib/supabase'

type Row = {
  product_id: string
  product_name: string
  orders: number
  units: number
  revenue: number
  cost: number
  profit: number
  delivered: number
  returned: number
  cancelled: number
  missing_cost: boolean
}

const RANGES = [
  { id: 7, label: '7 أيام' },
  { id: 30, label: '30 يوماً' },
  { id: 90, label: '90 يوماً' },
  { id: 3650, label: 'الكل' },
] as const

export default function Profit() {
  const notify = useToast()
  const [days, setDays] = useState<number>(30)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [ship, setShip] = useState<{ charged: number; real: number; missing: number; orders: number } | null>(null)
  const [ads, setAds] = useState(() => {
    try {
      return localStorage.getItem('lh_ad_spend') ?? ''
    } catch {
      return ''
    }
  })

  const load = useCallback(async () => {
    setRows(null)
    const to = new Date(Date.now() + 86400_000)
    const from = new Date(Date.now() - days * 86400_000)
    // Delivery: what customers paid vs what the courier really charges (private tariff table).
    const [ordersRes, costsRes] = await Promise.all([
      supabase
        .from('lh_orders')
        .select('delivery_fee,wilaya_code,delivery_type,status')
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString())
        .not('status', 'in', '(cancelled,returned,unreachable)')
        .limit(5000),
      supabase.from('lh_delivery_costs').select('wilaya_code,home_cost,desk_cost'),
    ])
    const cmap = new Map((costsRes.data ?? []).map((c) => [c.wilaya_code as number, c]))
    let charged = 0
    let real = 0
    let missing = 0
    for (const o of ordersRes.data ?? []) {
      charged += Number(o.delivery_fee)
      const c = o.wilaya_code ? cmap.get(o.wilaya_code as number) : undefined
      if (c) real += Number(o.delivery_type === 'home' ? c.home_cost : c.desk_cost)
      else {
        real += Number(o.delivery_fee) // unknown tariff: assume break-even
        missing++
      }
    }
    setShip({ charged, real, missing, orders: (ordersRes.data ?? []).length })
    const { data, error } = await supabase.rpc('lh_profit_report', { p_from: from.toISOString(), p_to: to.toISOString() })
    if (error) {
      notify(/lh_profit_report|schema cache/i.test(error.message) ? 'طبّق هجرة تقرير الربح أولاً.' : error.message, 'error')
      return setRows([])
    }
    setRows(((data ?? []) as Row[]).map((r) => ({ ...r, orders: +r.orders, units: +r.units, revenue: +r.revenue, cost: +r.cost, profit: +r.profit, delivered: +r.delivered, returned: +r.returned, cancelled: +r.cancelled })))
  }, [days, notify])
  useEffect(() => void load(), [load])

  const setAdSpend = (v: string) => {
    setAds(v)
    try {
      localStorage.setItem('lh_ad_spend', v)
    } catch {
      /* ignore */
    }
  }

  if (!rows) return <PageLoader />
  const sum = (k: 'orders' | 'revenue' | 'cost' | 'profit' | 'returned' | 'delivered') => rows.reduce((a, r) => a + r[k], 0)
  const adSpend = Number(ads) || 0
  const shipGap = ship ? ship.charged - ship.real : 0
  const profitAll = sum('profit') + shipGap
  const net = profitAll - adSpend
  const hasMissing = rows.some((r) => r.missing_cost)
  const closed = sum('returned') + sum('delivered')
  const returnRate = closed ? (sum('returned') / closed) * 100 : null

  return (
    <div>
      <PageHeader title="💰 الربح الحقيقي" subtitle="الإيراد ناقص تكلفة المنتج، مع فرق التوصيل (ما دفعه الزبون ناقص ما تدفعه لشركة التوصيل)، بدون الطلبات الملغاة والمرجعة وغير المردودة. تكلفة شحن المرجعات لا تُحتسب." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.id} onClick={() => setDays(r.id)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${days === r.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
            {r.label}
          </button>
        ))}
        <label className="mr-auto flex items-center gap-2 text-xs font-bold text-slate-600">
          مصاريف الإعلانات (د.ج)
          <input type="number" min={0} value={ads} onChange={(e) => setAdSpend(e.target.value)} className="w-32 rounded-lg border border-slate-300 px-2 py-1.5" />
        </label>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['الإيراد', dzd(sum('revenue'))],
          ['التكلفة', dzd(sum('cost'))],
          ['الربح قبل الإعلانات', dzd(profitAll)],
          [adSpend ? 'الربح الصافي' : 'الطلبات', adSpend ? dzd(net) : String(sum('orders'))],
        ].map(([l, v], i) => (
          <Card key={l}>
            <div className="text-xs text-slate-500">{l}</div>
            <div className={`mt-1 text-lg font-bold ${i === 3 && adSpend && net < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{v}</div>
          </Card>
        ))}
      </div>
      {ship && (
        <Card className="mb-4">
          <div className="text-xs font-bold text-slate-500">🚚 التوصيل ({ship.orders} طلب)</div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>المحصّل من الزبائن: <b>{dzd(ship.charged)}</b></span>
            <span>تكلفة شركة التوصيل: <b>{dzd(ship.real)}</b></span>
            <span className={shipGap < 0 ? 'font-bold text-rose-600' : 'font-bold text-emerald-700'}>
              {shipGap < 0 ? 'ما تتحمله من جيبك: ' : 'الفرق لصالحك: '}
              {dzd(Math.abs(shipGap))}
            </span>
          </div>
          {ship.missing > 0 && <p className="mt-2 text-xs text-amber-800">{ship.missing} طلب بولاية بلا تكلفة شركة مسجّلة، حُسب توصيلها بلا فرق. أضفها من صفحة «أسعار التوصيل».</p>}
        </Card>
      )}
      {returnRate != null && <p className="mb-3 text-xs text-slate-500">نسبة الإرجاع بين الطلبات المنتهية: <b>{returnRate.toFixed(0)}%</b></p>}
      {hasMissing && <p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">بعض المنتجات بلا سعر تكلفة فيُحسب ربحها كإيراد كامل. أضف التكلفة من صفحة المنتج لتصحيح الأرقام.</p>}

      <Card title="حسب المنتج">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">لا طلبات في هذه الفترة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="p-2 text-start">المنتج</th><th className="p-2">طلبات</th><th className="p-2">إيراد</th><th className="p-2">ربح</th><th className="p-2">هامش</th><th className="p-2">مرجع/ملغى</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product_id} className="border-t border-slate-100 text-center">
                    <td className="p-2 text-start font-semibold">{r.product_name}{r.missing_cost && ' ⚠️'}</td>
                    <td className="p-2">{r.orders}</td>
                    <td className="p-2">{dzd(r.revenue)}</td>
                    <td className={`p-2 font-bold ${r.profit < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{dzd(r.profit)}</td>
                    <td className="p-2">{r.revenue ? ((r.profit / r.revenue) * 100).toFixed(0) + '%' : '—'}</td>
                    <td className="p-2">{r.returned}/{r.cancelled}</td>
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
