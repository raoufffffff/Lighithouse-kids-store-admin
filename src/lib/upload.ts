import { PRODUCTS_BUCKET, supabase } from './supabase'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Uploads images to the public bucket under `folder/` and returns their public URLs. Errors go to `onError`. */
export async function uploadImages(files: FileList | File[] | null, folder: string, onError: (m: string) => void): Promise<string[]> {
  const out: string[] = []
  if (!files) return out
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) {
      onError(`«${file.name}» ليس صورة`)
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      onError(`«${file.name}» أكبر من 5 ميغابايت`)
      continue
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${folder}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(PRODUCTS_BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000' })
    if (error) {
      onError('فشل رفع الصورة: ' + error.message)
      continue
    }
    out.push(supabase.storage.from(PRODUCTS_BUCKET).getPublicUrl(path).data.publicUrl)
  }
  return out
}
