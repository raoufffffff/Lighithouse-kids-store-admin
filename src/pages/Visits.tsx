import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Card, PageHeader, PageLoader, inputCls } from '../components/ui'
import { supabase } from '../lib/supabase'

type Row = { product_id: string; product_name: string; day: string; hour: number; visits: number; visitors: number }

const RANGES = [
  { id: 1, label: 'آخر 24 ساعة' },
  { id: 7, label: '7 أيام' },
  { id: 30, label: '30 يوماً' },
  { id: 90, label: '90 يوماً' },
] as const

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`

export default function Visits() {
  const notify = useToast()
  const [days, setDays] = useState<number>(7)
  const [product, setProduct] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    void supabase.from('lh_products').select('id,name').order('name').limit(500).then((r) => setProducts((r.data ?? []) as { id: string; name: string }[]))
  }, [])

  const load = useCallback(async () => {
    setRows(null)
    const to = new Date(Date.now() + 3600_000)
    const from = new Date(Date.now() - days * 86400_000)
    const { data, error } = await supabase.rpc('lh_visits_report', { p_from: from.toISOString(), p_to: to.toISOString(), p_product: product || null })
    if (error) {
      notify(/lh_visits_report|schema cache/i.test(error.message) ? 'طبّق هجرة الزيارات أولاً.' : error.message, 'error')
      return setRows([])
    }
    setRows(((data ?? []) as Row[]).map((r) => ({ ...r, hour: +r.hour, visits: +r.visits, visitors: +r.visitors })))
  }, [days, product, notify])
  useEffect(() => void load(), [load])

  const stats = useMemo(() => {
    const list = rows ?? []
    const byHour = Array.from({ length: 24 }, (_, h) => ({ h, visits: 0, visitors: 0 }))
    const byProduct = new Map<string, { name: string; visits: number; visitors: number }>()
    const byDay = new Map<string, { visits: number; visitors: number }>()
    for (const r of list) {
      byHour[r.hour].visits += r.visits
      byHour[r.hour].visitors += r.visitors
      const p = byProduct.get(r.product_id) ?? { name: r.product_name, visits: 0, visitors: 0 }
      p.visits += r.visits
      p.visitors += r.visitors
      byProduct.set(r.product_id, p)
      const d = byDay.get(r.day) ?? { visits: 0, visitors: 0 }
      d.visits += r.visits
      d.visitors += r.visitors
      byDay.set(r.day, d)
    }
    const total = byHour.reduce((a, x) => a + x.visits, 0)
    const peak = byHour.reduce((a, x) => (x.visits > a.visits ? x : a), byHour[0])
    return {
      byHour,
      total,
      peak,
      max: Math.max(1, ...byHour.map((x) => x.visits)),
      products: [...byProduct.values()].sort((a, b) => b.visits - a.visits),
      days: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)),
    }
  }, [rows])

  return (
    <div>
      <PageHeader title="👀 زيارات صفحات المنتجات" subtitle="كم زائراً دخل كل صفحة منتج، وفي أي ساعة (بتوقيت الجزائر). الزائر نفسه يُحسب مرة واحدة كل 30 دقيقة لكل منتج، ولا تُحسب زيارات المعاينة ولا الروبوتات." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.id} onClick={() => setDays(r.id)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${days === r.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
            {r.label}
          </button>
        ))}
        <select value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls + ' !w-auto mr-auto'}>
          <option value="">كل المنتجات</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!rows ? (
        <PageLoader />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Card><div className="text-xs text-slate-500">إجمالي الزيارات</div><div className="mt-1 text-lg font-bold">{stats.total}</div></Card>
            <Card><div className="text-xs text-slate-500">ساعة الذروة</div><div className="mt-1 text-lg font-bold">{stats.total ? `${hourLabel(stats.peak.h)} (${stats.peak.visits})` : '—'}</div></Card>
            <Card><div className="text-xs text-slate-500">متوسط الزيارات يومياً</div><div className="mt-1 text-lg font-bold">{(stats.total / days).toFixed(1)}</div></Card>
          </div>

          <Card title="الزيارات حسب ساعة اليوم" className="mb-4">
            {stats.total === 0 ? (
              <p className="text-sm text-slate-500">لا زيارات في هذه الفترة بعد. تُسجَّل الزيارات منذ تفعيل التتبع في المتجر.</p>
            ) : (
              <div dir="ltr" className="flex h-44 items-end gap-[3px]">
                {stats.byHour.map((x) => (
                  <div key={x.h} className="flex h-full flex-1 flex-col items-center justify-end" title={`${hourLabel(x.h)} — ${x.visits} زيارة، ${x.visitors} زائر`}>
                    <span className="mb-0.5 text-[9px] text-slate-500">{x.visits || ''}</span>
                    <div className={`w-full rounded-t ${x.h === stats.peak.h ? 'bg-sun-400' : 'bg-brand-600'}`} style={{ height: `${(x.visits / stats.max) * 100}%`, minHeight: x.visits ? 3 : 0 }} />
                    <span className="mt-1 text-[9px] text-slate-500">{x.h % 3 === 0 ? x.h : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="حسب المنتج">
              {stats.products.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
                <table className="w-full text-sm">
                  <tbody>
                    {stats.products.map((p) => (
                      <tr key={p.name} className="border-t border-slate-100 first:border-0">
                        <td className="p-2 font-semibold">{p.name}</td>
                        <td className="p-2 text-center">{p.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="حسب اليوم">
              {stats.days.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
                <table className="w-full text-sm">
                  <tbody>
                    {stats.days.slice(0, 31).map(([d, v]) => (
                      <tr key={d} className="border-t border-slate-100 first:border-0">
                        <td className="p-2" dir="ltr">{d}</td>
                        <td className="p-2 text-center">{v.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
