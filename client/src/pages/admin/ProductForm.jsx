import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ApiError,
  createAdminProduct,
  fetchAdminProduct,
  updateAdminProduct,
} from '../../lib/api.js'

/* Shared create/edit form. Server validation is authoritative; this
   form only provides fast client-side feedback. Comma-separated text
   inputs map to arrays (images, colors, sizes, tags). */

const EMPTY = {
  name: '',
  slug: '',
  description: '',
  price: '',
  originalPrice: '',
  category: '',
  subcategory: '',
  gender: 'unisex',
  images: '',
  colors: '',
  sizes: '',
  stock: '0',
  rating: '0',
  reviewCount: '0',
  tags: '',
  isFeatured: false,
  isBestSeller: false,
  isNewArrival: false,
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
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
          category: p.category || '',
          subcategory: p.subcategory || '',
          gender: p.gender || 'unisex',
          images: (p.images || []).join(', '),
          colors: (p.colors || []).join(', '),
          sizes: (p.sizes || []).join(', '),
          stock: p.stock ?? '0',
          rating: p.rating ?? '0',
          reviewCount: p.reviewCount ?? '0',
          tags: (p.tags || []).join(', '),
          isFeatured: Boolean(p.isFeatured),
          isBestSeller: Boolean(p.isBestSeller),
          isNewArrival: Boolean(p.isNewArrival),
        })
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
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim().toLowerCase(),
      description: form.description.trim(),
      price: Number(form.price),
      originalPrice: String(form.originalPrice).trim() === '' ? null : Number(form.originalPrice),
      category: form.category.trim().toLowerCase(),
      subcategory: form.subcategory.trim(),
      gender: form.gender,
      images: splitList(form.images),
      colors: splitList(form.colors),
      sizes: splitList(form.sizes),
      stock: Number(form.stock),
      rating: Number(form.rating),
      reviewCount: Number(form.reviewCount),
      tags: splitList(form.tags),
      isFeatured: Boolean(form.isFeatured),
      isBestSeller: Boolean(form.isBestSeller),
      isNewArrival: Boolean(form.isNewArrival),
    }
    try {
      if (isEdit) {
        await updateAdminProduct(id, payload)
      } else {
        await createAdminProduct(payload)
      }
      navigate('/admin/products')
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

      <form onSubmit={handleSubmit} className="card mt-5 grid gap-4 p-5 md:grid-cols-2">
        <label className="block">
          <span className="field-label">Name *</span>
          <input className="field-input" value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={160} />
        </label>
        <label className="block">
          <span className="field-label">Slug *</span>
          <input
            className="field-input"
            value={form.slug}
            onChange={(e) => set('slug', e.target.value)}
            required
            placeholder="e.g. ivory-linen-shirt"
          />
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
        <label className="block md:col-span-2">
          <span className="field-label">Images (comma-separated URLs or /paths)</span>
          <textarea className="field-textarea !min-h-20" value={form.images} onChange={(e) => set('images', e.target.value)} placeholder="https://…, /images/…" />
        </label>
        <label className="block">
          <span className="field-label">Colors (comma-separated)</span>
          <input className="field-input" value={form.colors} onChange={(e) => set('colors', e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Sizes (comma-separated)</span>
          <input className="field-input" value={form.sizes} onChange={(e) => set('sizes', e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Rating (0–5)</span>
          <input type="number" min="0" max="5" step="0.1" className="field-input" value={form.rating} onChange={(e) => set('rating', e.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Review count</span>
          <input type="number" min="0" step="1" className="field-input" value={form.reviewCount} onChange={(e) => set('reviewCount', e.target.value)} />
        </label>
        <label className="block md:col-span-2">
          <span className="field-label">Tags (comma-separated)</span>
          <input className="field-input" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
        </label>
        <fieldset className="flex flex-wrap gap-6 md:col-span-2">
          <legend className="field-label">Merchandising</legend>
          {[
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
    </div>
  )
}

export default ProductForm
