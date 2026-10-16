import { useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, inputCls } from '../components/ui'
import { refreshStore } from '../lib/store'
import { PRODUCTS_BUCKET, supabase } from '../lib/supabase'

const KEY = 'store'
const MAX_LOGO_BYTES = 2 * 1024 * 1024

type StoreValue = { name: string; tagline: string; logo_url: string }

export default function StoreSettings() {
  const notify = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [value, setValue] = useState<StoreValue>({ name: '', tagline: '', logo_url: '' })

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('lh_store_settings')
        .select('value')
        .eq('key', KEY)
        .maybeSingle()
      if (error) notify('تعذّر تحميل الإعدادات: ' + error.message, 'error')
      const v = (data?.value ?? {}) as Partial<StoreValue>
      setValue({ name: v.name ?? '', tagline: v.tagline ?? '', logo_url: v.logo_url ?? '' })
      setLoading(false)
    })()
  }, [notify])

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return notify('الملف ليس صورة', 'error')
    if (file.size > MAX_LOGO_BYTES) return notify('الشعار أكبر من 2 ميغابايت', 'error')
    setUploading(true)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `brand/logo-${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from(PRODUCTS_BUCKET)
      .upload(path, file, { contentType: file.type, cacheControl: '31536000' })
    setUploading(false)
    if (error) return notify('فشل رفع الشعار: ' + error.message, 'error')
    setValue((prev) => ({
      ...prev,
      logo_url: supabase.storage.from(PRODUCTS_BUCKET).getPublicUrl(path).data.publicUrl,
    }))
  }

  const save = async () => {
    if (!value.name.trim()) return notify('أدخل اسم المتجر', 'error')
    setSaving(true)
    const { error } = await supabase.from('lh_store_settings').upsert(
      {
        key: KEY,
        value: {
          name: value.name.trim(),
          tagline: value.tagline.trim(),
          logo_url: value.logo_url,
        },
        is_public: true,
      },
      { onConflict: 'key' },
    )
    if (error) {
      setSaving(false)
      return notify('فشل الحفظ: ' + error.message, 'error')
    }
    const ok = await refreshStore()
    setSaving(false)
    notify(ok ? 'تم الحفظ وتحديث المتجر' : 'تم الحفظ (اضغط «تحديث المتجر» لإظهار التغيير)')
  }

  const refresh = async () => {
    setRefreshing(true)
    const ok = await refreshStore()
    setRefreshing(false)
    notify(
      ok ? 'تم تحديث المتجر' : 'تعذّر الوصول إلى المتجر، تأكد من VITE_STORE_URL',
      ok ? 'success' : 'error',
    )
  }

  if (loading) return <PageLoader />

  return (
    <>
      <PageHeader
        title="إعدادات المتجر"
        subtitle="اسم المتجر وشعاره يظهران في واجهة المتجر."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={refresh} loading={refreshing}>
              تحديث المتجر
            </Button>
            <Button onClick={save} loading={saving}>
              حفظ
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="الهوية">
          <div className="space-y-4">
            <Field label="اسم المتجر *">
              <input
                className={inputCls}
                value={value.name}
                onChange={(e) => setValue({ ...value, name: e.target.value })}
              />
            </Field>
            <Field label="الشعار النصي" hint="جملة قصيرة تظهر في أعلى المتجر">
              <input
                className={inputCls}
                value={value.tagline}
                onChange={(e) => setValue({ ...value, tagline: e.target.value })}
              />
            </Field>
          </div>
        </Card>

        <Card title="الشعار (اللوجو)">
          <div className="flex items-center gap-4">
            <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              <img
                src={value.logo_url || '/logo-default.jpg'}
                alt="الشعار"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
                {uploading ? 'جارٍ الرفع…' : 'رفع شعار جديد'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    uploadLogo(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
              {value.logo_url && (
                <button
                  type="button"
                  onClick={() => setValue({ ...value, logo_url: '' })}
                  className="block text-sm font-semibold text-rose-600 hover:underline"
                >
                  إزالة (استخدام الشعار الافتراضي)
                </button>
              )}
              <p className="text-xs text-slate-500">PNG أو JPG أو WebP، الأفضل مربّع وبخلفية شفافة. حتى 2 ميغابايت.</p>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
