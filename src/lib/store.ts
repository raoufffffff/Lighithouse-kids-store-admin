import { supabase } from './supabase'

export const STORE_URL = ((import.meta.env.VITE_STORE_URL as string | undefined) ?? '').replace(/\/$/, '')

/**
 * Asks the storefront to rebuild its static pages. The storefront verifies the
 * admin's Supabase session token itself, so no shared secret lives in this bundle.
 * Returns true on success, false if not configured / failed.
 */
export async function refreshStore(): Promise<boolean> {
  if (!STORE_URL) return false
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return false
    const res = await fetch(`${STORE_URL}/api/revalidate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}
