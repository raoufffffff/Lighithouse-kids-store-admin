import { useState } from 'react'
import { Button, Field, inputCls } from './ui'
import { assetUrl } from '../lib/store'
import type { Section } from '../lib/page-content'

type Row = Record<string, string>

type FieldDef = {
  key: string
  label: string
  multiline?: boolean
  narrow?: boolean
  placeholder?: string
  ltr?: boolean
}

const MiniBtn = ({
  onClick,
  disabled,
  children,
  danger,
  label,
}: {
  onClick: () => void
  disabled?: boolean
  children: string
  danger?: boolean
  label: string
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold transition disabled:opacity-30 ${
      danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-600 hover:bg-slate-100'
    }`}
  >
    {children}
  </button>
)

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (j < 0 || j >= arr.length) return arr
  const next = arr.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function ItemsEditor<T extends Row>({
  items,
  fields,
  max,
  makeNew,
  addLabel,
  onChange,
}: {
  items: T[]
  fields: FieldDef[]
  max: number
  makeNew: () => T
  addLabel: string
  onChange: (items: T[]) => void
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">#{i + 1}</span>
            <div className="flex gap-0.5">
              <MiniBtn label="أعلى" disabled={i === 0} onClick={() => onChange(move(items, i, -1))}>
                ↑
              </MiniBtn>
              <MiniBtn label="أسفل" disabled={i === items.length - 1} onClick={() => onChange(move(items, i, 1))}>
                ↓
              </MiniBtn>
              <MiniBtn label="حذف" danger onClick={() => onChange(items.filter((_, k) => k !== i))}>
                ✕
              </MiniBtn>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {fields.map((f) => (
              <div
                key={f.key}
                className={f.narrow ? 'w-20 shrink-0' : f.multiline ? 'basis-full' : 'min-w-[10rem] flex-1'}
              >
                <Field label={f.label}>
                  {f.multiline ? (
                    <textarea
                      className={inputCls}
                      rows={2}
                      dir={f.ltr ? 'ltr' : 'auto'}
                      placeholder={f.placeholder}
                      value={item[f.key] ?? ''}
                      onChange={(e) =>
                        onChange(items.map((x, k) => (k === i ? { ...x, [f.key]: e.target.value } : x)))
                      }
                    />
                  ) : (
                    <input
                      className={inputCls}
                      dir={f.ltr ? 'ltr' : 'auto'}
                      placeholder={f.placeholder}
                      value={item[f.key] ?? ''}
                      onChange={(e) =>
                        onChange(items.map((x, k) => (k === i ? { ...x, [f.key]: e.target.value } : x)))
                      }
                    />
                  )}
                </Field>
              </div>
            ))}
          </div>
        </div>
      ))}
      {items.length < max && (
        <Button type="button" variant="secondary" onClick={() => onChange([...items, makeNew()])}>
          + {addLabel}
        </Button>
      )}
    </div>
  )
}

const TitleField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <Field label="عنوان القسم (اختياري)">
    <input className={inputCls} dir="auto" value={value} onChange={(e) => onChange(e.target.value)} />
  </Field>
)

export type SectionEditorProps = {
  section: Section
  onChange: (s: Section) => void
  upload: (files: FileList | null) => Promise<string[]>
  landingImages: string[]
  description: string | null
}

export default function SectionEditor({ section, onChange, upload, landingImages, description }: SectionEditorProps) {
  const [uploading, setUploading] = useState(false)

  switch (section.type) {
    case 'hero':
      return (
        <div className="space-y-3">
          <Field label="شارة صغيرة (اختياري)" hint="مثال: جديد · الأكثر طلباً">
            <input className={inputCls} dir="auto" value={section.badge} onChange={(e) => onChange({ ...section, badge: e.target.value })} />
          </Field>
          <Field label="العنوان الرئيسي *">
            <input className={inputCls} dir="auto" value={section.headline} onChange={(e) => onChange({ ...section, headline: e.target.value })} />
          </Field>
          <Field label="جملة تشويقية">
            <textarea className={inputCls} rows={3} dir="auto" value={section.subheadline} onChange={(e) => onChange({ ...section, subheadline: e.target.value })} />
          </Field>
        </div>
      )

    case 'text':
      return (
        <div className="space-y-3">
          <TitleField value={section.title} onChange={(v) => onChange({ ...section, title: v })} />
          <Field label="النص *">
            <textarea className={inputCls} rows={7} dir="auto" value={section.body} onChange={(e) => onChange({ ...section, body: e.target.value })} />
          </Field>
          {description?.trim() && section.body.trim() !== description.trim() && (
            <Button type="button" variant="ghost" onClick={() => onChange({ ...section, body: description.trim() })}>
              استيراد وصف المنتج الحالي
            </Button>
          )}
        </div>
      )

    case 'benefits':
      return (
        <div className="space-y-3">
          <TitleField value={section.title} onChange={(v) => onChange({ ...section, title: v })} />
          <ItemsEditor
            items={section.items}
            max={12}
            addLabel="إضافة فائدة"
            makeNew={() => ({ icon: '✨', title: '', text: '' })}
            onChange={(items) => onChange({ ...section, items })}
            fields={[
              { key: 'icon', label: 'أيقونة', narrow: true, placeholder: '🧠' },
              { key: 'title', label: 'العنوان' },
              { key: 'text', label: 'الشرح', multiline: true },
            ]}
          />
        </div>
      )

    case 'steps':
      return (
        <div className="space-y-3">
          <TitleField value={section.title} onChange={(v) => onChange({ ...section, title: v })} />
          <ItemsEditor
            items={section.items}
            max={12}
            addLabel="إضافة خطوة"
            makeNew={() => ({ title: '', text: '' })}
            onChange={(items) => onChange({ ...section, items })}
            fields={[
              { key: 'title', label: 'عنوان الخطوة' },
              { key: 'text', label: 'الشرح', multiline: true },
            ]}
          />
        </div>
      )

    case 'specs':
      return (
        <div className="space-y-3">
          <TitleField value={section.title} onChange={(v) => onChange({ ...section, title: v })} />
          <ItemsEditor
            items={section.items}
            max={20}
            addLabel="إضافة خاصية"
            makeNew={() => ({ label: '', value: '' })}
            onChange={(items) => onChange({ ...section, items })}
            fields={[
              { key: 'label', label: 'الخاصية', placeholder: 'العمر المناسب' },
              { key: 'value', label: 'القيمة', placeholder: '3 سنوات فما فوق' },
            ]}
          />
        </div>
      )

    case 'faq':
      return (
        <div className="space-y-3">
          <TitleField value={section.title} onChange={(v) => onChange({ ...section, title: v })} />
          <ItemsEditor
            items={section.items}
            max={15}
            addLabel="إضافة سؤال"
            makeNew={() => ({ q: '', a: '' })}
            onChange={(items) => onChange({ ...section, items })}
            fields={[
              { key: 'q', label: 'السؤال' },
              { key: 'a', label: 'الجواب', multiline: true },
            ]}
          />
        </div>
      )

    case 'trust':
      return (
        <ItemsEditor
          items={section.items}
          max={6}
          addLabel="إضافة شارة"
          makeNew={() => ({ icon: '✅', text: '' })}
          onChange={(items) => onChange({ ...section, items })}
          fields={[
            { key: 'icon', label: 'أيقونة', narrow: true },
            { key: 'text', label: 'النص', placeholder: 'ضمان استبدال' },
          ]}
        />
      )

    case 'images':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {section.images.map((url, i) => (
              <div key={url + i} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <img src={assetUrl(url)} alt="" className="aspect-[4/5] w-full object-cover" />
                <div className="flex justify-between border-t border-slate-100 px-1 py-0.5">
                  <div className="flex">
                    <MiniBtn label="قبل" disabled={i === 0} onClick={() => onChange({ ...section, images: move(section.images, i, -1) })}>
                      ↑
                    </MiniBtn>
                    <MiniBtn label="بعد" disabled={i === section.images.length - 1} onClick={() => onChange({ ...section, images: move(section.images, i, 1) })}>
                      ↓
                    </MiniBtn>
                  </div>
                  <MiniBtn label="حذف" danger onClick={() => onChange({ ...section, images: section.images.filter((_, k) => k !== i) })}>
                    ✕
                  </MiniBtn>
                </div>
              </div>
            ))}
            <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-600">
              <span className="text-2xl">{uploading ? '…' : '＋'}</span>
              <span>{uploading ? 'جارٍ الرفع' : 'إضافة صور'}</span>
              <input
                type="file"
                accept="image/*,.gif"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={async (e) => {
                  const files = e.target.files
                  e.target.value = ''
                  setUploading(true)
                  const added = await upload(files)
                  setUploading(false)
                  if (added.length) onChange({ ...section, images: [...section.images, ...added] })
                }}
              />
            </label>
          </div>
          {landingImages.length > 0 && section.images.join() !== landingImages.join() && (
            <Button type="button" variant="ghost" onClick={() => onChange({ ...section, images: landingImages })}>
              استيراد صور الهبوط الحالية للمنتج ({landingImages.length})
            </Button>
          )}
        </div>
      )

    case 'cta':
      return (
        <div className="space-y-3">
          <Field label="العنوان *">
            <input className={inputCls} dir="auto" value={section.headline} onChange={(e) => onChange({ ...section, headline: e.target.value })} />
          </Field>
          <Field label="نص قصير (اختياري)">
            <input className={inputCls} dir="auto" value={section.text} onChange={(e) => onChange({ ...section, text: e.target.value })} />
          </Field>
          <Field label="نص الزر">
            <input className={inputCls} dir="auto" value={section.button} onChange={(e) => onChange({ ...section, button: e.target.value })} />
          </Field>
        </div>
      )
  }
}
