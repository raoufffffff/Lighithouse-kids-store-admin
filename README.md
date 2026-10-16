# Lighthouse Kids Store — Admin

لوحة إدارة متجر لايتهاوس كيدز (React + Vite + TypeScript + Tailwind + Supabase).

## الصفحات
- تسجيل الدخول بالبريد وكلمة السر فقط (لا يوجد تسجيل جديد؛ الحساب يجب أن يكون في جدول `lh_admins`)
- الطلبات وتفاصيل الطلب وتغيير الحالة
- المنتجات + إنشاء/تعديل المنتج (صور، متغيّرات: مقاس/لون/مخزون، فئات)
- أسعار التوصيل لـ 58 ولاية (للمنزل / للمكتب)
- البيكسل: Facebook Pixel و TikTok Pixel

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

## النشر
ملفا `vercel.json` و `public/_redirects` يتكفّلان بإعادة توجيه المسارات (SPA).
أضف `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` كمتغيرات بيئة في منصة النشر.
