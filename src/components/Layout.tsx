import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const links = [
  { to: '/orders', label: 'الطلبات', icon: '📦' },
  { to: '/abandoned', label: 'الطلبات المتروكة', icon: '🛒' },
  { to: '/profit', label: 'الربح', icon: '💰' },
  { to: '/products', label: 'المنتجات', icon: '🧸' },
  { to: '/products/new', label: 'إضافة منتج', icon: '➕' },
  { to: '/ab', label: 'اختبارات A/B', icon: '🧪' },
  { to: '/delivery', label: 'أسعار التوصيل', icon: '🚚' },
  { to: '/pixels', label: 'البيكسل', icon: '📈' },
  { to: '/settings', label: 'إعدادات المتجر', icon: '⚙️' },
]

export default function Layout() {
  const { session, signOut } = useAuth()
  const [open, setOpen] = useState(false)

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.to === '/products'}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              isActive
                ? 'bg-sun-400 text-brand-900'
                : 'text-brand-100 hover:bg-white/10'
            }`
          }
        >
          <span aria-hidden>{l.icon}</span>
          {l.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-brand-900 lg:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="text-lg font-bold text-white">🧸 لايتهاوس كيدز</div>
          <div className="text-xs text-brand-100/70">لوحة الإدارة</div>
        </div>
        {nav}
        <div className="mt-auto border-t border-white/10 p-4">
          <div className="mb-2 truncate text-xs text-brand-100/70" dir="ltr">
            {session?.user.email}
          </div>
          <button
            onClick={signOut}
            className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
          >
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-brand-900 px-4 py-3 lg:hidden">
        <div className="font-bold text-white">🧸 لايتهاوس كيدز</div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white"
          aria-label="القائمة"
        >
          {open ? '✕' : '☰'}
        </button>
      </header>
      {open && (
        <div className="fixed inset-x-0 top-[52px] z-20 bg-brand-900 shadow-xl lg:hidden">
          {nav}
          <div className="border-t border-white/10 p-4">
            <button
              onClick={signOut}
              className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white"
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
