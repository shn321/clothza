import mongoose from 'mongoose'
import Notification from '../models/Notification.js'
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationService.js'

/* CLOTHZA notifications API (Step 19) — authenticated users only.
   Every query is scoped to req.user (the JWT session owner); ids from
   the URL are matched together with the owner, so one user can never
   read, modify or delete another user's notifications (strangers get
   the same 404 as a missing id — no existence leak). */

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function bad(res, status, message) {
  return res.status(status).json({ success: false, message })
}

export function serializeNotification(doc) {
  if (!doc || typeof doc !== 'object') return null
  return {
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    orderNumber: doc.orderNumber || null,
    isRead: Boolean(doc.isRead),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

/* GET /api/notifications — newest first, paginated, plus unreadCount. */
export async function listNotifications(req, res, next) {
  try {
    const page = Number.isInteger(Number(req.query.page)) && Number(req.query.page) > 0
      ? Number(req.query.page)
      : 1
    const limit = Math.min(
      Number.isInteger(Number(req.query.limit)) && Number(req.query.limit) > 0
        ? Number(req.query.limit)
        : DEFAULT_LIMIT,
      MAX_LIMIT,
    )
    const skip = (page - 1) * limit
    const unreadOnly = String(req.query.unread || '').toLowerCase() === 'true'
    const filter = { user: req.user._id }
    if (unreadOnly) filter.isRead = false
    const [total, unreadCount, docs] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ])
    return res.status(200).json({
      success: true,
      data: {
        notifications: docs.map(serializeNotification),
        unreadCount,
        pagination: { page, limit, total, pages: total === 0 ? 0 : Math.ceil(total / limit) },
      },
    })
  } catch (err) {
    return next(err)
  }
}

/* PATCH /api/notifications/read-all — mark everything read. */
export async function readAllNotifications(req, res, next) {
  try {
    const { modified } = await markAllNotificationsRead(req.user._id)
    const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false })
    return res.status(200).json({ success: true, data: { updated: modified, unreadCount } })
  } catch (err) {
    return next(err)
  }
}

/* PATCH /api/notifications/:id/read — owner only. */
export async function readNotification(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Notification not found.')
    try {
      const doc = await markNotificationRead(req.user._id, id)
      return res.status(200).json({ success: true, data: { notification: serializeNotification(doc) } })
    } catch (err) {
      return res.status(err.statusCode || 404).json({
        success: false,
        message: err.statusCode === 404 ? 'Notification not found.' : 'Could not update the notification.',
      })
    }
  } catch (err) {
    return next(err)
  }
}

/* DELETE /api/notifications/:id — owner only. */
export async function deleteNotification(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) return bad(res, 404, 'Notification not found.')
    const removed = await Notification.findOneAndDelete({ _id: id, user: req.user._id })
    if (!removed) return bad(res, 404, 'Notification not found.')
    return res.status(200).json({ success: true, message: 'Notification deleted.' })
  } catch (err) {
    return next(err)
  }
}

/* DELETE /api/notifications — clear the owner's notifications. */
export async function clearNotifications(req, res, next) {
  try {
    const res2 = await Notification.deleteMany({ user: req.user._id })
    return res.status(200).json({ success: true, data: { deleted: res2.deletedCount ?? 0 } })
  } catch (err) {
    return next(err)
  }
}
