// AI banner images (Gemini). Modes:
//   brief -> { style_guide, intro, conversion }: a shared visual style and one prompt per tall image
//   image -> generates ONE tall banner image, stores it in the public `lh-products` bucket, returns its URL
// The admin app calls `image` twice (the second call receives the first URL as a style reference), so each
// call stays well inside the Edge Function time limit. Admin only.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const TEXT_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash'
const TEXT_FALLBACK = 'gemini-2.5-flash'
const IMAGE_MODEL = Deno.env.get('GEMINI_IMAGE_MODEL') || 'gemini-3.1-flash-image'
const IMAGE_FALLBACK = 'gemini-2.5-flash-image'
const HOURLY_IMAGES = 16
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const BUCKET_PUBLIC = `${SUPABASE_URL}/storage/v1/object/public/lh-products/`

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const BRIEF_RULES = `أنت مدير إبداعي لصفحات الهبوط الإعلانية للسوق الجزائري. الصفحة تعتمد على صورتين إعلانيتين عموديتين طويلتين متتاليتين، بنص عربي فصيح مدمج داخل الصورة.
حلّل صورة المنتج واسمه ووصفه، ثم أعد JSON فقط (بلا markdown ولا شرح) بهذا الشكل:
{"style_guide":"...","intro":"...","conversion":"..."}
- style_guide: 4 إلى 5 جمل تحدد بدقة: ألواناً محددة، الإضاءة، نمط التصوير أو الرسم، شكل الخط العربي وحجمه، نوع الفواصل. سيُكرَّر حرفياً في طلبي الصورتين لضمان التطابق.
- intro: وصف الصورة الأولى: مشكلة حقيقية يعانيها الجمهور المستهدف، ثم تضخيم الإحساس بها، ثم عرض بطولي للمنتج مع اسمه. يجب الحفاظ تماماً على شكل ولون المنتج كما في الصورة المرفقة.
- conversion: وصف الصورة الثانية التي تكمل الأولى: 2 إلى 3 ميزات واضحة، ثم مشهد واقعي للمنتج قيد الاستخدام، ثم دعوة شراء بارزة.
قواعد: نص عربي فصيح فقط بلا أي حرف إنجليزي، جمل تسويقية ذات معنى، وممنوع منعاً باتاً كتابة أي سعر أو رقم مالي داخل الصور (السعر يظهر في نموذج الطلب). استعمل عبارات مثل «اطلب الآن» و«عرض لفترة محدودة».`

