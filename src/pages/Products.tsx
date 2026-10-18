import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Button, Card, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { dzd } from '../lib/format'
import { assetUrl, refreshStore } from '../lib/store'
import { supabase } from '../lib/supabase'

type Row = {
  id: string
  name: string
  base_price: number
  images: string[]
  is_active: boolean
  is_featured: boolean
  category: { name: string } | null
  variants: { stock_quantity: number }[]
}

export default function Products() {
  const notify = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'hidden'>('all')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('lh_products')
      .select(
        'id,name,base_price,images,is_active,is_featured,category:lh_categories(name),variants:lh_product_variants(stock_quantity)',
      )
      .order('created_at', { ascending: false })
    if (error) {
      notify('تعذّر تحميل المنتجات: ' + error.message, 'error')
      setRows([])
      return
    }
    setRows((data ?? []) as unknown as Row[])
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => {
    if (!rows) return []
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'active' && !r.is_active) return false
      if (filter === 'hidden' && r.is_active) return false
      return !q || r.name.toLowerCase().includes(q)
    })
  }, [rows, search, filter])

  const toggleActive = async (row: Row, value: boolean) => {
    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, is_active: value } : r)) ?? prev)
    const { error } = await supabase.from('lh_products').update({ is_active: value }).eq('id', row.id)
    if (error) {
      notify('فشل التحديث: ' + error.message, 'error')
      load()
      return
    }
    void refreshStore()
  }

  const remove = async (row: Row) => {
    if (!confirm(`حذف المنتج «${row.name}» نهائياً؟ لا يمكن التراجع.`)) return
    const { error } = await supabase.from('lh_products').delete().eq('id', row.id)
    if (error) {
      notify('فشل الحذف: ' + error.message, 'error')
      return
    }
    notify('تم حذف المنتج')
    void refreshStore()
    setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? prev)
  }

  return (
    <>
      <PageHeader
        title="المنتجات"
        subtitle={rows ? `${rows.length} منتج` : undefined}
        actions={
          <Link to="/products/new">
            <Button>+ منتج جديد</Button>
          </Link>
        }
      />

      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            className={`${inputCls} max-w-xs`}
            placeholder="بحث باسم المنتج…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={`${inputCls} max-w-[10rem]`}
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="all">الكل</option>
            <option value="active">المعروضة</option>
            <option value="hidden">المخفية</option>
          </select>
        </div>

        {!rows ? (
          <PageLoader />
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">لا توجد منتجات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                  <th className="p-2 font-semibold">المنتج</th>
                  <th className="p-2 font-semibold">الفئة</th>
                  <th className="p-2 font-semibold">السعر</th>
                  <th className="p-2 font-semibold">المخزون</th>
                  <th className="p-2 font-semibold">معروض</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const stock = r.variants.reduce((s, v) => s + v.stock_quantity, 0)
                  return (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2">
                        <Link to={`/products/${r.id}`} className="flex items-center gap-3">
                          {r.images[0] ? (
                            <img
                              src={assetUrl(r.images[0])}
                              alt=""
                              className="h-12 w-12 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-xl">
                              🧸
                            </div>
                          )}
                          <span className="font-semibold text-slate-800 hover:text-brand-600">
                            {r.name}
                            {r.is_featured && <span className="mr-2 text-xs text-amber-600">★ مميز</span>}
                          </span>
                        </Link>
                      </td>
                      <td className="p-2 text-slate-600">{r.category?.name ?? '—'}</td>
                      <td className="p-2 font-semibold">{dzd(r.base_price)}</td>
                      <td className="p-2">
                        {r.variants.length === 0 ? (
                          <span className="text-slate-400">بدون متغيّرات</span>
                        ) : (
                          <span className={stock === 0 ? 'font-semibold text-rose-600' : ''}>
                            {stock === 0 ? 'نفد' : stock}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <Toggle
                          checked={r.is_active}
                          onChange={(v) => toggleActive(r, v)}
                          label="إظهار المنتج"
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <Link to={`/products/${r.id}/offers`}>
                            <Button variant="secondary" className="!px-3 !py-1.5">
                              🎁 عروض
                            </Button>
                          </Link>
                          <Link to={`/products/${r.id}/design`}>
                            <Button variant="secondary" className="!px-3 !py-1.5">
                              ✨ تصميم AI
                            </Button>
                          </Link>
                          <Link to={`/products/${r.id}/page`}>
                            <Button variant="secondary" className="!px-3 !py-1.5">
                              🎨 الصفحة
                            </Button>
                          </Link>
                          <Link to={`/products/${r.id}`}>
                            <Button variant="secondary" className="!px-3 !py-1.5">
                              تعديل
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            className="!px-3 !py-1.5 text-rose-600"
                            onClick={() => remove(r)}
                          >
                            حذف
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
