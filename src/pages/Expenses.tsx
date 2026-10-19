import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, inputCls } from '../components/ui'
import { dzd } from '../lib/format'
import { supabase } from '../lib/supabase'

type Expense = { id: string; expense_date: string; category: string; amount: number; note: string | null }

export const CATEGORIES: Record<string, string> = {
  ads: '📣 إعلانات',
  packaging: '📦 تغليف',
  salaries: '👤 رواتب',
  other: '🧾 أخرى',
}

const RANGES = [
  { id: 1, label: 'اليوم' },
  { id: 7, label: '7 أيام' },
  { id: 30, label: '30 يوماً' },
  { id: 90, label: '90 يوماً' },
  { id: 3650, label: 'الكل' },
] as const

const today = () => new Date().toISOString().slice(0, 10)
const sinceDate = (days: number) => new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10)

export default function Expenses() {
  const notify = useToast()
  const [days, setDays] = useState<number>(30)
  const [rows, setRows] = useState<Expense[] | null>(null)
  const [stockSpend, setStockSpend] = useState(0)
  const [date, setDate] = useState(today())
  const [category, setCategory] = useState('ads')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const from = sinceDate(days)
    const [e, s] = await Promise.all([
      supabase.from('lh_expenses').select('id,expense_date,category,amount,note').gte('expense_date', from).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
      supabase.from('lh_stock_purchases').select('quantity,unit_cost').gte('purchased_at', from).limit(5000),
    ])
    if (e.error) {
      notify(e.error.message, 'error')
      return setRows([])
    }
    setRows((e.data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as Expense[])
    setStockSpend((s.data ?? []).reduce((a, r) => a + Number(r.quantity) * Number(r.unit_cost), 0))
  }, [days, notify])
  useEffect(() => void load(), [load])

  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const r of rows ?? []) t[r.category] = (t[r.category] ?? 0) + r.amount
    return t
  }, [rows])

  const add = async () => {
    const n = Number(amount)
    if (!(n > 0)) return notify('أدخل مبلغاً صحيحاً.', 'error')
    setSaving(true)
    const { error } = await supabase.from('lh_expenses').insert({ expense_date: date, category, amount: n, note: note.trim() || null })
    setSaving(false)
    if (error) return notify(error.message, 'error')
    setAmount('')
    setNote('')
    notify('تمت إضافة التكلفة.', 'success')
    void load()
  }

  const remove = async (id: string) => {
    if (!confirm('حذف هذه التكلفة؟')) return
    const { error } = await supabase.from('lh_expenses').delete().eq('id', id)
    if (error) return notify(error.message, 'error')
    setRows((r) => (r ?? []).filter((x) => x.id !== id))
  }

  if (!rows) return <PageLoader />
  const total = rows.reduce((a, r) => a + r.amount, 0)

  return (
    <div>
      <PageHeader title="🧾 التكاليف" subtitle="سجّل مصاريفك كل يوم (إعلانات، تغليف، رواتب...). تُخصم كلها من الربح الصافي في صفحة «الربح». شراء المخزون يُسجَّل من صفحة «المخزون»." />

      <Card title="إضافة تكلفة" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="التاريخ"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
          <Field label="النوع">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="المبلغ (د.ج)"><input type="number" min={0} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="مثال: 2000" /></Field>
          <Field label="ملاحظة (اختياري)" className="lg:col-span-2"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="مثال: زيادة ميزانية فيسبوك" /></Field>
        </div>
        <div className="mt-3"><Button onClick={add} loading={saving}>➕ إضافة</Button></div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button key={r.id} onClick={() => setDays(r.id)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${days === r.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{r.label}</button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><div className="text-xs text-slate-500">إجمالي التكاليف</div><div className="mt-1 text-lg font-bold text-rose-600">{dzd(total)}</div></Card>
        {Object.entries(CATEGORIES).filter(([k]) => totals[k]).map(([k, v]) => (
          <Card key={k}><div className="text-xs text-slate-500">{v}</div><div className="mt-1 text-lg font-bold">{dzd(totals[k])}</div></Card>
        ))}
      </div>
      {stockSpend > 0 && (
        <p className="mb-4 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
          📦 اشتريتَ مخزوناً بقيمة <b>{dzd(stockSpend)}</b> في هذه الفترة. هو خروج نقدي لكنه لا يُخصم من الربح الآن، لأن تكلفة القطعة تُحتسب عند بيعها.
        </p>
      )}

      <Card title="السجل">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">لا تكاليف في هذه الفترة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="text-xs text-slate-500"><th className="p-2 text-start">التاريخ</th><th className="p-2 text-start">النوع</th><th className="p-2 text-start">المبلغ</th><th className="p-2 text-start">ملاحظة</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-2 whitespace-nowrap">{r.expense_date}</td>
                    <td className="p-2 whitespace-nowrap">{CATEGORIES[r.category] ?? r.category}</td>
                    <td className="p-2 font-bold">{dzd(r.amount)}</td>
                    <td className="p-2 text-slate-500">{r.note}</td>
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
