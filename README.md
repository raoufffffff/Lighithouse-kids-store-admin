# Lighthouse Kids Store — Admin

لوحة إدارة متجر لايتهاوس كيدز (React + Vite + TypeScript + Tailwind + Supabase).

## الصفحات
- تسجيل الدخول بالبريد وكلمة السر فقط (لا يوجد تسجيل جديد؛ الحساب يجب أن يكون في جدول `lh_admins`)
- الطلبات وتفاصيل الطلب وتغيير الحالة
- المنتجات + إنشاء/تعديل المنتج (صور، متغيّرات: مقاس/لون/مخزون، فئات)
- أسعار التوصيل لـ 58 ولاية (للمنزل / للمكتب)
- البيكسل: Facebook Pixel و TikTok Pixel
- **تصميم صفحة المنتج** (`/products/:id/page`): أقسام قابلة للترتيب (عنوان بيعي، فوائد، خطوات، مواصفات، أسئلة، شارات ثقة، صور، دعوة للطلب)، لون للصفحة، **معاينة حية** (هاتف/حاسوب) قبل النشر، حفظ مسودة، نشر، وسجل إصدارات للتراجع

## التشغيل
```bash
cp .env.example .env
npm install
npm run dev
```

## إضافة أدمين
1. أنشئ المستخدم من Supabase ← Authentication ← Users.
2. سجّله كأدمين (SQL Editor):
```sql
insert into public.lh_admins (user_id, full_name)
select id, 'Admin' from auth.users where email = 'you@example.com';
```

## قاعدة البيانات
كل الجداول ببادئة `lh_` في مشروع Supabase نفسه، مع RLS: الزائر يقرأ المنتجات المفعّلة فقط، وكل الباقي للأدمين.
الصور في حاوية التخزين `lh-products`.

## بناء صفحات المنتجات
- المحتوى يُخزَّن كبيانات منظّمة (JSON) لا كـ HTML، والمتجر يرسمه بمكوّنات جاهزة بعد تنظيفه (`normalizePageContent`).
- المسودة في `lh_products.page_draft`، والمنشور في `page_content`، والإصدارات في `lh_product_page_versions`.
- المعاينة هي صفحة `/preview` في المتجر داخل iframe، والأدمين يرسل لها المسودة عبر `postMessage` فلا يُحفظ شيء ولا يُنشر لرؤيتها. نموذج الطلب والبيكسل معطّلان فيها.
- يتطلب هجرة `supabase/migrations/*_lh_product_pages_draft_publish_versions.sql`.
- ملف `src/lib/page-content.ts` نسخة مطابقة لما في المتجر؛ عدّل الاثنين معاً.

## التوليد بالذكاء الاصطناعي (Gemini)
- الدالة `supabase/functions/lh-generate-page` (تُنشر في Supabase، `verify_jwt` مفعّل وتتحقق أنها أدمين).
- السر `GEMINI_API_KEY` في Edge Function Secrets، ويمكن تغيير النموذج بسر اختياري `GEMINI_MODEL`.
- النتيجة بيانات فقط، تُنظَّف في المتصفح وتظهر في المعاينة، ولا تُحفظ ولا تُنشر تلقائياً.
- حد 20 توليداً بالساعة (يتطلب هجرة `*_lh_ai_generations.sql`).

## النشر
ملفا `vercel.json` و `public/_redirects` يتكفّلان بإعادة توجيه المسارات (SPA).
أضف `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` كمتغيرات بيئة في منصة النشر.
