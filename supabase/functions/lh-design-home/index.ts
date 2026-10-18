// AI design of the store home page + header (Gemini). Modes:
//   generate -> a complete new layout from the store's real products/categories
//   edit     -> modifies the layout sent by the admin according to `brief`
// Returns { layout: {v:1, header, sections} }; the admin app sanitises it again before use. Admin only.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash'
const FALLBACK = 'gemini-2.5-flash'
const HOURLY = 20
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const TONES: Record<string, string> = {
  friendly: 'ودّية ودافئة موجّهة للأمهات',
  playful: 'مرحة وحيوية',
  premium: 'راقية وأنيقة',
  direct: 'مباشرة تركّز على البيع والعروض',
}

const SCHEMA = `أعد JSON فقط (بلا markdown ولا شرح) بهذا الشكل بالضبط:
{"v":1,"header":HEADER,"sections":[SECTION,...]}

HEADER = {"style":"light|brand|dark","showName":true,"logoSize":"sm|md|lg",
 "announcement":{"enabled":true|false,"text":"...","link":LINK|null,"tone":"brand|sun|dark"},
 "links":[{"label":"...","link":LINK}] (حتى 6),"cta":{"label":"...","link":LINK}|null}

LINK = {"type":"home"} | {"type":"products"} | {"type":"category","ref":"<category id>"} | {"type":"product","ref":"<product id>"} | {"type":"url","ref":"https://..." أو "tel:..."}

أنواع الأقسام SECTION (لكل قسم حقل "id" نصي قصير فريد):
- {"type":"hero","layout":"split|center|banner","badge":"","headline":"...","subheadline":"...","image":null,"cta":{"label":"...","link":LINK}}
- {"type":"products","title":"...","subtitle":"...","source":"all|featured|latest|category|manual","categoryId":"<id أو فارغ>","productIds":[ids],"limit":4-12,"columns":2|3|4}
- {"type":"categories","title":"...","subtitle":"...","source":"all|manual","categoryIds":[ids]}
- {"type":"text","title":"...","body":"...","align":"start|center"}
- {"type":"perks","items":[{"icon":"إيموجي","title":"...","text":"..."}]} (3 إلى 4 عناصر)
- {"type":"cta","headline":"...","text":"...","button":{"label":"...","link":LINK},"tone":"brand|sun|dark"}
- {"type":"banner"} و{"type":"gallery"} تحتاجان صوراً يرفعها صاحب المتجر؛ لا تُنشئهما أبداً (image يبقى null/فارغاً).

قواعد صارمة:
- استعمل معرّفات المنتجات والفئات الواردة في القائمة فقط، ولا تخترع معرّفاً أو رابطاً خارجياً.
- نص عربي فصيح سليم، قصير وجذاب، دون أي سعر أو رقم مالي، دون ادّعاءات كاذبة (ضمان، خصم) غير مذكورة.
- ابدأ بقسم hero، وضمّن قسم products واحداً على الأقل، ويُستحسن ختم الصفحة بقسم cta.
- بين 4 و8 أقسام. الهيدر: اختر نمطاً يناسب النبرة، وروابط تقود لأقسام حقيقية (المنتجات أو الفئات).`

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
  if (mode !== 'generate' && mode !== 'edit') return json({ error: 'bad_request' }, 400)
  const brief = s(body.brief, 600)
  if (mode === 'edit' && (!brief || typeof body.layout !== 'object' || !body.layout)) return json({ error: 'bad_request' }, 400)

  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: 'ai_not_configured' }, 500)

  const since = new Date(Date.now() - 3600_000).toISOString()
  const usage = await supabase.from('lh_ai_generations').select('id', { count: 'exact', head: true }).eq('kind', 'home').gte('created_at', since)
  if (!usage.error && (usage.count ?? 0) >= HOURLY) return json({ error: 'rate_limited' }, 429)

  const [st, pr, ca] = await Promise.all([
    supabase.from('lh_store_settings').select('value').eq('key', 'store').maybeSingle(),
    supabase.from('lh_products').select('id,name,base_price,is_featured,category_id').eq('is_active', true).order('created_at', { ascending: false }).limit(60),
    supabase.from('lh_categories').select('id,name').eq('is_active', true).order('sort_order').limit(40),
  ])
  const products = pr.data ?? []
  const categories = ca.data ?? []
  if (products.length === 0 && categories.length === 0) return json({ error: 'home_empty' }, 422)
  const store = (st.data?.value ?? {}) as { name?: string; tagline?: string }

  const catName = new Map(categories.map((c: { id: string; name: string }) => [c.id, c.name]))
  const catalog =
    `اسم المتجر: ${s(store.name, 80) || 'المتجر'}\nشعاره: ${s(store.tagline, 160)}\nنوع المتجر: ألعاب أطفال في الجزائر، الدفع عند الاستلام.\n\n` +
    `الفئات:\n${categories.map((c: { id: string; name: string }) => `- ${c.id} | ${s(c.name, 60)}`).join('\n') || '(لا شيء)'}\n\n` +
    `المنتجات:\n${products.map((p: { id: string; name: string; is_featured: boolean; category_id: string | null }) =>
      `- ${p.id} | ${s(p.name, 80)} | ${catName.get(p.category_id ?? '') ?? 'بلا فئة'}${p.is_featured ? ' | مميز' : ''}`).join('\n') || '(لا شيء)'}`

  const tone = TONES[s(body.tone, 20)] ?? TONES.friendly
  const prompt =
    mode === 'generate'
      ? `أنت مصمم واجهات متاجر إلكترونية. صمّم الصفحة الرئيسية والهيدر لهذا المتجر بنبرة ${tone}.\n${brief ? `طلب صاحب المتجر: ${brief}\n` : ''}\n${catalog}\n\n${SCHEMA}`
      : `أنت مصمم واجهات متاجر إلكترونية. هذا التصميم الحالي للصفحة الرئيسية والهيدر (JSON):\n${JSON.stringify(body.layout).slice(0, 30000)}\n\nعدّله حسب طلب صاحب المتجر فقط، وأبقِ كل ما لم يُطلب تغييره كما هو (بما فيه الصور والمعرّفات id)، بنبرة ${tone}.\nالطلب: ${brief}\n\n${catalog}\n\n${SCHEMA}`

  const call = (m: string) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(100_000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 8000, responseMimeType: 'application/json' },
      }),
    })

  try {
    let res = await call(MODEL)
    if ((res.status === 404 || res.status === 400) && FALLBACK) res = await call(FALLBACK)
    if (!res.ok) return json({ error: res.status === 429 || res.status === 503 ? 'ai_busy' : 'ai_failed' }, 502)
    const out = await res.json()
    const raw = (out?.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? '').join('')
    let layout: Record<string, unknown> | null = null
    try {
      layout = JSON.parse(raw.replace(/```(?:json)?/g, '').trim())
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) try { layout = JSON.parse(m[0]) } catch { /* fallthrough */ }
    }
    if (!layout || !Array.isArray(layout.sections) || layout.sections.length === 0) return json({ error: 'ai_bad_output' }, 502)

    // Hard guard: keep only references to real products/categories.
    const pIds = new Set(products.map((p: { id: string }) => p.id))
    const cIds = new Set(categories.map((c: { id: string }) => c.id))
    const fixLink = (l: unknown): unknown => {
      const o = l as { type?: string; ref?: string } | null
      if (!o || typeof o !== 'object') return null
      if (o.type === 'category') return cIds.has(String(o.ref)) ? o : null
      if (o.type === 'product') return pIds.has(String(o.ref)) ? o : null
      if (o.type === 'url') return /^(https:\/\/|tel:)/.test(String(o.ref)) ? o : null
      return o.type === 'home' || o.type === 'products' ? o : null
    }
    const fixNav = (n: unknown): unknown => {
      const o = n as { label?: string; link?: unknown } | null
      return o && typeof o === 'object' && fixLink(o.link) ? { ...o, link: fixLink(o.link) } : null
    }
    const sections = (layout.sections as Record<string, unknown>[])
      .filter((x) => x && typeof x === 'object' && (mode === 'edit' || (x.type !== 'banner' && x.type !== 'gallery')))
      .map((x, i) => {
        const o: Record<string, unknown> = { ...x, id: s(x.id, 20).replace(/[^\w-]/g, '') || `a${i}` }
        if (Array.isArray(o.productIds)) o.productIds = o.productIds.filter((id) => pIds.has(String(id)))
        if (Array.isArray(o.categoryIds)) o.categoryIds = o.categoryIds.filter((id) => cIds.has(String(id)))
        if (o.categoryId && !cIds.has(String(o.categoryId))) o.categoryId = ''
        if ('cta' in o) o.cta = fixNav(o.cta)
        if ('button' in o) o.button = fixNav(o.button)
        if ('link' in o) o.link = fixLink(o.link)
        return o
      })
    const h = (layout.header ?? {}) as Record<string, unknown>
    const header = {
      ...h,
      links: (Array.isArray(h.links) ? h.links : []).map(fixNav).filter(Boolean),
      cta: fixNav(h.cta),
      announcement: h.announcement && typeof h.announcement === 'object'
        ? { ...(h.announcement as object), link: fixLink((h.announcement as { link?: unknown }).link) }
        : undefined,
    }

    await supabase.from('lh_ai_generations').insert({ kind: 'home' })
    return json({ layout: { v: 1, header, sections } })
  } catch (e) {
    const timeout = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError'
    return json({ error: timeout ? 'ai_timeout' : 'ai_failed' }, 502)
  }
})
