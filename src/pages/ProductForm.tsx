import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { randomSuffix, slugify, toNumberOrNull } from '../lib/format'
import { PRODUCTS_BUCKET, supabase } from '../lib/supabase'
import type { Category } from '../lib/types'

type VariantForm = {
  key: string
  id?: string
  size: string
  color: string
  price: string
  stock_quantity: string
  sku: string
  is_active: boolean
}

const newVariant = (): VariantForm => ({
  key: crypto.randomUUID(),
  size: '',
  color: '',
  price: '',
  stock_quantity: '0',
  sku: '',
  is_active: true,
})

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export default function ProductForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const notify = useToast()

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [categories, setCategories] = useState<Category[]>([])
  const [newCategory, setNewCategory] = useState('')

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [brand, setBrand] = useState('')
  const [gender, setGender] = useState('')
  const [ageRange, setAgeRange] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [comparePrice, setComparePrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [sku, setSku] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [isActive, setIsActive] = useState(true)
  const [isFeatured, setIsFeatured] = useState(false)
  const [variants, setVariants] = useState<VariantForm[]>([])
  const [loadedVariantIds, setLoadedVariantIds] = useState<string[]>([])

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
      setBrand(p.brand ?? '')
      setGender(p.gender ?? '')
      setAgeRange(p.age_range ?? '')
      setCategoryId(p.category_id ?? '')
      setBasePrice(String(p.base_price ?? ''))
      setComparePrice(p.compare_at_price != null ? String(p.compare_at_price) : '')
      setCostPrice(p.cost_price != null ? String(p.cost_price) : '')
      setSku(p.sku ?? '')
      setImages(p.images ?? [])
      setIsActive(p.is_active)
      setIsFeatured(p.is_featured)
      const loaded: VariantForm[] = (vs ?? []).map((v) => ({
        key: v.id as string,
        id: v.id as string,
        size: v.size ?? '',
        color: v.color ?? '',
        price: v.price != null ? String(v.price) : '',
        stock_quantity: String(v.stock_quantity ?? 0),
        sku: v.sku ?? '',
        is_active: v.is_active,
      }))
      setVariants(loaded)
      setLoadedVariantIds(loaded.map((v) => v.id!))
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

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    const added: string[] = []
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
      const path = `products/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage
        .from(PRODUCTS_BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
      if (error) {
        notify('فشل رفع الصورة: ' + error.message, 'error')
        continue
      }
      added.push(supabase.storage.from(PRODUCTS_BUCKET).getPublicUrl(path).data.publicUrl)
    }
    if (added.length) setImages((prev) => [...prev, ...added])
    setUploading(false)
  }

  const makeMain = (i: number) =>
    setImages((prev) => [prev[i], ...prev.filter((_, idx) => idx !== i)])
  const removeImage = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i))

  const updateVariant = (key: string, patch: Partial<VariantForm>) =>
    setVariants((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)))

  const submit = async (e: FormEvent) => {
    e.preventDefault()

    const price = toNumberOrNull(basePrice)
    if (!name.trim()) return notify('أدخل اسم المنتج', 'error')
    if (!slug.trim()) return notify('أدخل رابط المنتج (slug)', 'error')
    if (price === null || price < 0) return notify('أدخل سعراً صحيحاً', 'error')
    for (const v of variants) {
      const stock = Number(v.stock_quantity)
      if (!Number.isInteger(stock) || stock < 0) {
        return notify('كمية المخزون يجب أن تكون عدداً صحيحاً موجباً', 'error')
      }
      const vp = toNumberOrNull(v.price)
      if (v.price.trim() !== '' && (vp === null || vp < 0)) {
        return notify('سعر المتغيّر غير صحيح', 'error')
      }
    }

    setSaving(true)
    const payload = {
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
      brand: brand.trim() || null,
      gender: gender || null,
      age_range: ageRange.trim() || null,
      category_id: categoryId || null,
      base_price: price,
      compare_at_price: toNumberOrNull(comparePrice),
      cost_price: toNumberOrNull(costPrice),
      sku: sku.trim() || null,
      images,
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
    const currentIds = variants.filter((v) => v.id).map((v) => v.id!)
    const removedIds = loadedVariantIds.filter((vid) => !currentIds.includes(vid))
    if (removedIds.length) {
      const { error } = await supabase.from('lh_product_variants').delete().in('id', removedIds)
      if (error) return fail(error.message)
    }
    for (const v of variants) {
      const row = {
        product_id: productId,
        size: v.size.trim() || null,
        color: v.color.trim() || null,
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
              <Field label="العلامة التجارية">
                <input className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} />
              </Field>
              <Field label="الفئة العمرية" hint="مثال: 0-12 شهر، 3-5 سنوات">
                <input className={inputCls} value={ageRange} onChange={(e) => setAgeRange(e.target.value)} />
              </Field>
              <Field label="الجنس">
                <select className={inputCls} value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">غير محدد</option>
                  <option value="boys">أولاد</option>
                  <option value="girls">بنات</option>
                  <option value="unisex">للجنسين</option>
                </select>
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
                  <img src={url} alt="" className="aspect-square w-full object-cover" />
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

          <Card title="المتغيّرات (المقاس / اللون / المخزون)">
            {variants.length === 0 ? (
              <p className="mb-3 text-sm text-slate-500">
                لا توجد متغيّرات. أضف متغيّراً لتتبّع المخزون حسب المقاس واللون.
              </p>
            ) : (
              <div className="mb-3 space-y-3">
                {variants.map((v) => (
                  <div
                    key={v.key}
                    className="grid grid-cols-2 items-end gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-6"
                  >
                    <Field label="المقاس">
                      <input className={inputCls} value={v.size} onChange={(e) => updateVariant(v.key, { size: e.target.value })} />
                    </Field>
                    <Field label="اللون">
                      <input className={inputCls} value={v.color} onChange={(e) => updateVariant(v.key, { color: e.target.value })} />
                    </Field>
                    <Field label="سعر خاص" hint="اختياري">
                      <input
                        type="number"
                        min="0"
                        className={inputCls}
                        value={v.price}
                        onChange={(e) => updateVariant(v.key, { price: e.target.value })}
                      />
                    </Field>
                    <Field label="المخزون">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className={inputCls}
                        value={v.stock_quantity}
                        onChange={(e) => updateVariant(v.key, { stock_quantity: e.target.value })}
                      />
                    </Field>
                    <Field label="SKU">
                      <input
                        className={inputCls}
                        dir="ltr"
                        value={v.sku}
                        onChange={(e) => updateVariant(v.key, { sku: e.target.value })}
                      />
                    </Field>
                    <div className="flex items-center justify-between gap-2 pb-1">
                      <Toggle
                        checked={v.is_active}
                        onChange={(val) => updateVariant(v.key, { is_active: val })}
                        label="متاح"
                      />
                      <button
                        type="button"
                        onClick={() => setVariants((prev) => prev.filter((x) => x.key !== v.key))}
                        className="text-sm font-semibold text-rose-600 hover:underline"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="secondary" onClick={() => setVariants((prev) => [...prev, newVariant()])}>
              + إضافة متغيّر
            </Button>
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
              <Field label="سعر التكلفة" hint="للإدارة فقط">
                <input type="number" min="0" className={inputCls} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
              </Field>
            </div>
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
