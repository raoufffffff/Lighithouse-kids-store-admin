import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { Card, PageHeader, PageLoader } from '../components/ui'
import { dzd, formatDate } from '../lib/format'
import { supabase } from '../lib/supabase'

type Row = {
  id: string
  customer_name: string
  customer_phone: string
  wilaya_code: number
  commune: string
  delivery_type: string
  qty: number
  product_name: string
  variant_label: string | null
  amount: number
  status: 'open' | 'contacted' | 'dismissed'
  note: string | null
  created_at: string
  updated_at: string
  in_progress: boolean
}

const intl = (p: string) => '213' + p.replace(/^0/, '')

export default function Abandoned() {
  const notify = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [wilayas, setWilayas] = useState<Record<number, string>>({})
  const [show, setShow] = useState<'open' | 'contacted' | 'dismissed'>('open')

  const load = useCallback(async () => {
    const [r, w] = await Promise.all([
      supabase.rpc('lh_abandoned_list'),
      supabase.from('lh_delivery_rates').select('wilaya_code,wilaya_name'),
    ])
    if (r.error) {
      notify(/lh_abandoned_list|schema cache/i.test(r.error.message) ? 'طبّق هجرة الطلبات المتروكة أولاً.' : r.error.message, 'error')
      return setRows([])
    }
    setRows(((r.data ?? []) as Row[]).map((x) => ({ ...x, amount: Number(x.amount) })))
    setWilayas(Object.fromEntries((w.data ?? []).map((x: { wilaya_code: number; wilaya_name: string }) => [x.wilaya_code, x.wilaya_name])))
  }, [notify])
  useEffect(() => void load(), [load])

  const setStatus = async (id: string, status: Row['status']) => {
    const { error } = await supabase.from('lh_abandoned_carts').update({ status }).eq('id', id)
    if (error) return notify('فشل الحفظ: ' + error.message, 'error')
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, status } : r)) ?? null)
  }
  const saveNote = async (id: string, note: string) => {
    await supabase.from('lh_abandoned_carts').update({ note: note.trim() || null }).eq('id', id)
  }

  if (!rows) return <PageLoader />
  const list = rows.filter((r) => r.status === show)
  const lost = rows.filter((r) => r.status === 'open').reduce((a, r) => a + r.amount, 0)
  const count = (s: Row['status']) => rows.filter((r) => r.status === s).length

  return (
    <div>
      <PageHeader
        title="🛒 الطلبات المتروكة"
        subtitle="زبائن أدخلوا الاسم والهاتف والولاية والبلدية ولم يُكملوا الطلب. اتصل بهم قبل أن يبردوا."
      />
      <Card className="mb-4">
        <div className="text-sm text-slate-600">قيمة السلات المفتوحة: <b className="text-slate-900">{dzd(lost)}</b></div>
      </Card>
      <div className="mb-4 flex gap-2">
        {([['open', 'جديدة'], ['contacted', 'تم الاتصال'], ['dismissed', 'مستبعدة']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setShow(k)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${show === k ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
          >
            {l} ({count(k)})
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {list.length === 0 && <p className="text-sm text-slate-500">لا توجد سلات هنا.</p>}
        {list.map((r) => {
          const msg = encodeURIComponent(`مرحباً ${r.customer_name}، معك لايتهاوس كيدز. لاحظنا أنك اخترت «${r.product_name}» ولم يكتمل طلبك. هل تريد تأكيده؟`)
          return (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-slate-800">
                  {r.customer_name} {r.in_progress && <span className="mr-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">لا يزال يملأ…</span>}
                </div>
                <div className="text-sm font-bold text-brand-700">{dzd(r.amount)}</div>
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {r.product_name}{r.variant_label ? ` — ${r.variant_label}` : ''} × {r.qty}
              </div>
              <div className="text-xs text-slate-500">
                {wilayas[r.wilaya_code] ?? r.wilaya_code} · {r.commune} · {r.delivery_type === 'home' ? 'للمنزل' : 'للمكتب'} · {formatDate(r.updated_at)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={`tel:${r.customer_phone}`} dir="ltr" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">📞 {r.customer_phone}</a>
                <a href={`https://wa.me/${intl(r.customer_phone)}?text=${msg}`} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">واتساب</a>
                {r.status !== 'contacted' && <button onClick={() => setStatus(r.id, 'contacted')} className="text-xs font-bold text-brand-600">تم الاتصال</button>}
                {r.status !== 'dismissed' && <button onClick={() => setStatus(r.id, 'dismissed')} className="text-xs font-bold text-slate-500">استبعاد</button>}
                {r.status !== 'open' && <button onClick={() => setStatus(r.id, 'open')} className="text-xs font-bold text-slate-500">إعادة للجديدة</button>}
              </div>
              <input
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                placeholder="ملاحظة (مثل: لم يرد، سيعاود الاتصال غداً)"
                defaultValue={r.note ?? ''}
                onBlur={(e) => saveNote(r.id, e.target.value)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
