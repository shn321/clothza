import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, deleteAdminMedia, fetchAdminMedia, uploadAdminMedia } from '../../lib/api.js'

/* CLOTHZA admin media library — /admin/content/media.
   URL-based uploads always work; direct file uploads are stored via
   Cloudinary when configured (backend holds the secret). Deletion is
   blocked with 409 while an image is referenced by published content,
   unless the admin confirms a force delete. */

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

function MediaLibrary() {
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 24, total: 0, pages: 0 })
  const [storage, setStorage] = useState({ provider: 'url', configured: false })
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const [altText, setAltText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploadOk, setUploadOk] = useState('')
  const [copied, setCopied] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteUsage, setDeleteUsage] = useState([])
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminMedia({ q: q.trim() || undefined, page, limit: 24 })
      setItems(result.items)
      setPagination(result.pagination)
      setStorage(result.storage)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load media.')
    } finally {
      setLoading(false)
    }
  }, [q, page])

  useEffect(() => {
    load()
  }, [load])

  async function handleAddUrl(e) {
    e.preventDefault()
    if (uploading) return
    const value = url.trim()
    if (!value) {
      setUploadError('Paste an image URL first.')
      return
    }
    setUploading(true)
    setUploadError('')
    setUploadOk('')
    try {
      await uploadAdminMedia({ url: value, altText: altText.trim() })
      setUrl('')
      setAltText('')
      setUploadOk('Image added to the library.')
      setPage(1)
      await load()
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Could not add the image.')
    } finally {
      setUploading(false)
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file.')
      return
    }
    setUploading(true)
    setUploadError('')
    setUploadOk('')
    try {
      const dataUrl = await fileToDataUrl(file)
      await uploadAdminMedia({ url: dataUrl, altText: altText.trim(), filename: file.name })
      setAltText('')
      setUploadOk('Image uploaded.')
      setPage(1)
      await load()
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Could not upload the image.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function copyUrl(item) {
    const value = item.secureUrl || item.url
    try {
      await navigator.clipboard.writeText(value)
      setCopied(item.id)
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 2000)
    } catch {
      setActionError('Could not copy — select the URL manually.')
    }
  }

  async function handleDelete(force = false) {
    if (!confirmDelete || deleting) return
    setDeleting(true)
    setActionError('')
    try {
      await deleteAdminMedia(confirmDelete.id, { force })
      setConfirmDelete(null)
      setDeleteUsage([])
      await load()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Surface usage so the admin can decide about a force delete.
        const match = /used in: (.+)\./.exec(err.message)
        setDeleteUsage(match ? match[1].split(',').map((s) => s.trim()) : [])
        setActionError(err.message)
      } else {
        setActionError(err instanceof ApiError ? err.message : 'Could not delete the image.')
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-h2">Media Library</h1>
          <p className="type-body-muted mt-1">
            {pagination.total} {pagination.total === 1 ? 'image' : 'images'}
            {' · '}Storage: {storage.provider === 'cloudinary' ? 'Cloudinary' : 'Image URLs (Cloudinary not configured)'}
          </p>
        </div>
        <Link to="/admin/content" className="btn btn-secondary">
          ← Back to Content
        </Link>
      </div>

      {!storage.configured && (
        <div className="card mt-4 border border-linen bg-cream p-4">
          <p className="text-sm">
            Cloudinary is not configured — images are stored as URLs and work normally. To enable direct
            file uploads, add <code>CLOUDINARY_CLOUD_NAME</code>, <code>CLOUDINARY_API_KEY</code> and{' '}
            <code>CLOUDINARY_API_SECRET</code> to <code>server/.env</code> (backend only, never the frontend).
          </p>
        </div>
      )}

      {/* Upload */}
      <form onSubmit={handleAddUrl} className="card mt-4 grid gap-2 p-4">
        <p className="field-label">Add image</p>
        <div className="grid gap-2 md:grid-cols-[1fr_240px_auto]">
          <input
            type="text"
            className="field-input"
            placeholder="https://… image URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Image URL"
          />
          <input
            type="text"
            className="field-input"
            placeholder="Alt text"
            maxLength={300}
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            aria-label="Alt text"
          />
          <button type="submit" className="btn btn-primary" disabled={uploading}>
            {uploading ? 'Adding…' : 'Add URL'}
          </button>
        </div>
        <div>
          <label className="btn btn-secondary !min-h-0 inline-flex cursor-pointer px-3 py-1.5 text-xs">
            {uploading ? 'Uploading…' : 'Upload file…'}
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
          </label>
          {!storage.configured && (
            <span className="type-small ml-2">File uploads need Cloudinary; URL uploads always work.</span>
          )}
        </div>
        {uploadError ? <p className="text-sm text-red-800" role="alert">{uploadError}</p> : null}
        {uploadOk ? <p className="text-sm" role="status">{uploadOk}</p> : null}
      </form>

      {/* Search */}
      <div className="card mt-4 p-4">
        <label className="block max-w-sm">
          <span className="field-label">Search</span>
          <input
            type="search"
            className="field-input"
            placeholder="Filename, alt text or URL…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </label>
      </div>

      {actionError ? (
        <div className="card mt-4 border-red-800/20 bg-red-800/5 p-4" role="alert">
          <p className="text-sm text-red-800">{actionError}</p>
          {deleteUsage.length > 0 && confirmDelete ? (
            <button
              type="button"
              className="btn btn-primary mt-3 !border-red-800 !bg-red-800"
              disabled={deleting}
              onClick={() => handleDelete(true)}
            >
              {deleting ? 'Deleting…' : 'Delete anyway (force)'}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Grid */}
      <div className="card mt-4 p-4">
        {loading ? (
          <p className="type-body-muted p-2" aria-busy="true">Loading media…</p>
        ) : error ? (
          <div role="alert">
            <p className="type-body">{error}</p>
            <button type="button" className="btn btn-secondary mt-3" onClick={load}>
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="type-body-muted p-2">No images yet. Add one above.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-[3px] border border-linen">
                <img
                  src={item.secureUrl || item.url}
                  alt={item.altText || item.filename || 'Media image'}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                <div className="p-2">
                  <p className="truncate text-xs font-medium" title={item.filename || item.url}>
                    {item.filename || 'image'}
                  </p>
                  <p className="truncate text-xs text-fog" title={item.secureUrl || item.url}>
                    {(item.secureUrl || item.url).slice(0, 80)}
                  </p>
                  {item.altText ? <p className="truncate text-xs text-fog" title={item.altText}>alt: {item.altText}</p> : null}
                  <div className="mt-2 flex gap-1">
                    <button
                      type="button"
                      className="btn btn-secondary flex-1 !min-h-0 px-2 py-1 text-xs"
                      onClick={() => copyUrl(item)}
                    >
                      {copied === item.id ? 'Copied!' : 'Copy URL'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost !min-h-0 border-red-800/20 px-2 py-1 text-xs text-red-800"
                      onClick={() => {
                        setConfirmDelete(item)
                        setDeleteUsage([])
                        setActionError('')
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pagination.pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="type-small">Page {pagination.page} of {pagination.pages}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}>
              Previous
            </button>
            <button type="button" className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs" disabled={page >= pagination.pages} onClick={() => setPage((v) => v + 1)}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm image deletion"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/40 p-4"
          onClick={() => {
            if (!deleting) {
              setConfirmDelete(null)
              setDeleteUsage([])
            }
          }}
        >
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="type-h3">Delete image?</h2>
            <div className="mt-3 overflow-hidden rounded-[3px] border border-linen">
              <img src={confirmDelete.secureUrl || confirmDelete.url} alt={confirmDelete.altText || 'Image to delete'} className="aspect-video w-full object-cover" />
            </div>
            <p className="type-body-muted mt-3">
              “{confirmDelete.filename || 'image'}” will be removed from the library. Deletion is blocked
              while the image is used by published content — you will see a warning first.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-secondary" disabled={deleting} onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary !border-red-800 !bg-red-800" disabled={deleting} onClick={() => handleDelete(false)}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MediaLibrary
