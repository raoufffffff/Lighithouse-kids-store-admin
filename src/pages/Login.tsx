import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Button, Field, inputCls } from '../components/ui'

export default function Login() {
  const { signIn, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await signIn(email.trim(), password)
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl"
      >
        <div className="mb-6 text-center">
          <div className="text-4xl">🧸</div>
          <h1 className="mt-2 text-xl font-bold text-slate-900">لايتهاوس كيدز</h1>
          <p className="text-sm text-slate-500">تسجيل الدخول إلى لوحة الإدارة</p>
        </div>

        <div className="space-y-4">
          <Field label="البريد الإلكتروني">
            <input
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              className={inputCls}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="كلمة السر">
            <input
              type="password"
              required
              autoComplete="current-password"
              dir="ltr"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}

        <Button type="submit" loading={busy} className="mt-6 w-full">
          دخول
        </Button>
      </form>
    </div>
  )
}