async function fetchImage(url: string): Promise<{ mimeType: string; data: string } | null> {
  const store = (Deno.env.get('STORE_URL') ?? '').replace(/\/$/, '')
  const ok = url.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`) || (store && url.startsWith(store + '/'))
  if (!ok) return null
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!r.ok) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    if (buf.length > 7_000_000) return null
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { mimeType: r.headers.get('content-type')?.split(';')[0] || 'image/jpeg', data: btoa(bin) }
  } catch {
    return null
  }
}

type Part = { text?: string; inlineData?: { mimeType: string; data: string } }

async function gemini(model: string, key: string, parts: Part[], generationConfig: Record<string, unknown>, ms: number) {
  return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(ms),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
  })
}

async function withFallback(models: string[], call: (m: string) => Promise<Response>): Promise<Response> {
  let res = await call(models[0])
  if ((res.status === 404 || res.status === 400) && models[1]) res = await call(models[1])
  return res
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isAdmin, error: adminErr } = await supabase.rpc('lh_is_admin')
  if (adminErr || isAdmin !== true) return json({ error: 'forbidden' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const mode = body.mode
  const productId = s(body.product_id, 60)
  if ((mode !== 'brief' && mode !== 'image') || !/^[0-9a-f-]{36}$/i.test(productId)) return json({ error: 'bad_request' }, 400)

  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: 'ai_not_configured' }, 500)

  const { data: p } = await supabase.from('lh_products').select('name,description,images').eq('id', productId).maybeSingle()
  if (!p) return json({ error: 'product_not_found' }, 404)
  const productImg = p.images?.[0] ? await fetchImage(p.images[0]) : null

  try {
    if (mode === 'brief') {
      const notes = s(body.notes, 800)
      const parts: Part[] = [
        { text: `${BRIEF_RULES}\n\nاسم المنتج: ${s(p.name, 200)}\nالوصف: ${s(p.description, 2000)}${notes ? `\nملاحظات صاحب المتجر: ${notes}` : ''}` },
        ...(productImg ? [{ inlineData: productImg }] : []),
      ]
      const res = await withFallback([TEXT_MODEL, TEXT_FALLBACK], (m) =>
        gemini(m, key, parts, { temperature: 0.8, maxOutputTokens: 3000, responseMimeType: 'application/json' }, 90_000))
      if (!res.ok) return json({ error: res.status === 429 ? 'ai_busy' : 'ai_failed' }, 502)
      const out = await res.json()
      const raw = (out?.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? '').join('')
      let b: { style_guide?: string; intro?: string; conversion?: string } = {}
      try {
        b = JSON.parse(raw.replace(/```(?:json)?/g, '').trim())
      } catch {
        const m = raw.match(/\{[\s\S]*\}/)
        if (m) try { b = JSON.parse(m[0]) } catch { /* fallthrough */ }
      }
      if (!b.style_guide || !b.intro || !b.conversion) return json({ error: 'ai_bad_output' }, 502)
      return json({ style_guide: s(b.style_guide, 2000), intro: s(b.intro, 3000), conversion: s(b.conversion, 3000) })
    }

    // mode === 'image'
    const since = new Date(Date.now() - 3600_000).toISOString()
    const usage = await supabase.from('lh_ai_generations').select('id', { count: 'exact', head: true }).eq('kind', 'banner').gte('created_at', since)
    if (!usage.error && (usage.count ?? 0) >= HOURLY_IMAGES) return json({ error: 'rate_limited' }, 429)

    const section = s(body.prompt, 3500)
    const styleGuide = s(body.style_guide, 2500)
    const index = body.index === 1 ? 1 : 0
    if (!section || !styleGuide) return json({ error: 'bad_request' }, 400)
    const refUrl = s(body.reference_url, 400)
    const ref = index === 1 && refUrl.startsWith(BUCKET_PUBLIC + 'banners/') ? await fetchImage(refUrl) : null

    const prompt = `${section}\n\nدليل الأسلوب البصري الإلزامي، طبّقه بدقة:\n${styleGuide}\n\nاجعل الصورة عمودية طويلة بأقصى نسبة طول متاحة. النص العربي الفصيح مدمج داخل الصورة وواضح وبلا أخطاء إملائية. ممنوع أي سعر أو رقم مالي داخل الصورة. حافظ على شكل ولون المنتج كما في الصورة المرفقة الأولى.${
      ref ? '\nالصورة المرفقة الثانية هي القسم الأول من الحملة نفسها: طابقها في الألوان والإضاءة والخط ونمط التصوير بدقة بحيث تبدوان قطعة واحدة متصلة.' : ''
    }`
    const parts: Part[] = [{ text: prompt }, ...(productImg ? [{ inlineData: productImg }] : []), ...(ref ? [{ inlineData: ref }] : [])]
    const cfg = { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } }
    const res = await withFallback([IMAGE_MODEL, IMAGE_FALLBACK], (m) => gemini(m, key, parts, cfg, 120_000))
    if (!res.ok) {
      console.error('image status', res.status, (await res.text()).slice(0, 300))
      return json({ error: res.status === 429 ? 'ai_busy' : 'ai_failed' }, 502)
    }
    const out = await res.json()
    const img = (out?.candidates?.[0]?.content?.parts ?? []).find((x: { inlineData?: unknown }) => x.inlineData)?.inlineData as
      | { mimeType?: string; data: string }
      | undefined
    if (!img?.data) return json({ error: 'ai_bad_output' }, 502)

    const mime = img.mimeType || 'image/png'
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
    const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0))
    const path = `banners/${productId}/${Date.now()}-${index + 1}.${ext}`
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const up = await admin.storage.from('lh-products').upload(path, bytes, { contentType: mime, upsert: false })
    if (up.error) {
      console.error('upload', up.error.message)
      return json({ error: 'upload_failed' }, 502)
    }
    await supabase.from('lh_ai_generations').insert({ product_id: productId, kind: 'banner' })
    return json({ url: BUCKET_PUBLIC + path })
  } catch (e) {
    const timeout = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError'
    return json({ error: timeout ? 'ai_timeout' : 'ai_failed' }, timeout ? 504 : 502)
  }
})
