import mongoose from 'mongoose'

/* CLOTHZA CMS — SiteContent model.
   One document per content key (e.g. "homepage.hero", "site.footer").
   `content` is a Mixed object whose shape is validated per-key in
   utils/contentDefaults.js — never trusted blindly from the client. */

const siteContentSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, 'Content key is required'],
      unique: true,
      trim: true,
      index: true,
      maxlength: 80,
    },
    type: {
      type: String,
      default: 'section',
      trim: true,
      maxlength: 40,
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Content is required'],
      default: {},
    },
    isPublished: { type: Boolean, default: true, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

siteContentSchema.index({ updatedAt: -1 })

const SiteContent =
  mongoose.models.SiteContent || mongoose.model('SiteContent', siteContentSchema)

export default SiteContent
