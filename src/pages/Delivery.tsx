import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Button, Card, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { refreshStore } from '../lib/store'
import { supabase } from '../lib/supabase'
import type { DeliveryRate } from '../lib/types'

type Row = {
  wilaya_code: number
  wilaya_name: string
  home_fee: string
  desk_fee: string
  home_cost: string // real courier tariff (private)
  desk_cost: string
  is_active: boolean
}

const toRow = (r: DeliveryRate, c?: { home_cost: number; desk_cost: number }): Row => ({
  wilaya_code: r.wilaya_code,
  wilaya_name: r.wilaya_name,
  home_fee: String(r.home_fee),
  desk_fee: String(r.desk_fee),
  home_cost: c ? String(c.home_cost) : '',
  desk_cost: c ? String(c.desk_cost) : '',
  is_active: r.is_active,
})

export default function Delivery() {
  const notify = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [original, setOriginal] = useState<Record<number, Row>>({})
  const [saving, setSaving] = useState(false)
  const [bulkHome, setBulkHome] = useState('')
  const [bulkDesk, setBulkDesk] = useState('')

  const load = async () => {
    const [{ data, error }, costs] = await Promise.all([
      supabase.from('lh_delivery_rates').select('*').order('wilaya_code'),
      supabase.from('lh_delivery_costs').select('wilaya_code,home_cost,desk_cost'),
    ])
    if (error) {
      notify('تعذّر تحميل الأسعار: ' + error.message, 'error')
      setRows([])
      return
    }
    const cmap = new Map((costs.data ?? []).map((c) => [c.wilaya_code as number, { home_cost: Number(c.home_cost), desk_cost: Number(c.desk_cost) }]))
    const list = ((data ?? []) as DeliveryRate[]).map((r) => toRow(r, cmap.get(r.wilaya_code)))
    setRows(list)
    setOriginal(Object.fromEntries(list.map((r) => [r.wilaya_code, r])))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDirty = (r: Row) => {
    const o = original[r.wilaya_code]
    return !o || o.home_fee !== r.home_fee || o.desk_fee !== r.desk_fee || o.home_cost !== r.home_cost || o.desk_cost !== r.desk_cost || o.is_active !== r.is_active
  }
  const dirty = useMemo(() => (rows ?? []).filter(isDirty), [rows, original]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (code: number, patch: Partial<Row>) =>
    setRows((prev) => prev?.map((r) => (r.wilaya_code === code ? { ...r, ...patch } : r)) ?? prev)

  const applyBulk = () => {
    if (bulkHome === '' && bulkDesk === '') return
    setRows(
      (prev) =>
        prev?.map((r) => ({
          ...r,
          home_fee: bulkHome !== '' ? bulkHome : r.home_fee,
          desk_fee: bulkDesk !== '' ? bulkDesk : r.desk_fee,
        })) ?? prev,
    )
  }

  const save = async () => {
    const payload = []
    const costPayload = []
    for (const r of dirty) {
      const home = Number(r.home_fee)
      const desk = Number(r.desk_fee)
      if (!Number.isFinite(home) || !Number.isFinite(desk) || home < 0 || desk < 0 || r.home_fee === '' || r.desk_fee === '') {
        notify(`سعر غير صحيح في ولاية ${r.wilaya_name}`, 'error')
        return
      }
      payload.push({
        wilaya_code: r.wilaya_code,
        wilaya_name: r.wilaya_name,
        home_fee: home,
        desk_fee: desk,
        is_active: r.is_active,
      })
      if (r.home_cost !== '' || r.desk_cost !== '') {
        const hc = Number(r.home_cost || 0)
        const dc = Number(r.desk_cost || 0)
        if (!Number.isFinite(hc) || !Number.isFinite(dc) || hc < 0 || dc < 0) {
          notify(`تكلفة غير صحيحة في ولاية ${r.wilaya_name}`, 'error')
          return
        }
        costPayload.push({ wilaya_code: r.wilaya_code, home_cost: hc, desk_cost: dc })
      }
    }
    if (payload.length === 0) return
    setSaving(true)
    const { error } = await supabase.from('lh_delivery_rates').upsert(payload, { onConflict: 'wilaya_code' })
    const costErr = error || costPayload.length === 0 ? null : (await supabase.from('lh_delivery_costs').upsert(costPayload, { onConflict: 'wilaya_code' })).error
    setSaving(false)
    if (error || costErr) {
      notify('فشل الحفظ: ' + (error ?? costErr)!.message, 'error')
      return
    }
    notify(`تم حفظ ${payload.length} ولاية`)
    void refreshStore()
    await load()
  }

  if (!rows) return <PageLoader />

  return (
    <>
      <PageHeader
        title="أسعار التوصيل"
        subtitle="سعر الموقع هو ما يدفعه الزبون، وتعرض «تكلفة الشركة» ما تدفعه أنت فعلاً لشركة التوصيل (خاصة بك ولا تظهر للزبائن). الفرق يدخل في تقرير الربح."
        actions={
          <Button onClick={save} loading={saving} disabled={dirty.length === 0}>
            حفظ التغييرات {dirty.length > 0 && `(${dirty.length})`}
          </Button>
        }
      />

      <Card className="mb-6">
        <p className="mb-3 text-sm font-semibold text-slate-700">تطبيق سعر موحّد على كل الولايات</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">للمنزل (د.ج)</span>
            <input type="number" min="0" className={`${inputCls} w-36`} value={bulkHome} onChange={(e) => setBulkHome(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">للمكتب (د.ج)</span>
            <input type="number" min="0" className={`${inputCls} w-36`} value={bulkDesk} onChange={(e) => setBulkDesk(e.target.value)} />
          </label>
          <Button variant="secondary" onClick={applyBulk}>
            تطبيق على الكل
          </Button>
          <span className="text-xs text-slate-500">لا يُحفظ شيء حتى تضغط «حفظ التغييرات».</span>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                <th className="p-2 font-semibold">#</th>
                <th className="p-2 font-semibold">الولاية</th>
                <th className="p-2 font-semibold">منزل — الموقع</th>
                <th className="p-2 font-semibold">منزل — الشركة</th>
                <th className="p-2 font-semibold">مكتب — الموقع</th>
                <th className="p-2 font-semibold">مكتب — الشركة</th>
                <th className="p-2 font-semibold">مفعّلة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.wilaya_code}
                  className={`border-b border-slate-100 last:border-0 ${isDirty(r) ? 'bg-amber-50' : ''}`}
                >
                  <td className="p-2 text-slate-400">{r.wilaya_code}</td>
                  <td className="p-2 font-semibold">{r.wilaya_name}</td>
                  {(
                    [
                      ['home_fee', 'home_cost'],
                      ['desk_fee', 'desk_cost'],
                    ] as const
                  ).map(([fk, ck]) => {
                    const gap = r[ck] !== '' ? Number(r[fk]) - Number(r[ck]) : null
                    return [
                      <td key={fk} className="p-2">
                        <input type="number" min="0" className={`${inputCls} w-24`} value={r[fk]} onChange={(e) => update(r.wilaya_code, { [fk]: e.target.value } as Partial<Row>)} />
                      </td>,
                      <td key={ck} className="p-2">
                        <input type="number" min="0" className={`${inputCls} w-24`} value={r[ck]} onChange={(e) => update(r.wilaya_code, { [ck]: e.target.value } as Partial<Row>)} />
                        {gap != null && gap !== 0 && (
                          <div className={`mt-0.5 text-[11px] font-bold ${gap < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {gap < 0 ? `تدعم ${-gap}` : `+${gap}`}
                          </div>
                        )}
                      </td>,
                    ]
                  })}
                  <td className="p-2">
                    <Toggle checked={r.is_active} onChange={(v) => update(r.wilaya_code, { is_active: v })} label="مفعّلة" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
