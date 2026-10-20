import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { assetUrl, refreshStore } from '../lib/store'
import { randomSuffix, slugify, toNumberOrNull } from '../lib/format'
import { PRODUCTS_BUCKET, supabase } from '../lib/supabase'
import type { Category } from '../lib/types'

type ComboData = {
  id?: string
  price: string
  stock_quantity: string
  sku: string
  is_active: boolean
}

const comboKey = (color: string, size: string) => `${color}\u0000${size}`

const emptyCombo = (): ComboData => ({ price: '', stock_quantity: '0', sku: '', is_active: true })

const uniq = (arr: string[]) => Array.from(new Set(arr.map((x) => x.trim()).filter(Boolean)))

function ChipsInput({
  label,
  hint,
  items,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  items: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [text, setText] = useState('')
  const commit = () => {
    const parts = text.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean)
    if (parts.length) onChange(uniq([...items, ...parts]))
    setText('')
  }
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === '،') {
              e.preventDefault()
              commit()
            }
          }}
          onBlur={commit}
        />
        <Button type="button" variant="secondary" onClick={commit}>
          إضافة
        </Button>
      </div>
      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((it) => (
            <span
              key={it}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700"
            >
              {it}
              <button
                type="button"
                aria-label="حذف"
                onClick={() => onChange(items.filter((x) => x !== it))}
                className="text-brand-700/70 hover:text-rose-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </Field>
  )
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export default function ProductForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const notify = useToast()

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadingLanding, setUploadingLanding] = useState(false)

  const [categories, setCategories] = useState<Category[]>([])
  const [newCategory, setNewCategory] = useState('')

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [comparePrice, setComparePrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [sku, setSku] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [isActive, setIsActive] = useState(true)
  const [isFeatured, setIsFeatured] = useState(false)
  const [landingImages, setLandingImages] = useState<string[]>([])
  const [landingPosition, setLandingPosition] = useState<'above' | 'below'>('below')
  const [colors, setColors] = useState<string[]>([])
  const [sizes, setSizes] = useState<string[]>([])
  const [combos, setCombos] = useState<Record<string, ComboData>>({})
  const [loadedVariantIds, setLoadedVariantIds] = useState<string[]>([])
  type StockLink = { stock_item_id: string; qty_per_unit: string }
  const [stockItems, setStockItems] = useState<{ id: string; name: string; quantity: number; avg_cost: number }[]>([])
  const [inStock, setInStock] = useState(false)
  const [links, setLinks] = useState<StockLink[]>([])
  const linked = inStock && links.some((l) => l.stock_item_id)

  const loadCategories = async () => {
    const { data } = await supabase
      .from('lh_categories')
      .select('id,name,slug,is_active')
      .order('sort_order')
      .order('name')
    setCategories((data ?? []) as Category[])
  }

  useEffect(() => {
    loadCategories()
  }, [])

  const loadStockItems = async () => {
    const { data } = await supabase.from('lh_stock_items').select('id,name,quantity,avg_cost').order('name').limit(500)
    setStockItems(((data ?? []) as { id: string; name: string; quantity: number; avg_cost: number }[]).map((x) => ({ ...x, avg_cost: Number(x.avg_cost) })))
  }
  useEffect(() => {
    void loadStockItems()
  }, [])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const { data: p, error } = await supabase
        .from('lh_products')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      const { data: vs } = await supabase
        .from('lh_product_variants')
        .select('*')
        .eq('product_id', id)
        .order('created_at')
      const { data: ls } = await supabase.from('lh_product_stock_links').select('stock_item_id,qty_per_unit').eq('product_id', id)
      if (cancelled) return
      if (error || !p) {
        notify('المنتج غير موجود', 'error')
        navigate('/products', { replace: true })
        return
      }
      setName(p.name)
      setSlug(p.slug)
      setSlugTouched(true)
      setDescription(p.description ?? '')
      setCategoryId(p.category_id ?? '')
      setBasePrice(String(p.base_price ?? ''))
      setComparePrice(p.compare_at_price != null ? String(p.compare_at_price) : '')
      setCostPrice(p.cost_price != null ? String(p.cost_price) : '')
      setSku(p.sku ?? '')
      setImages(p.images ?? [])
      setLandingImages(p.landing_images ?? [])
      setLandingPosition(p.landing_position === 'above' ? 'above' : 'below')
      setIsActive(p.is_active)
      setIsFeatured(p.is_featured)
      const rows = vs ?? []
      const map: Record<string, ComboData> = {}
      for (const v of rows) {
        map[comboKey((v.color ?? '').trim(), (v.size ?? '').trim())] = {
          id: v.id as string,
          price: v.price != null ? String(v.price) : '',
          stock_quantity: String(v.stock_quantity ?? 0),
          sku: v.sku ?? '',
          is_active: v.is_active,
        }
      }
      setColors(uniq(rows.map((v) => v.color ?? '')))
      setSizes(uniq(rows.map((v) => v.size ?? '')))
      setCombos(map)
      setLoadedVariantIds(rows.map((v) => v.id as string))
      const lrows = (ls ?? []) as { stock_item_id: string; qty_per_unit: number }[]
      setLinks(lrows.map((l) => ({ stock_item_id: l.stock_item_id, qty_per_unit: String(l.qty_per_unit) })))
      setInStock(lrows.length > 0)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id, navigate, notify])

  const onNameChange = (v: string) => {
    setName(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  const addCategory = async () => {
    const n = newCategory.trim()
    if (!n) return
    const { data, error } = await supabase
      .from('lh_categories')
      .insert({ name: n, slug: slugify(n) || `cat-${randomSuffix()}` })
      .select('id')
      .single()
    if (error) {
      notify(
        error.code === '23505' ? 'هذه الفئة موجودة بالفعل' : 'تعذّر إنشاء الفئة: ' + error.message,
        'error',
      )
      return
    }
    setNewCategory('')
    await loadCategories()
    setCategoryId(data.id)
    notify('تمت إضافة الفئة')
  }

  const uploadTo = async (files: FileList | null, folder: string): Promise<string[]> => {
    const added: string[] = []
    if (!files) return added
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        notify(`«${file.name}» ليس صورة`, 'error')
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        notify(`«${file.name}» أكبر من 5 ميغابايت`, 'error')
        continue
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${folder}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from(PRODUCTS_BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
      if (error) {
        notify('فشل رفع الصورة: ' + error.message, 'error')
        continue
      }
      added.push(supabase.storage.from(PRODUCTS_BUCKET).getPublicUrl(path).data.publicUrl)
    }
    return added
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    const added = await uploadTo(files, 'products')
    if (added.length) setImages((prev) => [...prev, ...added])
    setUploading(false)
  }

  const uploadLanding = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadingLanding(true)
    const added = await uploadTo(files, 'landing')
    if (added.length) setLandingImages((prev) => [...prev, ...added])
    setUploadingLanding(false)
  }

  const moveLanding = (i: number, dir: -1 | 1) =>
    setLandingImages((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const removeLanding = (i: number) => setLandingImages((prev) => prev.filter((_, idx) => idx !== i))

  const makeMain = (i: number) =>
    setImages((prev) => [prev[i], ...prev.filter((_, idx) => idx !== i)])
  const removeImage = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i))

  // Every color × size pair; if only one list is filled, just that list.
  const comboList = useMemo(() => {
    if (colors.length === 0 && sizes.length === 0) return []
    const cs = colors.length ? colors : ['']
    const ss = sizes.length ? sizes : ['']
    return cs.flatMap((color) => ss.map((size) => ({ color, size, key: comboKey(color, size) })))
  }, [colors, sizes])

  const getCombo = (key: string): ComboData => combos[key] ?? emptyCombo()
  const updateCombo = (key: string, patch: Partial<ComboData>) =>
    setCombos((prev) => ({ ...prev, [key]: { ...(prev[key] ?? emptyCombo()), ...patch } }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()

    const price = toNumberOrNull(basePrice)
    if (!name.trim()) return notify('أدخل اسم المنتج', 'error')
    if (!slug.trim()) return notify('أدخل رابط المنتج (slug)', 'error')
    if (price === null || price < 0) return notify('أدخل سعراً صحيحاً', 'error')
    for (const c of comboList) {
      const v = getCombo(c.key)
      const stock = Number(v.stock_quantity)
      if (!Number.isInteger(stock) || stock < 0) {
        return notify('كمية المخزون يجب أن تكون عدداً صحيحاً موجباً', 'error')
      }
      const vp = toNumberOrNull(v.price)
      if (v.price.trim() !== '' && (vp === null || vp < 0)) {
        return notify('سعر المتغيّر غير صحيح', 'error')
      }
    }

    const cleanLinks = inStock ? links.filter((l) => l.stock_item_id) : []
    if (new Set(cleanLinks.map((l) => l.stock_item_id)).size !== cleanLinks.length) return notify('عنصر مخزون مكرر في الربط.', 'error')
    for (const l of cleanLinks) {
      const n = Number(l.qty_per_unit)
      if (!Number.isInteger(n) || n < 1) return notify('كمية العنصر لكل قطعة يجب أن تكون عدداً صحيحاً ≥ 1.', 'error')
    }

    setSaving(true)
    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
      category_id: categoryId || null,
      base_price: price,
      compare_at_price: toNumberOrNull(comparePrice),
      ...(linked ? {} : { cost_price: toNumberOrNull(costPrice) }),
      sku: sku.trim() || null,
      images,
      landing_images: landingImages,
      landing_position: landingPosition,
      is_active: isActive,
      is_featured: isFeatured,
    }

    const fail = (message: string) => {
      setSaving(false)
      const lower = message.toLowerCase()
      if (lower.includes('slug')) notify('رابط المنتج مستخدم من منتج آخر، غيّره', 'error')
      else if (lower.includes('sku')) notify('رمز SKU مستخدم من قبل', 'error')
      else notify('فشل الحفظ: ' + message, 'error')
    }

    let productId = id
    if (isEdit && id) {
      const { error } = await supabase.from('lh_products').update(payload).eq('id', id)
      if (error) return fail(error.message)
    } else {
      const { data, error } = await supabase.from('lh_products').insert(payload).select('id').single()
      if (error) return fail(error.message)
      productId = data.id
    }

    // Variants: delete removed, update existing, insert new.
    const keep = comboList.map((c) => getCombo(c.key).id).filter(Boolean) as string[]
    const removedIds = loadedVariantIds.filter((vid) => !keep.includes(vid))
    if (removedIds.length) {
      const { error } = await supabase.from('lh_product_variants').delete().in('id', removedIds)
      if (error) return fail(error.message)
    }
    for (const c of comboList) {
      const v = getCombo(c.key)
      const row = {
        product_id: productId,
        size: c.size || null,
        color: c.color || null,
        price: toNumberOrNull(v.price),
        stock_quantity: Number(v.stock_quantity),
        sku: v.sku.trim() || null,
        is_active: v.is_active,
      }
      const { error } = v.id
        ? await supabase.from('lh_product_variants').update(row).eq('id', v.id)
        : await supabase.from('lh_product_variants').insert(row)
      if (error) return fail(error.message)
    }

    // Stock links: replace the product's links, then let the database recompute cost and availability.
    {
      const del = await supabase.from('lh_product_stock_links').delete().eq('product_id', productId)
      if (del.error) return fail(del.error.message)
      if (cleanLinks.length) {
        const ins = await supabase.from('lh_product_stock_links').insert(cleanLinks.map((l) => ({ product_id: productId, stock_item_id: l.stock_item_id, qty_per_unit: Number(l.qty_per_unit) })))
        if (ins.error) return fail(ins.error.message)
        await supabase.rpc('lh_recalc_product', { p_product: productId })
      }
    }

    void refreshStore()
    setSaving(false)
    notify(isEdit ? 'تم حفظ التعديلات' : 'تمت إضافة المنتج')
    navigate('/products')
  }

  if (loading) return <PageLoader />

  return (
    <form onSubmit={submit}>
      <PageHeader
        title={isEdit ? 'تعديل المنتج' : 'منتج جديد'}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => navigate('/products')}>
              إلغاء
            </Button>
            <Button type="submit" loading={saving}>
              {isEdit ? 'حفظ التعديلات' : 'إضافة المنتج'}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="المعلومات الأساسية">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم المنتج *" className="sm:col-span-2">
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  required
                />
              </Field>
              <Field label="الرابط (slug) *" hint="يُستخدم في رابط صفحة المنتج في المتجر" className="sm:col-span-2">
                <input
                  className={inputCls}
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value)
                    setSlugTouched(true)
                  }}
                  required
                />
              </Field>
              <Field label="الوصف" className="sm:col-span-2">
                <textarea
                  className={inputCls}
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label="رمز المنتج (SKU)">
                <input className={inputCls} dir="ltr" value={sku} onChange={(e) => setSku(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="الصور">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {images.map((url, i) => (
                <div key={url} className="group relative overflow-hidden rounded-lg border border-slate-200">
                  <img src={assetUrl(url)} alt="" className="aspect-square w-full object-cover" />
                  {i === 0 && (
                    <span className="absolute right-1 top-1 rounded bg-sun-400 px-1.5 py-0.5 text-[10px] font-bold text-brand-900">
                      رئيسية
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-black/60 p-1 opacity-0 transition group-hover:opacity-100">
                    {i !== 0 && (
                      <button
                        type="button"
                        onClick={() => makeMain(i)}
                        className="flex-1 rounded bg-white/90 py-1 text-[11px] font-semibold"
                      >
                        رئيسية
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="flex-1 rounded bg-rose-600 py-1 text-[11px] font-semibold text-white"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ))}
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-600">
                <span className="text-2xl">{uploading ? '…' : '＋'}</span>
                <span>{uploading ? 'جارٍ الرفع' : 'إضافة صور'}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    uploadFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">الصورة الأولى هي الرئيسية. الحد الأقصى 5 ميغابايت للصورة.</p>
          </Card>

          <Card title="صور صفحة الهبوط">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">مكان العرض:</span>
              {([
                ['above', 'فوق وصف المنتج'],
                ['below', 'تحت وصف المنتج'],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setLandingPosition(val)}
                  className={`rounded-full border px-3 py-1 font-semibold transition ${
                    landingPosition === val
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-300 text-slate-600 hover:border-brand-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {landingImages.map((url, i) => (
                <div key={url} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <img src={assetUrl(url)} alt="" className="aspect-[3/4] w-full object-contain" />
                  <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-black/60 p-1 opacity-0 transition group-hover:opacity-100">
                    <button type="button" onClick={() => moveLanding(i, -1)} className="flex-1 rounded bg-white/90 py-1 text-[11px] font-semibold">
                      →
                    </button>
                    <button type="button" onClick={() => moveLanding(i, 1)} className="flex-1 rounded bg-white/90 py-1 text-[11px] font-semibold">
                      ←
                    </button>
                    <button type="button" onClick={() => removeLanding(i)} className="flex-1 rounded bg-rose-600 py-1 text-[11px] font-semibold text-white">
                      حذف
                    </button>
                  </div>
                </div>
              ))}
              <label className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-600">
                <span className="text-2xl">{uploadingLanding ? '…' : '＋'}</span>
                <span>{uploadingLanding ? 'جارٍ الرفع' : 'إضافة صور'}</span>
                <input
                  type="file"
                  accept="image/*,.gif"
                  multiple
                  className="hidden"
                  disabled={uploadingLanding}
                  onChange={(e) => {
                    uploadLanding(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              تقبل JPG وPNG وWebP وGIF المتحرّكة. تُعرض بالترتيب الظاهر. الحد الأقصى 5 ميغابايت للصورة.
            </p>
          </Card>

          <Card title="الألوان والمقاسات">
            <div className="grid gap-4 sm:grid-cols-2">
              <ChipsInput
                label="الألوان"
                hint="اكتب لوناً واضغط Enter (أو افصل بفاصلة)"
                items={colors}
                onChange={setColors}
                placeholder="أحمر، أزرق…"
              />
              <ChipsInput
                label="المقاسات"
                hint="اكتب مقاساً واضغط Enter (أو افصل بفاصلة)"
                items={sizes}
                onChange={setSizes}
                placeholder="S، M، 2-3 سنوات…"
              />
            </div>

            {comboList.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-sm font-semibold">المخزون لكل تركيبة ({comboList.length})</p>
                <div className="space-y-2">
                  {comboList.map((c) => {
                    const v = getCombo(c.key)
                    return (
                      <div
                        key={c.key}
                        className="grid grid-cols-2 items-end gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-5"
                      >
                        <div className="col-span-2 text-sm font-semibold sm:col-span-1">
                          {[c.color, c.size].filter(Boolean).join(' / ')}
                        </div>
                        <Field label="المخزون">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className={inputCls}
                            value={v.stock_quantity}
                            disabled={linked}
                            title={linked ? 'يُحسب تلقائياً من المخزون المرتبط' : undefined}
                            onChange={(e) => updateCombo(c.key, { stock_quantity: e.target.value })}
                          />
                        </Field>
                        <Field label="سعر خاص" hint="اختياري">
                          <input
                            type="number"
                            min="0"
                            className={inputCls}
                            value={v.price}
                            onChange={(e) => updateCombo(c.key, { price: e.target.value })}
                          />
                        </Field>
                        <Field label="SKU">
                          <input
                            className={inputCls}
                            dir="ltr"
                            value={v.sku}
                            onChange={(e) => updateCombo(c.key, { sku: e.target.value })}
                          />
                        </Field>
                        <div className="pb-1">
                          <Toggle checked={v.is_active} onChange={(val) => updateCombo(c.key, { is_active: val })} label="متاح" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="الحالة">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">معروض في المتجر</span>
                <Toggle checked={isActive} onChange={setIsActive} label="معروض" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">منتج مميّز</span>
                <Toggle checked={isFeatured} onChange={setIsFeatured} label="مميز" />
              </div>
            </div>
          </Card>

          <Card title="الأسعار (د.ج)">
            <div className="space-y-4">
              <Field label="سعر البيع *">
                <input
                  type="number"
                  min="0"
                  className={inputCls}
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  required
                />
              </Field>
              <Field label="السعر قبل الخصم" hint="يظهر مشطوباً في المتجر">
                <input type="number" min="0" className={inputCls} value={comparePrice} onChange={(e) => setComparePrice(e.target.value)} />
              </Field>
              <Field label="سعر التكلفة" hint={linked ? 'يُحسب تلقائياً من متوسط تكلفة عناصر المخزون' : 'للإدارة فقط'}>
                <input type="number" min="0" className={inputCls} value={costPrice} disabled={linked} onChange={(e) => setCostPrice(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="🏬 المخزون">
            <p className="mb-3 text-sm font-semibold">هل المنتج موجود في المخزون؟</p>
            <div className="mb-3 flex gap-2">
              {[{ v: true, l: 'نعم' }, { v: false, l: 'لا' }].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => {
                    setInStock(o.v)
                    if (o.v && links.length === 0) setLinks([{ stock_item_id: '', qty_per_unit: '1' }])
                  }}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold ${inStock === o.v ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            {inStock && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">يمكن أن يتكوّن المنتج من عنصرين أو أكثر من المخزون. ينقص المخزون عند تأكيد الطلب فقط، وتُحسب التكلفة من متوسط تكلفة العناصر.</p>
                {links.map((l, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <select
                      className={inputCls}
                      value={l.stock_item_id}
                      onChange={(e) => setLinks((arr) => arr.map((x, j) => (j === k ? { ...x, stock_item_id: e.target.value } : x)))}
                    >
                      <option value="">— اختر عنصراً —</option>
                      {stockItems.map((it) => (
                        <option key={it.id} value={it.id}>{it.name} ({it.quantity})</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="1"
                      title="الكمية المستهلكة من هذا العنصر لكل قطعة تُباع"
                      className={inputCls + ' !w-20'}
                      value={l.qty_per_unit}
                      onChange={(e) => setLinks((arr) => arr.map((x, j) => (j === k ? { ...x, qty_per_unit: e.target.value } : x)))}
                    />
                    <button type="button" className="text-rose-600" aria-label="حذف" onClick={() => setLinks((arr) => arr.filter((_, j) => j !== k))}>✕</button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => setLinks((arr) => [...arr, { stock_item_id: '', qty_per_unit: '1' }])}>➕ عنصر آخر</Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      const n = name.trim()
                      if (!n) return notify('أدخل اسم المنتج أولاً.', 'error')
                      const found = stockItems.find((x) => x.name.trim().toLowerCase() === n.toLowerCase())
                      let itemId = found?.id
                      if (!itemId) {
                        const r = await supabase.from('lh_stock_items').insert({ name: n }).select('id').single()
                        if (r.error) return notify(r.error.message, 'error')
                        itemId = r.data.id as string
                        await loadStockItems()
                      }
                      setLinks((arr) => [...arr.filter((x) => x.stock_item_id), { stock_item_id: itemId!, qty_per_unit: '1' }])
                    }}
                  >
                    ✨ إنشاء عنصر بنفس اسم المنتج
                  </Button>
                </div>
                <p className="text-xs text-slate-500">الرقم الصغير = عدد وحدات العنصر المستهلكة لكل قطعة تُباع. سجّل المشتريات من صفحة «المخزون».</p>
              </div>
            )}
          </Card>

          <Card title="الفئة">
            <Field label="اختر الفئة">
              <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">بدون فئة</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="mt-3 flex gap-2">
              <input
                className={inputCls}
                placeholder="فئة جديدة…"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCategory()
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={addCategory}>
                إضافة
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </form>
  )
}
