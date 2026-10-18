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
  const net = sum('profit') - adSpend
  const hasMissing = rows.some((r) => r.missing_cost)
  const closed = sum('returned') + sum('delivered')
  const returnRate = closed ? (sum('returned') / closed) * 100 : null

  return (
    <div>
      <PageHeader title="💰 الربح الحقيقي" subtitle="الإيراد ناقص تكلفة المنتج، بدون الطلبات الملغاة والمرجعة وغير المردودة. التوصيل يُعدّ مُحمَّلاً على الزبون." />
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
          ['الربح قبل الإعلانات', dzd(sum('profit'))],
          [adSpend ? 'الربح الصافي' : 'الطلبات', adSpend ? dzd(net) : String(sum('orders'))],
        ].map(([l, v], i) => (
          <Card key={l}>
            <div className="text-xs text-slate-500">{l}</div>
            <div className={`mt-1 text-lg font-bold ${i === 3 && adSpend && net < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{v}</div>
          </Card>
        ))}
      </div>
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
