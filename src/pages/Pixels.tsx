import { useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { Button, Card, Field, PageHeader, PageLoader, Toggle, inputCls } from '../components/ui'
import { supabase } from '../lib/supabase'

type PixelValue = { pixel_id: string; enabled: boolean }

const KEYS = { facebook: 'facebook_pixel', tiktok: 'tiktok_pixel' } as const

export default function Pixels() {
  const notify = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fb, setFb] = useState<PixelValue>({ pixel_id: '', enabled: false })
  const [tt, setTt] = useState<PixelValue>({ pixel_id: '', enabled: false })

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase
        .from('lh_store_settings')
        .select('key,value')
        .in('key', [KEYS.facebook, KEYS.tiktok])
      if (error) notify('تعذّر تحميل الإعدادات: ' + error.message, 'error')
      for (const row of data ?? []) {
        const v = row.value as Partial<PixelValue>
        const parsed = { pixel_id: v.pixel_id ?? '', enabled: Boolean(v.enabled) }
        if (row.key === KEYS.facebook) setFb(parsed)
        if (row.key === KEYS.tiktok) setTt(parsed)
      }
      setLoading(false)
    })()
  }, [notify])

  const save = async () => {
    const fbId = fb.pixel_id.trim()
    const ttId = tt.pixel_id.trim()

    if (fbId && !/^\d{10,20}$/.test(fbId)) {
      return notify('معرّف بيكسل فيسبوك يجب أن يكون أرقاماً فقط (15–16 رقماً عادةً)', 'error')
    }
    if (ttId && !/^[A-Za-z0-9]{10,30}$/.test(ttId)) {
      return notify('معرّف بيكسل تيك توك يجب أن يكون حروفاً وأرقاماً فقط', 'error')
    }
    if (fb.enabled && !fbId) return notify('أدخل معرّف بيكسل فيسبوك لتفعيله', 'error')
    if (tt.enabled && !ttId) return notify('أدخل معرّف بيكسل تيك توك لتفعيله', 'error')

    setSaving(true)
    const { error } = await supabase.from('lh_store_settings').upsert(
      [
        { key: KEYS.facebook, value: { pixel_id: fbId, enabled: fb.enabled }, is_public: true },
        { key: KEYS.tiktok, value: { pixel_id: ttId, enabled: tt.enabled }, is_public: true },
      ],
      { onConflict: 'key' },
    )
    setSaving(false)
    if (error) {
      notify('فشل الحفظ: ' + error.message, 'error')
      return
    }
    setFb({ ...fb, pixel_id: fbId })
    setTt({ ...tt, pixel_id: ttId })
    notify('تم حفظ إعدادات البيكسل')
  }

  if (loading) return <PageLoader />

  return (
    <>
      <PageHeader
        title="البيكسل"
        subtitle="أضف معرّفات بيكسل فيسبوك وتيك توك ليقرأها المتجر ويتتبّع الزيارات والطلبات."
        actions={
          <Button onClick={save} loading={saving}>
            حفظ
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Facebook Pixel">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">تفعيل البيكسل</span>
              <Toggle checked={fb.enabled} onChange={(v) => setFb({ ...fb, enabled: v })} label="تفعيل فيسبوك" />
            </div>
            <Field label="Pixel ID" hint="تجده في مدير الأحداث (Events Manager) في فيسبوك">
              <input
                className={inputCls}
                dir="ltr"
                inputMode="numeric"
                placeholder="123456789012345"
                value={fb.pixel_id}
                onChange={(e) => setFb({ ...fb, pixel_id: e.target.value })}
              />
            </Field>
          </div>
        </Card>

        <Card title="TikTok Pixel">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">تفعيل البيكسل</span>
              <Toggle checked={tt.enabled} onChange={(v) => setTt({ ...tt, enabled: v })} label="تفعيل تيك توك" />
            </div>
            <Field label="Pixel ID" hint="تجده في TikTok Ads Manager ← Events ← Web Events">
              <input
                className={inputCls}
                dir="ltr"
                placeholder="C1ABCDEF2GHIJKLMNOP3"
                value={tt.pixel_id}
                onChange={(e) => setTt({ ...tt, pixel_id: e.target.value })}
              />
            </Field>
          </div>
        </Card>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        معرّفات البيكسل ليست أسراراً (تظهر في كود المتجر)، لذلك تُحفظ كإعدادات عامة يقرأها المتجر مباشرة.
      </p>
    </>
  )
}
