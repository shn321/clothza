import mongoose from 'mongoose'

/* CLOTHZA User model — authentication only (Step 12).
   Passwords are NEVER stored plaintext; only a bcrypt hash in
   `passwordHash`. The hash is excluded from queries by default
   (select: false) and must never be sent in API responses. */

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name must be at most 80 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: [254, 'Email is too long'],
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
    avatar: {
      type: String,
      default: '',
      trim: true,
    },
    /* Step 19 — email notification preference. Defaults to true so
       existing users (documents without this field) keep receiving
       mail. Transactional order/security emails are NOT gated by this
       flag (see emailService); it only governs non-transactional
       (coupon/marketing-style) messages. */
    emailNotifications: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
)

/* Safe public shape — the ONLY user representation sent to clients. */
export function toSafeUser(doc) {
  if (!doc || typeof doc !== 'object') return null
  return {
    id: String(doc._id || doc.id),
    name: doc.name,
    email: doc.email,
    role: doc.role || 'user',
    ...(doc.avatar ? { avatar: doc.avatar } : {}),
    ...(doc.createdAt ? { createdAt: doc.createdAt } : {}),
    /* Preference flag only — never credentials or secrets. Missing on
       legacy documents is treated as enabled by consumers. */
    ...(doc.emailNotifications !== undefined ? { emailNotifications: Boolean(doc.emailNotifications) } : {}),
  }
}

const User = mongoose.models.User || mongoose.model('User', userSchema)

export default User
