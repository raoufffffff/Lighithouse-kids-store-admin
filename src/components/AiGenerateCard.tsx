import { useState } from 'react'
import { Button, Card, inputCls } from './ui'
import { supabase } from '../lib/supabase'
import type { PageContent } from '../lib/page-content'

export const TONES = [
  { id: 'friendly', label: '🤗 ودّية للأمهات' },
  { id: 'playful', label: '🎈 مرحة' },
  { id: 'premium', label: '💎 راقية' },
  { id: 'direct', label: '🎯 مباشرة للبيع' },
] as const

export const ERRORS: Record<string, string> = {
  forbidden: 'هذا الحساب ليس أدمين.',
  rate_limited: 'بلغتَ الحد الأقصى (20 توليداً في الساعة). حاول لاحقاً.',
  ai_busy: 'خدمة Gemini مشغولة الآن. أعد المحاولة بعد لحظات.',
  ai_timeout: 'استغرق التوليد وقتاً طويلاً. أعد المحاولة.',
  ai_bad_output: 'لم يُرجع الذكاء الاصطناعي نتيجة صالحة. أعد المحاولة.',
  ai_failed: 'فشل الاتصال بـ Gemini. تحقق من المفتاح GEMINI_API_KEY ثم أعد المحاولة.',
  ai_not_configured: 'مفتاح GEMINI_API_KEY غير مضبوط في Supabase.',
  ai_invalid_code: 'لم ينتج الذكاء الاصطناعي كوداً صالحاً بعد محاولتين. أعد المحاولة أو بسّط الطلب.',
  upload_failed: 'فشل رفع الصورة إلى التخزين.',
  home_empty:
    'لا توجد منتجات أو فئات بعد ليبني عليها الذكاء الاصطناعي الصفحة.',
  bad_request: 'طلب غير صالح.',
  product_not_found: 'المنتج غير موجود.',
}

type Props = {
  productId: string
  hasContent: boolean
  onResult: (content: PageContent, assumptions: string[]) => void
}

export default function AiGenerateCard({ productId, hasContent, onResult }: Props) {
  const [tone, setTone] = useState<(typeof TONES)[number]['id']>('friendly')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (hasContent && !confirm('سيحلّ التوليد محلّ محتوى المحرّر الحالي (يمكنك التراجع بعده). المتابعة؟')) return
    setBusy(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.functions.invoke('lh-generate-page', {
        body: { product_id: productId, tone, notes },
      })
      if (err) {
        let code = ''
        try {
          const ctx = (err as { context?: Response }).context
          code = ctx ? ((await ctx.json()) as { error?: string }).error ?? '' : ''
        } catch {
          /* ignore */
        }
        const missing = (err as { name?: string }).name === 'FunctionsFetchError' || /not found/i.test(err.message)
        setError(ERRORS[code] ?? (missing ? 'تعذّر الوصول إلى دالة التوليد. تأكد من نشرها في Supabase.' : 'تعذّر التوليد: ' + err.message))
        return
      }
      const res = data as { content?: PageContent; assumptions?: string[] }
      if (!res?.content) {
        setError(ERRORS.ai_bad_output)
        return
      }
      onResult(res.content, res.assumptions ?? [])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="✨ توليد بالذكاء الاصطناعي (Gemini)">
      <p className="mb-3 text-xs text-slate-500">
        يكتب مسودة كاملة من بيانات المنتج. تظهر في المعاينة فقط؛ لا يُحفظ ولا يُنشر شيء حتى تضغط «حفظ» ثم «نشر».
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {TONES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTone(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
              tone === t.id ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        className={`${inputCls} mb-3 min-h-[70px]`}
        maxLength={600}
        placeholder="ملاحظات اختيارية: مثل «ركّز على أنها هدية للعيد» أو «الفئة العمرية 3–6 سنوات»"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {error && <p className="mb-3 rounded-lg bg-rose-50 p-2.5 text-xs font-semibold text-rose-700">{error}</p>}
      <Button onClick={run} loading={busy}>
        {hasContent ? 'ولّد من جديد' : 'ولّد الصفحة'}
      </Button>
    </Card>
  )
}
