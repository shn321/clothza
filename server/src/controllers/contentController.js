import SiteContent from '../models/SiteContent.js'
import {
  CONTENT_KEYS,
  DEFAULT_CONTENT,
  getDefaultContent,
  isAllowedKey,
  validateContent,
} from '../utils/contentDefaults.js'

/* CLOTHZA CMS content API.
   Public reads serve published content (with DB-seeded defaults).
   Writes are admin-only (router enforces requireAuth + requireAdmin)
   and strictly validated per content key. */

function bad(res, status, message) {
  return res.status(status).json({ success: false, message })
}

function serializeContent(doc) {
  return {
    id: String(doc._id),
    key: doc.key,
    type: doc.type,
    content: doc.content,
    isPublished: doc.isPublished,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  }
}

async function ensureSeeded(key) {
  let doc = await SiteContent.findOne({ key })
  if (!doc) {
    doc = await SiteContent.create({
      key,
      type: 'section',
      content: getDefaultContent(key),
      isPublished: true,
      updatedBy: null,
    })
  }
  return doc
}

/* GET /api/content — all published sections (public). Seeds defaults
   on first call so the storefront works with zero admin action.
   Unpublished sections serve safe defaults — never draft content. */
export async function listPublicContent(req, res, next) {
  try {
    const docs = []
    for (const key of CONTENT_KEYS) {
      docs.push(await ensureSeeded(key))
    }
    return res.status(200).json({
      success: true,
      data: Object.fromEntries(
        docs.map((d) => [d.key, d.isPublished ? d.content : getDefaultContent(d.key)]),
      ),
    })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/content/:key — single section (public). */
export async function getPublicContent(req, res, next) {
  try {
    const key = String(req.params.key || '').trim()
    if (!isAllowedKey(key)) return bad(res, 404, 'Content not found.')
    const doc = await ensureSeeded(key)
    if (!doc.isPublished) {
      // Unpublished → serve safe defaults so the homepage never breaks.
      return res.status(200).json({
        success: true,
        data: { key, content: getDefaultContent(key), isPublished: false },
      })
    }
    return res.status(200).json({
      success: true,
      data: { key, content: doc.content, updatedAt: doc.updatedAt },
    })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/content — all sections incl. metadata (admin). */
export async function listAdminContent(req, res, next) {
  try {
    const docs = []
    for (const key of CONTENT_KEYS) {
      docs.push(await ensureSeeded(key))
    }
    return res.status(200).json({ success: true, data: docs.map(serializeContent) })
  } catch (err) {
    return next(err)
  }
}

/* GET /api/admin/content/:key — single section with metadata (admin). */
export async function getAdminContent(req, res, next) {
  try {
    const key = String(req.params.key || '').trim()
    if (!isAllowedKey(key)) return bad(res, 404, 'Content not found.')
    const doc = await ensureSeeded(key)
    return res.status(200).json({ success: true, data: serializeContent(doc) })
  } catch (err) {
    return next(err)
  }
}

/* PUT /api/admin/content/:key — { content, isPublished? } (admin).
   Full-object replace after strict per-key validation. Unknown fields
   are dropped by the validator. */
export async function updateAdminContent(req, res, next) {
  try {
    const key = String(req.params.key || '').trim()
    if (!isAllowedKey(key)) return bad(res, 404, 'Content not found.')
    const incoming = req.body?.content ?? req.body
    const { value, error } = validateContent(key, incoming)
    if (error) return bad(res, 400, error)
    let isPublished = true
    if (req.body?.isPublished !== undefined) {
      if (typeof req.body.isPublished !== 'boolean') {
        return bad(res, 400, 'isPublished must be true or false.')
      }
      isPublished = req.body.isPublished
    }
    const doc = await SiteContent.findOneAndUpdate(
      { key },
      {
        $set: {
          content: value,
          isPublished,
          type: 'section',
          updatedBy: req.user?._id || null,
        },
      },
      { new: true, upsert: true, runValidators: true },
    )
    return res.status(200).json({
      success: true,
      message: 'Changes saved successfully.',
      data: serializeContent(doc),
    })
  } catch (err) {
    return next(err)
  }
}

/* POST /api/admin/content/:key/reset — restore factory defaults (admin).
   Only touches the SiteContent document; products/users/orders kept. */
export async function resetAdminContent(req, res, next) {
  try {
    const key = String(req.params.key || '').trim()
    if (!isAllowedKey(key)) return bad(res, 404, 'Content not found.')
    const doc = await SiteContent.findOneAndUpdate(
      { key },
      {
        $set: {
          content: getDefaultContent(key),
          isPublished: true,
          type: 'section',
          updatedBy: req.user?._id || null,
        },
      },
      { new: true, upsert: true },
    )
    return res.status(200).json({
      success: true,
      message: 'Content reset to default.',
      data: serializeContent(doc),
    })
  } catch (err) {
    return next(err)
  }
}

export { CONTENT_KEYS, DEFAULT_CONTENT }
