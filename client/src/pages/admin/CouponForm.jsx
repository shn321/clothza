import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ApiError,
  createAdminCoupon,
  fetchAdminCoupon,
  updateAdminCoupon,
} from '../../lib/api.js'

function toDateInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

const EMPTY = {
  code: '',
  description: '',
  discountType: 'percentage',
  discountValue: '',
  minimumOrderValue: '',
  maximumDiscount: '',
  startDate: '',
  expiryDate: '',
  usageLimit: '',
  perUserLimit: '1',
  isActive: true,
  applicableCategories: '',
  applicableProducts: '',
  applicableGender: [],
}

function CouponForm() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    fetchAdminCoupon(id)
      .then((c) => {
        if (cancelled) return
        setForm({
          code: c.code || '',
          description: c.description || '',
          discountType: c.discountType || 'percentage',
          discountValue: c.discountValue ?? '',
          minimumOrderValue: c.minimumOrderValue ?? '',
          maximumDiscount: c.maximumDiscount ?? '',
          startDate: toDateInput(c.startDate),
          expiryDate: toDateInput(c.expiryDate),
          usageLimit: c.usageLimit ?? '',
          perUserLimit: c.perUserLimit ?? '1',
          isActive: Boolean(c.isActive),
          applicableCategories: (c.applicableCategories || []).join(', '),
          applicableProducts: (c.applicableProducts || []).join(', '),
          applicableGender: c.applicableGender || [],
        })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the coupon.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, isNew])

  const set = (name, value) => setForm((prev) => ({ ...prev, [name]: value }))

  function toggleGender(g) {
    setForm((prev) => ({
      ...prev,
      applicableGender: prev.applicableGender.includes(g)
        ? prev.applicableGender.filter((x) => x !== g)
        : [...prev.applicableGender, g],
    }))
  }

  function buildPayload() {
    const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean)
    const numOrUndefined = (v) => (String(v).trim() === '' ? undefined : Number(v))
    return {
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      minimumOrderValue: numOrUndefined(form.minimumOrderValue) ?? 0,
      maximumDiscount: numOrUndefined(form.maximumDiscount) ?? 0,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
      expiryDate: form.expiryDate ? new Date(form.expiryDate).toISOString() : undefined,
      usageLimit: numOrUndefined(form.usageLimit) ?? 0,
      perUserLimit: Number(form.perUserLimit) || 1,
      isActive: Boolean(form.isActive),
      applicableCategories: splitList(form.applicableCategories),
      applicableProducts: splitList(form.applicableProducts),
      applicableGender: form.applicableGender,
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload()
      if (isNew) {
        await createAdminCoupon(payload)
      } else {
        await updateAdminCoupon(id, payload)
      }
      navigate('/admin/coupons')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the coupon.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="type-body-muted" aria-busy="true">Loading coupon…</p>
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-h2">{isNew ? 'New coupon' : 'Edit coupon'}</h1>
          <p className="type-body-muted mt-1">
            {isNew ? 'Create a new promotion code.' : `Editing ${form.code || ''}`}
          </p>
        </div>
        <Link to="/admin/coupons" className="btn btn-ghost text-sm">
          ← Back to coupons
        </Link>
      </div>

      {error && (
        <div className="card mt-4 border-red-800/20 bg-red-800/5 p-4" role="alert">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="card mt-5 grid gap-4 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Code *</span>
            <input
              type="text"
              className="field-input uppercase"
              placeholder="WELCOME10"
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="field-label">Active</span>
            <select
              className="field-select"
              value={form.isActive ? 'true' : 'false'}
              onChange={(e) => set('isActive', e.target.value === 'true')}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="field-label">Description</span>
          <input
            type="text"
            className="field-input"
            placeholder="10% off for new shoppers"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Discount type *</span>
            <select
              className="field-select"
              value={form.discountType}
              onChange={(e) => set('discountType', e.target.value)}
            >
              <option value="percentage">Percentage (%)</option>
              <option value="fixed">Fixed (₹)</option>
            </select>
          </label>
          <label className="block">
            <span className="field-label">
              Discount value * {form.discountType === 'percentage' ? '(1–100)' : '(₹)'}
            </span>
            <input
              type="number"
              className="field-input"
              min={form.discountType === 'percentage' ? 1 : 0}
              max={form.discountType === 'percentage' ? 100 : undefined}
              step="any"
              value={form.discountValue}
              onChange={(e) => set('discountValue', e.target.value)}
              required
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Minimum order (₹)</span>
            <input
              type="number"
              className="field-input"
              min="0"
              step="any"
              placeholder="0"
              value={form.minimumOrderValue}
              onChange={(e) => set('minimumOrderValue', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="field-label">Maximum discount (₹, 0 = no cap)</span>
            <input
              type="number"
              className="field-input"
              min="0"
              step="any"
              placeholder="0"
              value={form.maximumDiscount}
              onChange={(e) => set('maximumDiscount', e.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Start date *</span>
            <input
              type="date"
              className="field-input"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="field-label">Expiry date *</span>
            <input
              type="date"
              className="field-input"
              value={form.expiryDate}
              onChange={(e) => set('expiryDate', e.target.value)}
              required
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="field-label">Usage limit (0 = unlimited)</span>
            <input
              type="number"
              className="field-input"
              min="0"
              step="1"
              placeholder="0"
              value={form.usageLimit}
              onChange={(e) => set('usageLimit', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="field-label">Per-user limit</span>
            <input
              type="number"
              className="field-input"
              min="1"
              step="1"
              value={form.perUserLimit}
              onChange={(e) => set('perUserLimit', e.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <span className="field-label">Applicable categories (comma-separated, blank = all)</span>
          <input
            type="text"
            className="field-input"
            placeholder="men, kurtas"
            value={form.applicableCategories}
            onChange={(e) => set('applicableCategories', e.target.value)}
          />
        </label>

        <label className="block">
          <span className="field-label">Applicable products (comma-separated ids, blank = all)</span>
          <input
            type="text"
            className="field-input"
            placeholder="Product ObjectId…"
            value={form.applicableProducts}
            onChange={(e) => set('applicableProducts', e.target.value)}
          />
        </label>

        <fieldset>
          <legend className="field-label">Applicable gender (none selected = all)</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {['men', 'women', 'unisex'].map((g) => (
              <label key={g} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="field-radio"
                  checked={form.applicableGender.includes(g)}
                  onChange={() => toggleGender(g)}
                />
                <span className="capitalize">{g}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end gap-3 pt-2">
          <Link to="/admin/coupons" className="btn btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create coupon' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default CouponForm
