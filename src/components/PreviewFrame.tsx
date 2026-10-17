import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Device = 'phone' | 'desktop'
const WIDTH: Record<Device, number> = { phone: 390, desktop: 1180 }

/**
 * Live preview: the real storefront page (/preview) in an iframe. The draft is pushed to it with
 * postMessage on every change, so nothing is saved or published to see it. The store renders it
 * with the same components visitors get.
 */
export default function PreviewFrame({
  storeUrl,
  payload,
}: {
  storeUrl: string
  payload: Record<string, unknown>
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [device, setDevice] = useState<Device>('phone')
  const [box, setBox] = useState({ w: 0, h: 0 })

  const origin = useMemo(() => {
    try {
      return new URL(storeUrl).origin
    } catch {
      return ''
    }
  }, [storeUrl])

  const send = useCallback(() => {
    if (!origin) return
    frameRef.current?.contentWindow?.postMessage({ type: 'lh-preview:data', ...payload }, origin)
  }, [origin, payload])

  // Push updates (lightly debounced while typing).
  useEffect(() => {
    const t = setTimeout(send, 120)
    return () => clearTimeout(t)
  }, [send])

  // The store asks for the draft once it has mounted.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow) return
      if ((e.data as { type?: string } | null)?.type === 'lh-preview:ready') send()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, send])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!origin) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-bold">رابط المتجر غير مضبوط</p>
        <p className="mt-1" dir="ltr">
          Set VITE_STORE_URL in .env (e.g. http://localhost:3000 while developing, or your deployed store URL).
        </p>
      </div>
    )
  }

  const dw = WIDTH[device]
  const scale = box.w > 0 ? Math.min(1, (box.w - 16) / dw) : 1
  const frameH = scale > 0 && box.h > 0 ? box.h / scale : 600

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-slate-200 p-0.5 text-sm font-semibold">
          {(['phone', 'desktop'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDevice(d)}
              className={`rounded-md px-3 py-1 transition ${
                device === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {d === 'phone' ? '📱 هاتف' : '🖥️ حاسوب'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            const f = frameRef.current
            if (f) f.src = f.src
          }}
          className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-200"
        >
          ↻ إعادة تحميل
        </button>
      </div>

      <div
        ref={boxRef}
        className="relative min-h-[420px] flex-1 overflow-hidden rounded-xl bg-slate-300/70"
        style={{ direction: 'ltr' }}
      >
        <div
          className="mx-auto mt-2 overflow-hidden bg-white shadow-xl"
          style={{
            width: dw * scale,
            height: Math.max(0, box.h - 16),
            borderRadius: device === 'phone' ? 28 * scale : 8,
            outline: device === 'phone' ? `${Math.max(3, 8 * scale)}px solid #0f172a` : undefined,
          }}
        >
          <iframe
            ref={frameRef}
            title="معاينة صفحة المنتج"
            src={`${origin}/preview`}
            onLoad={send}
            style={{
              width: dw,
              height: frameH - 16 / scale,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              border: 0,
              display: 'block',
            }}
          />
        </div>
      </div>
    </div>
  )
}
