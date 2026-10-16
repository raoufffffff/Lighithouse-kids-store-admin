import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Button, Card, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { refreshStore } from '../lib/store'
import { supabase } from '../lib/supabase'
import type { DeliveryRate } from '../lib/types'

type Row = { wilaya_code: number; wilaya_name: string; home_fee: string; desk_fee: string; is_active: boolean }

const toRow = (r: DeliveryRate): Row => ({
  wilaya_code: r.wilaya_code,
  wilaya_name: r.wilaya_name,
  home_fee: String(r.home_fee),
  desk_fee: String(r.desk_fee),
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
    const { data, error } = await supabase.from('lh_delivery_rates').select('*').order('wilaya_code')
    if (error) {
      notify('تعذّر تحميل الأسعار: ' + error.message, 'error')
      setRows([])
      return
    }
    const list = ((data ?? []) as DeliveryRate[]).map(toRow)
    setRows(list)
    setOriginal(Object.fromEntries(list.map((r) => [r.wilaya_code, r])))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDirty = (r: Row) => {
    const o = original[r.wilaya_code]
    return !o || o.home_fee !== r.home_fee || o.desk_fee !== r.desk_fee || o.is_active !== r.is_active
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
    }
    if (payload.length === 0) return
    setSaving(true)
    const { error } = await supabase.from('lh_delivery_rates').upsert(payload, { onConflict: 'wilaya_code' })
    setSaving(false)
    if (error) {
      notify('فشل الحفظ: ' + error.message, 'error')
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
        subtitle="سعر التوصيل لكل ولاية: للمنزل وللمكتب. عطّل الولاية إن كنت لا توصّل إليها."
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
                <th className="p-2 font-semibold">للمنزل (د.ج)</th>
                <th className="p-2 font-semibold">للمكتب (د.ج)</th>
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
                  <td className="p-2">
                    <input
                      type="number"
                      min="0"
                      className={`${inputCls} w-28`}
                      value={r.home_fee}
                      onChange={(e) => update(r.wilaya_code, { home_fee: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      min="0"
                      className={`${inputCls} w-28`}
                      value={r.desk_fee}
                      onChange={(e) => update(r.wilaya_code, { desk_fee: e.target.value })}
                    />
                  </td>
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
