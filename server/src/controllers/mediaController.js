import Media from '../models/Media.js'
import SiteContent from '../models/SiteContent.js'
import {
  destroyFromCloudinary,
  getMediaStorageInfo,
  isCloudinaryConfigured,
  uploadToCloudinary,
} from '../services/cloudinaryService.js'

/* CLOTHZA CMS media API (admin writes; no binary stored in MongoDB).
   POST accepts JSON { url, altText, filename } — a remote http(s) URL,
   a site path, or an image data-URL. When Cloudinary is configured the
   backend uploads there and stores the secure URL + publicId; otherwise
   the URL is stored directly (documented fallback). */

const MAX_URL = 2048

function bad(res, status, message) {
  return res.status(status).json({ success: false, message })
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function serializeMedia(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc
  return {
    id: String(o._id),
    publicId: o.publicId || null,
    url: o.url,
    secureUrl: o.secureUrl || o.url,
    filename: o.filename || '',
    altText: o.altText || '',
    mimeType: o.mimeType || '',
    size: o.size || 0,
    width: o.width || 0,
    height: o.height || 0,
    folder: o.folder || 'clothza',
    provider: o.provider || 'url',
    createdAt: o.createdAt,
  }
}

function isValidImageRef(s) {
  if (!s || typeof s !== 'string') return false
  const t = s.trim()
  if (!t || t.length > 7_000_000) return false
  if (t.startsWith('data:image/')) return true
  return /^(https?:\/\/|\/).+/i.test(t) && t.length <= MAX_URL
}

/* GET /api/admin/media — ?q=&page=&limit= (admin). */
export async function listAdminMedia(req, res, next) {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 24))
    const q = String(req.query.q || '').trim().slice(0, 100)
    const filter = {}
    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i')
      filter.$or = [{ filename: rx }, { altText: rx }, { url: rx }]
    }
    const skip = (page - 1) * limit
    const [total, docs] = await Promise.all([
      Media.countDocuments(filter),
      Media.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ])
    return res.status(200).json({
      success: true,
      data: {
        items: docs.map(serializeMedia),
        pagination: { page, limit, total, pages: total === 0 ? 0 : Math.ceil(total / limit) },
        storage: getMediaStorageInfo(),
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/admin/media — { url, altText?, filename? } (admin). */
export async function uploadAdminMedia(req, res, next) {
  try {
    const rawUrl = String(req.body?.url ?? '').trim()
    if (!rawUrl) return bad(res, 400, 'Image URL is required.')
    if (!isValidImageRef(rawUrl)) {
      return bad(res, 400, 'Must be a valid http(s) URL, site path (/...), or image data URL.')
    }
    const altText = String(req.body?.altText ?? '').trim().slice(0, 300)
    const filename = String(req.body?.filename ?? '').trim().slice(0, 200) || 'cms-image'
    const folder = String(req.body?.folder ?? 'clothza').trim().slice(0, 100) || 'clothza'

    // Cloudinary path: upload data-URLs and remote URLs server-side so
    // the secret never leaves the backend.
    if (isCloudinaryConfigured() && (rawUrl.startsWith('data:image/') || /^https?:\/\//i.test(rawUrl))) {
      try {
        const uploaded = await uploadToCloudinary({ file: rawUrl, folder, filename })
        const created = await Media.create({
          publicId: uploaded.publicId,
          url: uploaded.url,
          secureUrl: uploaded.secureUrl,
          filename,
          altText,
          width: uploaded.width,
          height: uploaded.height,
          folder,
          provider: 'cloudinary',
          createdBy: req.user?._id || null,
        })
        return res.status(201).json({ success: true, data: serializeMedia(created) })
      } catch (err) {
        // Remote upload failed (e.g. host blocked) → fall through to
        // direct URL storage only for remote http(s) URLs, never for
        // data-URLs (too large for MongoDB as binary).
        if (rawUrl.startsWith('data:image/')) {
          return bad(res, 502, `Cloudinary upload failed: ${err?.message || 'unknown error'}`)
        }
      }
    } else if (rawUrl.startsWith('data:image/')) {
      return bad(
        res,
        400,
        'Direct image uploads need Cloudinary configured (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET). For now, paste an image URL instead.',
      )
    }

    const created = await Media.create({
      publicId: null,
      url: rawUrl,
      secureUrl: rawUrl,
      filename,
      altText,
      folder,
      provider: 'url',
      createdBy: req.user?._id || null,
    })
    return res.status(201).json({ success: true, data: serializeMedia(created) })
  } catch (err) {
    return next(err)
  }
}

/* Find content keys referencing a media item (by any stored URL/id). */
export async function findMediaUsage(media) {
  const needles = [media.url, media.secureUrl, media.publicId].filter(Boolean)
  if (needles.length === 0) return []
  const docs = await SiteContent.find({}).lean()
  const usedIn = []
  for (const d of docs) {
    let blob = ''
    try {
      blob = JSON.stringify(d.content)
    } catch {
      blob = ''
    }
    if (needles.some((n) => n && blob.includes(n))) usedIn.push(d.key)
  }
  return usedIn
}

/* DELETE /api/admin/media/:id — blocked (409) while referenced,
   unless ?force=true after an explicit admin warning. */
export async function deleteAdminMedia(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    const media = await Media.findById(id)
    if (!media) return bad(res, 404, 'Media not found.')
    const usedIn = await findMediaUsage(media)
    const force = String(req.query.force || '').toLowerCase() === 'true'
    if (usedIn.length > 0 && !force) {
      return res.status(409).json({
        success: false,
        message: `This image is currently used in: ${usedIn.join(', ')}. Remove it from that content first, or delete with force to proceed anyway.`,
        data: { usedIn },
      })
    }
    if (media.publicId && isCloudinaryConfigured()) {
      await destroyFromCloudinary(media.publicId) // best effort
    }
    await Media.deleteOne({ _id: media._id })
    return res.status(200).json({ success: true, message: 'Media deleted.' })
  } catch (err) {
    return next(err)
  }
}
