import mongoose from 'mongoose'

/* CLOTHZA CMS — Media model.
   Stores ONLY URLs / provider references, never binary image data.
   When Cloudinary is configured, `publicId` holds the Cloudinary
   public_id so the backend can delete remotely. `url`/`secureUrl`
   work as plain image URLs when Cloudinary is not configured. */

const mediaSchema = new mongoose.Schema(
  {
    publicId: { type: String, default: null, trim: true, maxlength: 300, index: true },
    url: { type: String, required: [true, 'Media URL is required'], trim: true, maxlength: 2048 },
    secureUrl: { type: String, default: '', trim: true, maxlength: 2048 },
    filename: { type: String, default: '', trim: true, maxlength: 200 },
    altText: { type: String, default: '', trim: true, maxlength: 300 },
    mimeType: { type: String, default: '', trim: true, maxlength: 100 },
    size: { type: Number, default: 0, min: 0 },
    width: { type: Number, default: 0, min: 0 },
    height: { type: Number, default: 0, min: 0 },
    folder: { type: String, default: 'clothza', trim: true, maxlength: 100, index: true },
    provider: {
      type: String,
      enum: ['cloudinary', 'url'],
      default: 'url',
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

mediaSchema.index({ createdAt: -1 })
mediaSchema.index({ filename: 1 })

const Media = mongoose.models.Media || mongoose.model('Media', mediaSchema)

export default Media
