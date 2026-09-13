import crypto from 'node:crypto'

/* CLOTHZA Cloudinary integration (backend only).
   Credentials come from environment variables — the secret NEVER
   reaches the frontend:

     CLOUDINARY_CLOUD_NAME=
     CLOUDINARY_API_KEY=
     CLOUDINARY_API_SECRET=

   Without credentials the CMS falls back to plain image URLs
   (documented in server/.env.example). No extra npm dependency:
   signed uploads use the Cloudinary REST API via global fetch. */

export function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  )
}

export function getMediaStorageInfo() {
  if (isCloudinaryConfigured()) {
    return {
      provider: 'cloudinary',
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      configured: true,
    }
  }
  return { provider: 'url', configured: false }
}

function signParams(params, apiSecret) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return crypto.createHash('sha1').update(sorted + apiSecret).digest('hex')
}

/* Upload a remote http(s) URL or data-URL image to Cloudinary.
   Returns { publicId, url, secureUrl, width, height } or throws. */
export async function uploadToCloudinary({ file, folder = 'clothza', filename = '' }) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured.')
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const params = { folder, timestamp }
  if (filename) params.public_id = `${folder}/${Date.now()}-${String(filename).replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60)}`
  const signature = signParams(params, apiSecret)
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', apiKey)
  form.append('timestamp', String(timestamp))
  form.append('folder', folder)
  if (params.public_id) form.append('public_id', params.public_id)
  form.append('signature', signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  })
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok || !body?.secure_url) {
    throw new Error(body?.error?.message || 'Cloudinary upload failed.')
  }
  return {
    publicId: body.public_id || null,
    url: body.url || body.secure_url,
    secureUrl: body.secure_url,
    width: body.width || 0,
    height: body.height || 0,
  }
}

/* Best-effort remote delete. Never throws — callers treat failure as
   non-fatal so DB state stays authoritative. */
export async function destroyFromCloudinary(publicId) {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME
    const apiKey = process.env.CLOUDINARY_API_KEY
    const apiSecret = process.env.CLOUDINARY_API_SECRET
    if (!cloudName || !apiKey || !apiSecret || !publicId) return false
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = signParams({ public_id: publicId, timestamp }, apiSecret)
    const form = new FormData()
    form.append('public_id', publicId)
    form.append('api_key', apiKey)
    form.append('timestamp', String(timestamp))
    form.append('signature', signature)
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
      method: 'POST',
      body: form,
    })
    return res.ok
  } catch {
    return false
  }
}
