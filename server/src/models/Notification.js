import mongoose from 'mongoose'

/* CLOTHZA Notification model (Step 19) — user-owned transactional
   notifications. Every notification belongs to exactly one user
   (taken from the server session/order owner — never from request
   data). No secrets, credentials or payment details are ever stored
   here; only display-safe title/message plus an optional orderNumber
   link. */

export const NOTIFICATION_TYPES = [
  'ORDER_PLACED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'ORDER_CONFIRMED',
  'ORDER_PROCESSING',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'COUPON',
  'SYSTEM',
]

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: [true, 'Notification type is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [160, 'Title must be at most 160 characters'],
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
      maxlength: [2000, 'Message must be at most 2000 characters'],
    },
    orderNumber: { type: String, default: null, trim: true, index: true },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
)

/* Owner listing: newest first. */
notificationSchema.index({ user: 1, createdAt: -1 })
/* Unread badge/panel queries. */
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 })

const Notification =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema)

export default Notification
