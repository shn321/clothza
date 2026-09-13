import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ApiError,
  createAdminProduct,
  fetchAdminMedia,
  fetchAdminProduct,
  updateAdminProduct,
} from '../../lib/api.js'

/* Shared create/edit form. Server validation is authoritative; this
   form only provides fast client-side feedback.
   - Slug auto-generates from the name until manually edited.
   - Images come from the Media Library (first image = primary);
     reorder/remove supported, plain URLs still allowed.
   - Renaming a slug keeps old /product/:slug links working (server
     keeps previous slugs). */

const EMPTY = {
  name: '',
  slug: '',
  description: '',
  price: '',
  originalPrice: '',
  discountPercentage: '',
  category: '',
  subcategory: '',
  gender: 'unisex',
  images: [],
  colors: '',
  sizes: '',
  stock: '0',
  rating: '0',
  reviewCount: '0',
  tags: '',
  isFeatured: false,
  isBestSeller: false,
  isNewArrival: false,
  isPublished: true,
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function ProductForm() {
  const { id } = useParams()
  const isEdit = Boolean(id) && id !== 'new'
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [slugTouched, setSlugTouched] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [mediaOpen, setMediaOpen] = useState(false)
  const [library, setLibrary] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const p = await fetchAdminProduct(id)
        if (cancelled) return
        setForm({
          name: p.name || '',
          slug: p.slug || '',
          description: p.description || '',
          price: p.price ?? '',
          originalPrice: p.originalPrice ?? '',
          discountPercentage: p.discountPercentage ?? '',
          category: p.category || '',
          subcategory: p.subcategory || '',
          gender: p.gender || 'unisex',
          images: Array.isArray(p.images) ? p.images : [],
          colors: (p.colors || []).join(', '),
          sizes: (p.sizes || []).join(', '),
          stock: p.stock ?? '0',
          rating: p.rating ?? '0',
          reviewCount: p.reviewCount ?? '0',
          tags: (p.tags || []).join(', '),
          isFeatured: Boolean(p.isFeatured),
          isBestSeller: Boolean(p.isBestSeller),
          isNewArrival: Boolean(p.isNewArrival),
          isPublished: p.isPublished !== false,
        })
        setSlugTouched(true)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the product.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, isEdit])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    setOk('')
  }

  function handleNameChange(value) {
    setForm((f) => ({
      ...f,
      name: value,
      ...(slugTouched ? {} : { slug: slugify(value) }),
    }))
    setOk('')
  }

  function moveImage(index, dir) {
    setForm((f) => {
      const images = [...f.images]
      const j = index + dir
      if (j < 0 || j >= images.length) return f
      const [item] = images.splice(index, 1)
      images.splice(j, 0, item)
      return { ...f, images }
    })
    setOk('')
  }

  function removeImage(index) {
    setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== index) }))
    setOk('')
  }

  async function openMediaPicker() {
    setMediaOpen(true)
    setLibraryLoading(true)
    setLibraryError('')
    try {
      const result = await fetchAdminMedia({ limit: 60 })
      setLibrary(result.items)
    } catch (err) {
      setLibraryError(err instanceof ApiError ? err.message : 'Could not load the media library.')
      setLibrary([])
    } finally {
      setLibraryLoading(false)
    }
  }

  function pickMedia(item) {
    const url = item.secureUrl || item.url
    if (!url) return
    setForm((f) => (f.images.includes(url) ? f : { ...f, images: [...f.images, url] }))
    setOk('')
  }

  function validateClient() {
    if (!form.name.trim()) return 'Product name is required.'
    if (!slugify(form.slug)) return 'Slug must contain letters or numbers.'
    const price = Number(form.price)
    if (!Number.isFinite(price) || price < 0) return 'Price must be a non-negative number.'
    if (!form.category.trim()) return 'Category is required.'
    const stock = Number(form.stock)
    if (!Number.isInteger(stock) || stock < 0) return 'Stock must be a non-negative whole number.'
    if (String(form.discountPercentage).trim() !== '') {
      const d = Number(form.discountPercentage)
      if (!Number.isFinite(d) || d < 0 || d > 100) return 'Discount must be between 0 and 100.'
    }
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return
    const clientError = validateClient()
    if (clientError) {
      setError(clientError)
      return
    }
    setSaving(true)
    setError('')
    setOk('')
    const payload = {
      name: form.name.trim(),
      slug: slugify(form.slug),
      description: form.description.trim(),
      price: Number(form.price),
      originalPrice: String(form.originalPrice).trim() === '' ? null : Number(form.originalPrice),
      discountPercentage:
        String(form.discountPercentage).trim() === '' ? null : Number(form.discountPercentage),
      category: form.category.trim().toLowerCase(),
      subcategory: form.subcategory.trim(),
      gender: form.gender,
      images: form.images.map((u) => String(u).trim()).filter(Boolean),
      colors: splitList(form.colors),
      sizes: splitList(form.sizes),
      stock: Number(form.stock),
      rating: Number(form.rating) || 0,
      reviewCount: Number(form.reviewCount) || 0,
      tags: splitList(form.tags),
      isFeatured: Boolean(form.isFeatured),
      isBestSeller: Boolean(form.isBestSeller),
      isNewArrival: Boolean(form.isNewArrival),
      isPublished: Boolean(form.isPublished),
    }
    try {
      if (isEdit) {
        await updateAdminProduct(id, payload)
        setOk('Changes saved successfully — the storefront shows the updated product.')
      } else {
        await createAdminProduct(payload)
        setOk('Product created and live on the storefront.')
      }
      window.setTimeout(() => navigate('/admin/products'), 900)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the product.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div aria-busy="true">
        <h1 className="type-h2">{isEdit ? 'Edit product' : 'New product'}</h1>
        <p className="type-body-muted mt-2">Loading…</p>
      </div>
    )
  }

  return (
    <div>
      <p className="type-small">
        <Link to="/admin/products" className="hover:underline">
          ← Products
        </Link>
      </p>
      <h1 className="type-h2 mt-1">{isEdit ? 'Edit product' : 'New product'}</h1>

      {error && (
        <div className="card mt-4 border-red-800/20 bg-red-800/5 p-4" role="alert">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}
      {ok && (
        <div className="card mt-4 border-linen bg-cream p-4" role="status">
          <p className="text-sm">{ok}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="card mt-5 grid gap-4 p-5 md:grid-cols-2">
        <label className="block">
          <span className="field-label">Name *</span>
          <input className="field-input" value={form.name} onChange={(e) => handleNameChange(e.target.value)} required maxLength={160} />
        </label>
        <label className="block">
          <span className="field-label">Slug *</span>
          <input
            className="field-input"
            value={form.slug}
            onChange={(e) => {
              set('slug', e.target.value)
              setSlugTouched(true)
            }}
            required
            placeholder="auto-generated from name"
          />
          {isEdit && (
            <span className="type-small mt-1 block">
              Renaming keeps the old product URL working automatically.
            </span>
          )}
        </label>
        <label className="block md:col-span-2">
          <span className="field-label">Description</span>
          <textarea className="field-textarea" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Price (₹) *</span>
          <input type="number" min="0" step="0.01" className="field-input" value={form.price} onChange={(e) => set('price', e.target.value)} required />
        </label>
        <label className="block">
          <span className="field-label">Original price (₹)</span>
          <input type="number" min="0" step="0.01" className="field-input" value={form.originalPrice} onChange={(e) => set('originalPrice', e.target.value)} placeholder="Optional" />
        </label>
        <label className="block">
          <span className="field-label">Discount (%)</span>
          <input type="number" min="0" max="100" step="0.1" className="field-input" value={form.discountPercentage} onChange={(e) => set('discountPercentage', e.target.value)} placeholder="Optional" />
        </label>
        <label className="block">
          <span className="field-label">Category *</span>
          <input className="field-input" value={form.category} onChange={(e) => set('category', e.target.value)} required placeholder="e.g. men" />
        </label>
        <label className="block">
          <span className="field-label">Subcategory</span>
          <input className="field-input" value={form.subcategory} onChange={(e) => set('subcategory', e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Gender</span>
          <select className="field-select" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
            <option value="men">Men</option>
            <option value="women">Women</option>
            <option value="unisex">Unisex</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">Stock *</span>
          <input type="number" min="0" step="1" className="field-input" value={form.stock} onChange={(e) => set('stock', e.target.value)} required />
        </label>
        <label className="block">
          <span className="field-label">Rating (0–5)</span>
          <input type="number" min="0" max="5" step="0.1" className="field-input" value={form.rating} onChange={(e) => set('rating', e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Review count</span>
          <input type="number" min="0" step="1" className="field-input" value={form.reviewCount} onChange={(e) => set('reviewCount', e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Colors (comma-separated)</span>
          <input className="field-input" value={form.colors} onChange={(e) => set('colors', e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Sizes (comma-separated)</span>
          <input className="field-input" value={form.sizes} onChange={(e) => set('sizes', e.target.value)} />
        </label>
        <label className="block md:col-span-2">
          <span className="field-label">Tags / badges (comma-separated)</span>
          <input className="field-input" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
        </label>

        {/* Images — media library reuse, primary-first ordering */}
        <div className="md:col-span-2">
          <span className="field-label">Images (first = primary)</span>
          {form.images.length === 0 ? (
            <p className="type-small mt-2">No images yet — choose from the media library.</p>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {form.images.map((url, i) => (
                <div key={`${url}-${i}`} className="overflow-hidden rounded-[3px] border border-linen">
                  <div className="relative">
                    <img src={url} alt={`Product image ${i + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
                    {i === 0 && (
                      <span className="absolute left-1 top-1 rounded-full bg-charcoal px-2 py-0.5 text-[11px] font-medium text-ivory">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 p-1">
                    <div className="flex gap-1">
                      <button type="button" aria-label={`Move image ${i + 1} left`} disabled={i === 0} onClick={() => moveImage(i, -1)} className="btn btn-ghost !min-h-0 px-2 py-1 text-xs disabled:opacity-40">
                        ←
                      </button>
                      <button type="button" aria-label={`Move image ${i + 1} right`} disabled={i === form.images.length - 1} onClick={() => moveImage(i, 1)} className="btn btn-ghost !min-h-0 px-2 py-1 text-xs disabled:opacity-40">
                        →
                      </button>
                    </div>
                    <button type="button" onClick={() => removeImage(i)} className="btn btn-ghost !min-h-0 px-2 py-1 text-xs text-red-800">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2">
            <button type="button" className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs" onClick={openMediaPicker}>
              Choose from Media Library
            </button>
          </div>
        </div>

        <fieldset className="flex flex-wrap gap-6 md:col-span-2">
          <legend className="field-label">Visibility & merchandising</legend>
          {[
            ['isPublished', 'Published (visible on store)'],
            ['isFeatured', 'Featured'],
            ['isBestSeller', 'Bestseller'],
            ['isNewArrival', 'New arrival'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="field-check"
                checked={Boolean(form[key])}
                onChange={(e) => set(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap justify-end gap-3 md:col-span-2">
          <Link to="/admin/products" className="btn btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </form>

      {/* Media picker dialog */}
      {mediaOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose product images from library"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/40 p-4"
          onClick={() => setMediaOpen(false)}
        >
          <div className="card max-h-[80vh] w-full max-w-2xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="type-h3">Choose images</h2>
            <p className="type-small mt-1">Click to append to the product. First image is the primary.</p>
            {libraryLoading ? (
              <p className="type-body-muted mt-3">Loading library…</p>
            ) : libraryError ? (
              <p className="text-sm text-red-800" role="alert">{libraryError}</p>
            ) : library.length === 0 ? (
              <p className="type-body-muted mt-3">Library is empty — add images in the Media Library first.</p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {library.map((item) => {
                  const url = item.secureUrl || item.url
                  const selected = form.images.includes(url)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickMedia(item)}
                      className={`group overflow-hidden rounded-[3px] border text-left ${selected ? 'border-charcoal' : 'border-linen'}`}
                      title={item.filename || url}
                    >
                      <img src={url} alt={item.altText || item.filename || 'Media'} className="aspect-square w-full object-cover" loading="lazy" />
                      <span className="type-small block truncate px-1 py-1">{selected ? '✓ Added' : item.filename || 'image'}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setMediaOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProductForm
