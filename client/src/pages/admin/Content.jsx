import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDefaultContent } from '../../data/defaultContent.js'
import { invalidateContentCache } from '../../hooks/useSiteContent.js'
import {
  ApiError,
  fetchAdminContents,
  fetchAdminMedia,
  resetAdminContent,
  updateAdminContent,
  uploadAdminMedia,
} from '../../lib/api.js'

/* CLOTHZA admin CMS — /admin/content.
   Database-backed content management: edit → preview → save/publish.
   Every section saves independently (PUT /api/admin/content/:key) and
   resets independently (POST .../reset, with confirmation). */

const TABS = [
  { id: 'homepage', label: 'Homepage' },
  { id: 'hero', label: 'Hero Banner' },
  { id: 'sections', label: 'Homepage Sections' },
  { id: 'media', label: 'Images / Media' },
  { id: 'general', label: 'General Text' },
  { id: 'footer', label: 'Footer' },
]

const EDITABLE_KEYS = [
  'homepage.hero',
  'homepage.newArrivals',
  'homepage.collections',
  'homepage.promo',
  'homepage.values',
  'site.general',
  'site.newsletter',
  'site.footer',
  'site.pages',
]

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="type-small mt-1 block">{hint}</span> : null}
    </label>
  )
}

function TextInput({ value, onChange, placeholder, maxLength }) {
  return (
    <input
      type="text"
      className="field-input"
      value={value ?? ''}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function TextArea({ value, onChange, rows = 3, maxLength }) {
  return (
    <textarea
      className="field-input"
      rows={rows}
      value={value ?? ''}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#2b2620]"
      />
      {label}
    </label>
  )
}

function ImageField({ label, url, alt, onUrl, onAlt, onPick }) {
  return (
    <div className="rounded-[3px] border border-linen bg-cream/50 p-3">
      <p className="field-label">{label}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-[140px_1fr]">
        <div className="overflow-hidden rounded-[3px] border border-linen bg-porcelain">
          {url ? (
            <img src={url} alt={alt || label} className="aspect-square w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex aspect-square items-center justify-center p-2 text-center">
              <span className="type-small">No image</span>
            </div>
          )}
        </div>
        <div className="grid gap-2">
          <input
            type="text"
            className="field-input"
            value={url ?? ''}
            placeholder="https://… or /images/…"
            onChange={(e) => onUrl(e.target.value)}
            aria-label={`${label} URL`}
          />
          <input
            type="text"
            className="field-input"
            value={alt ?? ''}
            placeholder="Alt text (accessibility)"
            maxLength={300}
            onChange={(e) => onAlt(e.target.value)}
            aria-label={`${label} alt text`}
          />
          <div className="flex flex-wrap gap-2">
            {onPick ? (
              <button type="button" className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs" onClick={onPick}>
                Choose from library
              </button>
            ) : null}
            {url ? (
              <button
                type="button"
                className="btn btn-ghost !min-h-0 px-3 py-1.5 text-xs"
                onClick={() => onUrl('')}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionCard({ title, note, dirty, saving, saveError, saveOk, onSave, onReset, resetting, children }) {
  return (
    <section className="card p-4 md:p-5" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="type-h3">{title}</h2>
          {note ? <p className="type-small mt-1 max-w-xl">{note}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost !min-h-0 px-3 py-1.5 text-xs"
            disabled={saving || resetting}
            onClick={onReset}
          >
            {resetting ? 'Resetting…' : 'Reset to Default'}
          </button>
          <button
            type="button"
            className="btn btn-primary !min-h-0 px-4 py-1.5 text-xs"
            disabled={saving || resetting}
            onClick={onSave}
          >
            {saving ? 'Saving…' : dirty ? 'Save / Publish Changes' : 'Save / Publish'}
          </button>
        </div>
      </div>
      {saveError ? (
        <p className="mt-3 rounded-[3px] border border-red-800/20 bg-red-800/5 p-2 text-sm text-red-800" role="alert">
          {saveError}
        </p>
      ) : null}
      {saveOk ? (
        <p className="mt-3 rounded-[3px] border border-linen bg-cream p-2 text-sm" role="status">
          Changes saved successfully.
        </p>
      ) : null}
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  )
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

function Content() {
  const [tab, setTab] = useState('hero')
  const [docs, setDocs] = useState({}) // key -> content object
  const [meta, setMeta] = useState({}) // key -> { updatedAt }
  const [drafts, setDrafts] = useState({}) // key -> edited content
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(null)
  const [resetting, setResetting] = useState(null)
  const [saveError, setSaveError] = useState({})
  const [saveOk, setSaveOk] = useState({})
  const [resetKey, setResetKey] = useState(null)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [mediaTarget, setMediaTarget] = useState(null) // { key, field, altField? }
  const [library, setLibrary] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [uploadState, setUploadState] = useState({ url: '', altText: '', busy: false, error: '', ok: '' })

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const items = await fetchAdminContents()
      const d = {}
      const m = {}
      for (const item of items) {
        d[item.key] = item.content
        m[item.key] = { updatedAt: item.updatedAt, isPublished: item.isPublished }
      }
      // Guarantee every known key exists locally (offline-safe).
      for (const k of EDITABLE_KEYS) {
        if (!d[k]) d[k] = getDefaultContent(k)
      }
      setDocs(d)
      setMeta(m)
      setDrafts(JSON.parse(JSON.stringify(d)))
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load content.')
      const d = {}
      for (const k of EDITABLE_KEYS) d[k] = getDefaultContent(k)
      setDocs(d)
      setDrafts(JSON.parse(JSON.stringify(d)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function setDraft(key, patch) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
    setSaveOk((prev) => ({ ...prev, [key]: false }))
    setSaveError((prev) => ({ ...prev, [key]: '' }))
  }

  function isDirty(key) {
    return JSON.stringify(drafts[key] || {}) !== JSON.stringify(docs[key] || {})
  }

  async function handleSave(key) {
    if (saving) return
    setSaving(key)
    setSaveError((prev) => ({ ...prev, [key]: '' }))
    setSaveOk((prev) => ({ ...prev, [key]: false }))
    try {
      const saved = await updateAdminContent(key, drafts[key])
      setDocs((prev) => ({ ...prev, [key]: saved.content }))
      setDrafts((prev) => ({ ...prev, [key]: JSON.parse(JSON.stringify(saved.content)) }))
      setMeta((prev) => ({ ...prev, [key]: { updatedAt: saved.updatedAt, isPublished: saved.isPublished } }))
      setSaveOk((prev) => ({ ...prev, [key]: true }))
      invalidateContentCache(key)
    } catch (err) {
      setSaveError((prev) => ({ ...prev, [key]: err instanceof ApiError ? err.message : 'Could not save content.' }))
    } finally {
      setSaving(null)
    }
  }

  async function handleReset(key) {
    if (resetting) return
    setResetting(key)
    try {
      const saved = await resetAdminContent(key)
      setDocs((prev) => ({ ...prev, [key]: saved.content }))
      setDrafts((prev) => ({ ...prev, [key]: JSON.parse(JSON.stringify(saved.content)) }))
      setSaveOk((prev) => ({ ...prev, [key]: true }))
      invalidateContentCache(key)
    } catch (err) {
      setSaveError((prev) => ({ ...prev, [key]: err instanceof ApiError ? err.message : 'Could not reset content.' }))
    } finally {
      setResetting(null)
      setResetKey(null)
    }
  }

  async function openMediaPicker(target) {
    setMediaTarget(target)
    setMediaOpen(true)
    setLibraryLoading(true)
    try {
      const result = await fetchAdminMedia({ limit: 60 })
      setLibrary(result.items)
    } catch {
      setLibrary([])
    } finally {
      setLibraryLoading(false)
    }
  }

  function pickMedia(item) {
    if (!mediaTarget) return
    const displayUrl = item.secureUrl || item.url
    setDraft(mediaTarget.key, { [mediaTarget.field]: displayUrl })
    if (mediaTarget.altField && item.altText && !drafts[mediaTarget.key]?.[mediaTarget.altField]) {
      setDraft(mediaTarget.key, { [mediaTarget.field]: displayUrl, [mediaTarget.altField]: item.altText })
    }
    setMediaOpen(false)
    setMediaTarget(null)
  }

  async function handleLibraryUpload(e) {
    e.preventDefault()
    if (uploadState.busy) return
    const url = uploadState.url.trim()
    if (!url) {
      setUploadState((s) => ({ ...s, error: 'Paste an image URL first.' }))
      return
    }
    setUploadState((s) => ({ ...s, busy: true, error: '', ok: '' }))
    try {
      const created = await uploadAdminMedia({ url, altText: uploadState.altText.trim() })
      setLibrary((prev) => [created, ...prev])
      setUploadState({ url: '', altText: '', busy: false, error: '', ok: 'Image added to the library.' })
    } catch (err) {
      setUploadState((s) => ({ ...s, busy: false, error: err instanceof ApiError ? err.message : 'Upload failed.' }))
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadState((s) => ({ ...s, error: 'Please choose an image file.' }))
      return
    }
    setUploadState((s) => ({ ...s, busy: true, error: '', ok: '' }))
    try {
      const dataUrl = await fileToDataUrl(file)
      const created = await uploadAdminMedia({
        url: dataUrl,
        altText: uploadState.altText.trim(),
        filename: file.name,
      })
      setLibrary((prev) => [created, ...prev])
      setUploadState({ url: '', altText: '', busy: false, error: '', ok: 'Image uploaded.' })
    } catch (err) {
      setUploadState((s) => ({ ...s, busy: false, error: err instanceof ApiError ? err.message : 'Upload failed.' }))
    } finally {
      e.target.value = ''
    }
  }

  if (loading) {
    return (
      <div aria-busy="true">
        <h1 className="type-h2">Content</h1>
        <p className="type-body-muted mt-2">Loading website content…</p>
      </div>
    )
  }

  const hero = drafts['homepage.hero'] || {}
  const arrivals = drafts['homepage.newArrivals'] || {}
  const collections = drafts['homepage.collections'] || {}
  const promo = drafts['homepage.promo'] || {}
  const values = drafts['homepage.values'] || {}
  const general = drafts['site.general'] || {}
  const newsletter = drafts['site.newsletter'] || {}
  const footer = drafts['site.footer'] || {}
  const pages = drafts['site.pages'] || {}

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-h2">Content</h1>
          <p className="type-body-muted mt-1">
            Manage homepage, text and footer content. Changes go live on Save / Publish.
          </p>
        </div>
        <Link to="/admin/content/media" className="btn btn-secondary">
          Open Media Library
        </Link>
      </div>

      {loadError ? (
        <div className="card mt-4 border-red-800/20 bg-red-800/5 p-4" role="alert">
          <p className="text-sm text-red-800">{loadError} Showing local defaults — saving still works once the API is reachable.</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={load}>
            Retry
          </button>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="card mt-5 flex flex-wrap gap-1 p-2" role="tablist" aria-label="Content sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-[3px] px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-charcoal text-ivory' : 'text-charcoal/70 hover:bg-charcoal/5 hover:text-charcoal'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4">
        {tab === 'homepage' && (
          <div className="grid gap-4">
            <div className="card p-4 md:p-5">
              <h2 className="type-h3">Homepage overview</h2>
              <p className="type-small mt-1">Enable sections and jump to their editors. Disabled sections are hidden on the storefront.</p>
              <div className="mt-4 grid gap-2">
                {[
                  ['homepage.hero', 'Hero banner'],
                  ['homepage.newArrivals', 'New Arrivals'],
                  ['homepage.collections', 'Collections / categories'],
                  ['homepage.promo', 'Promotional banner'],
                  ['homepage.values', 'Brand values'],
                ].map(([key, label]) => (
                  <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-linen px-3 py-2">
                    <Toggle checked={drafts[key]?.enabled !== false} onChange={(v) => setDraft(key, { enabled: v })} label={label} />
                    <button
                      type="button"
                      className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                      disabled={saving === key}
                      onClick={() => handleSave(key)}
                    >
                      {saving === key ? 'Saving…' : isDirty(key) ? 'Save / Publish' : 'Saved'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'hero' && (
          <>
            <SectionCard
              title="Hero Banner"
              note="Controls the homepage hero: images, eyebrow, heading, description and buttons. Preview before publishing."
              dirty={isDirty('homepage.hero')}
              saving={saving === 'homepage.hero'}
              resetting={resetting === 'homepage.hero'}
              saveError={saveError['homepage.hero']}
              saveOk={saveOk['homepage.hero']}
              onSave={() => handleSave('homepage.hero')}
              onReset={() => setResetKey('homepage.hero')}
            >
              <Toggle checked={hero.enabled !== false} onChange={(v) => setDraft('homepage.hero', { enabled: v })} label="Enable hero section" />
              <div className="grid gap-3 md:grid-cols-2">
                <ImageField
                  label="Desktop hero image"
                  url={hero.image}
                  alt={hero.imageAlt}
                  onUrl={(v) => setDraft('homepage.hero', { image: v })}
                  onAlt={(v) => setDraft('homepage.hero', { imageAlt: v })}
                  onPick={() => openMediaPicker({ key: 'homepage.hero', field: 'image', altField: 'imageAlt' })}
                />
                <ImageField
                  label="Mobile hero image"
                  url={hero.mobileImage}
                  alt={hero.mobileImageAlt}
                  onUrl={(v) => setDraft('homepage.hero', { mobileImage: v })}
                  onAlt={(v) => setDraft('homepage.hero', { mobileImageAlt: v })}
                  onPick={() => openMediaPicker({ key: 'homepage.hero', field: 'mobileImage', altField: 'mobileImageAlt' })}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Eyebrow (small text)"><TextInput value={hero.eyebrow} maxLength={120} onChange={(v) => setDraft('homepage.hero', { eyebrow: v })} /></Field>
                <Field label="Main heading"><TextInput value={hero.heading} maxLength={120} onChange={(v) => setDraft('homepage.hero', { heading: v })} /></Field>
              </div>
              <Field label="Tagline"><TextInput value={hero.tagline} maxLength={120} onChange={(v) => setDraft('homepage.hero', { tagline: v })} /></Field>
              <Field label="Description"><TextArea value={hero.description} rows={3} maxLength={600} onChange={(v) => setDraft('homepage.hero', { description: v })} /></Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Primary button text"><TextInput value={hero.primaryButtonText} maxLength={80} onChange={(v) => setDraft('homepage.hero', { primaryButtonText: v })} /></Field>
                <Field label="Primary button link"><TextInput value={hero.primaryButtonLink} onChange={(v) => setDraft('homepage.hero', { primaryButtonLink: v })} placeholder="/shop?sort=newest" /></Field>
              </div>
              <Toggle checked={hero.secondaryButtonEnabled !== false} onChange={(v) => setDraft('homepage.hero', { secondaryButtonEnabled: v })} label="Show secondary button" />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Secondary button text"><TextInput value={hero.secondaryButtonText} maxLength={80} onChange={(v) => setDraft('homepage.hero', { secondaryButtonText: v })} /></Field>
                <Field label="Secondary button link"><TextInput value={hero.secondaryButtonLink} onChange={(v) => setDraft('homepage.hero', { secondaryButtonLink: v })} placeholder="/collections" /></Field>
              </div>
            </SectionCard>

            {/* Live preview card */}
            <section className="card p-4 md:p-5" aria-label="Hero preview">
              <h2 className="type-h3">Preview</h2>
              <p className="type-small mt-1">How the hero will look on the storefront (desktop layout).</p>
              <div className="mt-3 grid items-center gap-6 rounded-[3px] border border-linen bg-ivory p-4 lg:grid-cols-2">
                <div className="max-w-xl">
                  {hero.eyebrow ? <p className="type-label">{hero.eyebrow}</p> : null}
                  <p className="type-display mt-4">{hero.heading || 'CLOTHZA'}</p>
                  {hero.tagline ? <p className="type-tagline mt-3">{hero.tagline}</p> : null}
                  {hero.description ? <p className="type-body-muted mt-5 max-w-md">{hero.description}</p> : null}
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    {hero.primaryButtonText ? <span className="btn btn-primary">{hero.primaryButtonText}</span> : null}
                    {hero.secondaryButtonEnabled !== false && hero.secondaryButtonText ? (
                      <span className="btn btn-secondary">{hero.secondaryButtonText}</span>
                    ) : null}
                  </div>
                </div>
                <div className="overflow-hidden rounded-[4px] border border-linen bg-porcelain">
                  {hero.image ? (
                    <img src={hero.image} alt={hero.imageAlt || 'Hero preview'} className="aspect-[4/5] w-full object-cover" loading="lazy" />
                  ) : (
                    <p className="type-small p-6 text-center">No image selected</p>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {tab === 'sections' && (
          <>
            <SectionCard
              title="New Arrivals section"
              dirty={isDirty('homepage.newArrivals')}
              saving={saving === 'homepage.newArrivals'}
              resetting={resetting === 'homepage.newArrivals'}
              saveError={saveError['homepage.newArrivals']}
              saveOk={saveOk['homepage.newArrivals']}
              onSave={() => handleSave('homepage.newArrivals')}
              onReset={() => setResetKey('homepage.newArrivals')}
            >
              <Toggle checked={arrivals.enabled !== false} onChange={(v) => setDraft('homepage.newArrivals', { enabled: v })} label="Enable section" />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Eyebrow"><TextInput value={arrivals.eyebrow} onChange={(v) => setDraft('homepage.newArrivals', { eyebrow: v })} /></Field>
                <Field label="Heading"><TextInput value={arrivals.heading} onChange={(v) => setDraft('homepage.newArrivals', { heading: v })} /></Field>
              </div>
              <Field label="Description"><TextArea value={arrivals.description} rows={2} maxLength={600} onChange={(v) => setDraft('homepage.newArrivals', { description: v })} /></Field>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Products displayed (1–12)">
                  <input type="number" min={1} max={12} className="field-input" value={arrivals.count ?? 4} onChange={(e) => setDraft('homepage.newArrivals', { count: Number(e.target.value) })} />
                </Field>
                <Field label="View-all button text"><TextInput value={arrivals.viewAllText} onChange={(v) => setDraft('homepage.newArrivals', { viewAllText: v })} /></Field>
                <Field label="View-all link"><TextInput value={arrivals.viewAllLink} onChange={(v) => setDraft('homepage.newArrivals', { viewAllLink: v })} /></Field>
              </div>
            </SectionCard>

            <SectionCard
              title="Collections section"
              note="Category cards shown on the homepage. 1–6 cards, each with its own image, title and link."
              dirty={isDirty('homepage.collections')}
              saving={saving === 'homepage.collections'}
              resetting={resetting === 'homepage.collections'}
              saveError={saveError['homepage.collections']}
              saveOk={saveOk['homepage.collections']}
              onSave={() => handleSave('homepage.collections')}
              onReset={() => setResetKey('homepage.collections')}
            >
              <Toggle checked={collections.enabled !== false} onChange={(v) => setDraft('homepage.collections', { enabled: v })} label="Enable section" />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Eyebrow"><TextInput value={collections.eyebrow} onChange={(v) => setDraft('homepage.collections', { eyebrow: v })} /></Field>
                <Field label="Heading"><TextInput value={collections.heading} onChange={(v) => setDraft('homepage.collections', { heading: v })} /></Field>
              </div>
              <Field label="Description"><TextArea value={collections.description} rows={2} maxLength={600} onChange={(v) => setDraft('homepage.collections', { description: v })} /></Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="View-all text"><TextInput value={collections.viewAllText} onChange={(v) => setDraft('homepage.collections', { viewAllText: v })} /></Field>
                <Field label="View-all link"><TextInput value={collections.viewAllLink} onChange={(v) => setDraft('homepage.collections', { viewAllLink: v })} /></Field>
              </div>
              {(collections.cards || []).map((card, i) => (
                <div key={i} className="rounded-[3px] border border-linen p-3">
                  <div className="flex items-center justify-between">
                    <p className="field-label">Card {i + 1}</p>
                    <button
                      type="button"
                      className="btn btn-ghost !min-h-0 px-2 py-1 text-xs"
                      disabled={(collections.cards || []).length <= 1}
                      onClick={() => setDraft('homepage.collections', { cards: collections.cards.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <Field label="Title"><TextInput value={card.title} onChange={(v) => setDraft('homepage.collections', { cards: collections.cards.map((c, j) => (j === i ? { ...c, title: v } : c)) })} /></Field>
                    <Field label="Subtitle"><TextInput value={card.subtitle} onChange={(v) => setDraft('homepage.collections', { cards: collections.cards.map((c, j) => (j === i ? { ...c, subtitle: v } : c)) })} /></Field>
                  </div>
                  <Field label="Link"><TextInput value={card.link} onChange={(v) => setDraft('homepage.collections', { cards: collections.cards.map((c, j) => (j === i ? { ...c, link: v } : c)) })} /></Field>
                  <div className="mt-2">
                    <ImageField
                      label="Card image"
                      url={card.image}
                      alt={card.imageAlt}
                      onUrl={(v) => setDraft('homepage.collections', { cards: collections.cards.map((c, j) => (j === i ? { ...c, image: v } : c)) })}
                      onAlt={(v) => setDraft('homepage.collections', { cards: collections.cards.map((c, j) => (j === i ? { ...c, imageAlt: v } : c)) })}
                    />
                  </div>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                  disabled={(collections.cards || []).length >= 6}
                  onClick={() => setDraft('homepage.collections', { cards: [...(collections.cards || []), { title: 'New', subtitle: 'Explore', link: '/collections', image: '', imageAlt: '' }] })}
                >
                  + Add card
                </button>
              </div>
            </SectionCard>

            <SectionCard
              title="Promotional / banner section"
              dirty={isDirty('homepage.promo')}
              saving={saving === 'homepage.promo'}
              resetting={resetting === 'homepage.promo'}
              saveError={saveError['homepage.promo']}
              saveOk={saveOk['homepage.promo']}
              onSave={() => handleSave('homepage.promo')}
              onReset={() => setResetKey('homepage.promo')}
            >
              <Toggle checked={promo.enabled !== false} onChange={(v) => setDraft('homepage.promo', { enabled: v })} label="Enable section" />
              <div className="grid gap-3 md:grid-cols-2">
                <ImageField label="Image" url={promo.image} alt={promo.imageAlt} onUrl={(v) => setDraft('homepage.promo', { image: v })} onAlt={(v) => setDraft('homepage.promo', { imageAlt: v })} />
                <ImageField label="Mobile image" url={promo.mobileImage} alt={promo.mobileImageAlt} onUrl={(v) => setDraft('homepage.promo', { mobileImage: v })} onAlt={(v) => setDraft('homepage.promo', { mobileImageAlt: v })} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Eyebrow"><TextInput value={promo.eyebrow} onChange={(v) => setDraft('homepage.promo', { eyebrow: v })} /></Field>
                <Field label="Heading"><TextInput value={promo.heading} onChange={(v) => setDraft('homepage.promo', { heading: v })} /></Field>
              </div>
              <Field label="Description"><TextArea value={promo.description} rows={3} maxLength={800} onChange={(v) => setDraft('homepage.promo', { description: v })} /></Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Button text"><TextInput value={promo.buttonText} onChange={(v) => setDraft('homepage.promo', { buttonText: v })} /></Field>
                <Field label="Button link"><TextInput value={promo.buttonLink} onChange={(v) => setDraft('homepage.promo', { buttonLink: v })} /></Field>
              </div>
            </SectionCard>

            <SectionCard
              title="Brand values"
              dirty={isDirty('homepage.values')}
              saving={saving === 'homepage.values'}
              resetting={resetting === 'homepage.values'}
              saveError={saveError['homepage.values']}
              saveOk={saveOk['homepage.values']}
              onSave={() => handleSave('homepage.values')}
              onReset={() => setResetKey('homepage.values')}
            >
              <Toggle checked={values.enabled !== false} onChange={(v) => setDraft('homepage.values', { enabled: v })} label="Enable section" />
              <Field label="Eyebrow"><TextInput value={values.eyebrow} onChange={(v) => setDraft('homepage.values', { eyebrow: v })} /></Field>
              {(values.items || []).map((item, i) => (
                <div key={i} className="grid gap-2 rounded-[3px] border border-linen p-3 md:grid-cols-[80px_1fr_2fr_auto]">
                  <Field label="Index"><TextInput value={item.index} onChange={(v) => setDraft('homepage.values', { items: values.items.map((c, j) => (j === i ? { ...c, index: v } : c)) })} /></Field>
                  <Field label="Title"><TextInput value={item.title} onChange={(v) => setDraft('homepage.values', { items: values.items.map((c, j) => (j === i ? { ...c, title: v } : c)) })} /></Field>
                  <Field label="Text"><TextInput value={item.text} onChange={(v) => setDraft('homepage.values', { items: values.items.map((c, j) => (j === i ? { ...c, text: v } : c)) })} /></Field>
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="btn btn-ghost !min-h-0 px-2 py-1 text-xs"
                      disabled={(values.items || []).length <= 1}
                      onClick={() => setDraft('homepage.values', { items: values.items.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs"
                  disabled={(values.items || []).length >= 4}
                  onClick={() => setDraft('homepage.values', { items: [...(values.items || []), { index: `0${(values.items || []).length + 1}`, title: 'New value', text: '' }] })}
                >
                  + Add value
                </button>
              </div>
            </SectionCard>
          </>
        )}

        {tab === 'media' && (
          <div className="card p-4 md:p-5">
            <h2 className="type-h3">Images / Media</h2>
            <p className="type-small mt-1">Upload images, copy their URLs into any section, or manage the full library.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/admin/content/media" className="btn btn-primary !min-h-0 px-4 py-2 text-xs">
                Open Media Library
              </Link>
            </div>
            <form onSubmit={handleLibraryUpload} className="mt-4 grid gap-2 rounded-[3px] border border-linen p-3">
              <p className="field-label">Quick add by URL</p>
              <input type="text" className="field-input" placeholder="https://… image URL" value={uploadState.url} onChange={(e) => setUploadState((s) => ({ ...s, url: e.target.value }))} />
              <input type="text" className="field-input" placeholder="Alt text" maxLength={300} value={uploadState.altText} onChange={(e) => setUploadState((s) => ({ ...s, altText: e.target.value }))} />
              {uploadState.error ? <p className="text-sm text-red-800" role="alert">{uploadState.error}</p> : null}
              {uploadState.ok ? <p className="text-sm" role="status">{uploadState.ok}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className="btn btn-secondary !min-h-0 px-3 py-1.5 text-xs" disabled={uploadState.busy}>
                  {uploadState.busy ? 'Adding…' : 'Add to library'}
                </button>
                <label className="btn btn-ghost !min-h-0 cursor-pointer px-3 py-1.5 text-xs">
                  Upload file…
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
            </form>
          </div>
        )}

        {tab === 'general' && (
          <>
            <SectionCard
              title="General website text"
              note="Tagline, help texts and shared copy used across the site."
              dirty={isDirty('site.general')}
              saving={saving === 'site.general'}
              resetting={resetting === 'site.general'}
              saveError={saveError['site.general']}
              saveOk={saveOk['site.general']}
              onSave={() => handleSave('site.general')}
              onReset={() => setResetKey('site.general')}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Site tagline"><TextInput value={general.tagline} onChange={(v) => setDraft('site.general', { tagline: v })} /></Field>
                <Field label="Homepage intro text"><TextInput value={general.introText} onChange={(v) => setDraft('site.general', { introText: v })} /></Field>
              </div>
              <Field label="Shipping text"><TextArea value={general.shippingText} rows={2} maxLength={1000} onChange={(v) => setDraft('site.general', { shippingText: v })} /></Field>
              <Field label="Returns text"><TextArea value={general.returnsText} rows={2} maxLength={1000} onChange={(v) => setDraft('site.general', { returnsText: v })} /></Field>
              <Field label="Customer care text"><TextArea value={general.customerCareText} rows={2} maxLength={1000} onChange={(v) => setDraft('site.general', { customerCareText: v })} /></Field>
              <Field label="FAQ intro"><TextArea value={general.faqIntro} rows={2} maxLength={1000} onChange={(v) => setDraft('site.general', { faqIntro: v })} /></Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="About heading"><TextInput value={general.aboutHeading} onChange={(v) => setDraft('site.general', { aboutHeading: v })} /></Field>
                <Field label="Contact heading"><TextInput value={general.contactHeading} onChange={(v) => setDraft('site.general', { contactHeading: v })} /></Field>
              </div>
              <Field label="About text"><TextArea value={general.aboutText} rows={3} maxLength={1000} onChange={(v) => setDraft('site.general', { aboutText: v })} /></Field>
              <Field label="Contact text"><TextArea value={general.contactText} rows={3} maxLength={1000} onChange={(v) => setDraft('site.general', { contactText: v })} /></Field>
            </SectionCard>

            <SectionCard
              title="Newsletter"
              dirty={isDirty('site.newsletter')}
              saving={saving === 'site.newsletter'}
              resetting={resetting === 'site.newsletter'}
              saveError={saveError['site.newsletter']}
              saveOk={saveOk['site.newsletter']}
              onSave={() => handleSave('site.newsletter')}
              onReset={() => setResetKey('site.newsletter')}
            >
              <Toggle checked={newsletter.enabled !== false} onChange={(v) => setDraft('site.newsletter', { enabled: v })} label="Enable newsletter section" />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Eyebrow"><TextInput value={newsletter.eyebrow} onChange={(v) => setDraft('site.newsletter', { eyebrow: v })} /></Field>
                <Field label="Heading"><TextInput value={newsletter.heading} onChange={(v) => setDraft('site.newsletter', { heading: v })} /></Field>
              </div>
              <Field label="Description"><TextArea value={newsletter.description} rows={2} maxLength={600} onChange={(v) => setDraft('site.newsletter', { description: v })} /></Field>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Placeholder"><TextInput value={newsletter.placeholder} onChange={(v) => setDraft('site.newsletter', { placeholder: v })} /></Field>
                <Field label="Button text"><TextInput value={newsletter.buttonText} onChange={(v) => setDraft('site.newsletter', { buttonText: v })} /></Field>
                <Field label="Success message"><TextInput value={newsletter.successMessage} onChange={(v) => setDraft('site.newsletter', { successMessage: v })} /></Field>
              </div>
            </SectionCard>

            <SectionCard
              title="Info pages (About / Contact / Shipping / Returns / FAQ)"
              dirty={isDirty('site.pages')}
              saving={saving === 'site.pages'}
              resetting={resetting === 'site.pages'}
              saveError={saveError['site.pages']}
              saveOk={saveOk['site.pages']}
              onSave={() => handleSave('site.pages')}
              onReset={() => setResetKey('site.pages')}
            >
              {['about', 'contact', 'shipping', 'returns', 'faq'].map((p) => (
                <div key={p} className="grid gap-2 rounded-[3px] border border-linen p-3 md:grid-cols-3">
                  <Field label={`${p} eyebrow`}><TextInput value={pages[`${p}Eyebrow`]} onChange={(v) => setDraft('site.pages', { [`${p}Eyebrow`]: v })} /></Field>
                  <Field label={`${p} title`}><TextInput value={pages[`${p}Title`]} onChange={(v) => setDraft('site.pages', { [`${p}Title`]: v })} /></Field>
                  <Field label={`${p} note`}><TextInput value={pages[`${p}Note`]} onChange={(v) => setDraft('site.pages', { [`${p}Note`]: v })} /></Field>
                </div>
              ))}
            </SectionCard>
          </>
        )}

        {tab === 'footer' && (
          <SectionCard
            title="Footer"
            note="Brand text, link columns, social URLs and copyright. Navigation keeps working — empty columns are hidden."
            dirty={isDirty('site.footer')}
            saving={saving === 'site.footer'}
            resetting={resetting === 'site.footer'}
            saveError={saveError['site.footer']}
            saveOk={saveOk['site.footer']}
            onSave={() => handleSave('site.footer')}
            onReset={() => setResetKey('site.footer')}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Brand name"><TextInput value={footer.brandName} onChange={(v) => setDraft('site.footer', { brandName: v })} /></Field>
              <Field label="Tagline"><TextInput value={footer.tagline} onChange={(v) => setDraft('site.footer', { tagline: v })} /></Field>
            </div>
            <Field label="Brand description"><TextArea value={footer.description} rows={2} maxLength={600} onChange={(v) => setDraft('site.footer', { description: v })} /></Field>
            <Field label="Newsletter heading"><TextInput value={footer.newsletterHeading} onChange={(v) => setDraft('site.footer', { newsletterHeading: v })} /></Field>
            <Field label="Newsletter description"><TextArea value={footer.newsletterDescription} rows={2} maxLength={600} onChange={(v) => setDraft('site.footer', { newsletterDescription: v })} /></Field>
            {[
              ['customerCareLinks', 'Customer Care links'],
              ['companyLinks', 'Company links'],
              ['shopLinks', 'Shop links'],
            ].map(([listKey, label]) => (
              <div key={listKey} className="rounded-[3px] border border-linen p-3">
                <p className="field-label">{label} (max 10)</p>
                <div className="mt-2 grid gap-2">
                  {(footer[listKey] || []).map((l, i) => (
                    <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <TextInput value={l.label} placeholder="Label" onChange={(v) => setDraft('site.footer', { [listKey]: footer[listKey].map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
                      <TextInput value={l.to} placeholder="/link" onChange={(v) => setDraft('site.footer', { [listKey]: footer[listKey].map((x, j) => (j === i ? { ...x, to: v } : x)) })} />
                      <button
                        type="button"
                        className="btn btn-ghost !min-h-0 px-2 py-1 text-xs"
                        onClick={() => setDraft('site.footer', { [listKey]: footer[listKey].filter((_, j) => j !== i) })}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary mt-2 !min-h-0 px-3 py-1.5 text-xs"
                  disabled={(footer[listKey] || []).length >= 10}
                  onClick={() => setDraft('site.footer', { [listKey]: [...(footer[listKey] || []), { label: 'New link', to: '/' }] })}
                >
                  + Add link
                </button>
              </div>
            ))}
            <div className="rounded-[3px] border border-linen p-3">
              <p className="field-label">Social URLs (max 8)</p>
              <div className="mt-2 grid gap-2">
                {(footer.socialLinks || []).map((l, i) => (
                  <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
                    <TextInput value={l.label} placeholder="Instagram" onChange={(v) => setDraft('site.footer', { socialLinks: footer.socialLinks.map((x, j) => (j === i ? { ...x, label: v } : x)) })} />
                    <TextInput value={l.href} placeholder="https://…" onChange={(v) => setDraft('site.footer', { socialLinks: footer.socialLinks.map((x, j) => (j === i ? { ...x, href: v } : x)) })} />
                    <button
                      type="button"
                      className="btn btn-ghost !min-h-0 px-2 py-1 text-xs"
                      onClick={() => setDraft('site.footer', { socialLinks: footer.socialLinks.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-secondary mt-2 !min-h-0 px-3 py-1.5 text-xs"
                disabled={(footer.socialLinks || []).length >= 8}
                onClick={() => setDraft('site.footer', { socialLinks: [...(footer.socialLinks || []), { label: 'Instagram', href: '#' }] })}
              >
                + Add social link
              </button>
            </div>
            <Field label="Copyright text"><TextInput value={footer.copyrightText} onChange={(v) => setDraft('site.footer', { copyrightText: v })} /></Field>
            {meta['site.footer']?.updatedAt ? (
              <p className="type-small">Last updated: {new Date(meta['site.footer'].updatedAt).toLocaleString('en-IN')}</p>
            ) : null}
          </SectionCard>
        )}
      </div>

      {/* Media picker dialog */}
      {mediaOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose image from library"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/40 p-4"
          onClick={() => setMediaOpen(false)}
        >
          <div className="card max-h-[80vh] w-full max-w-2xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="type-h3">Choose image</h2>
            {libraryLoading ? (
              <p className="type-body-muted mt-3">Loading library…</p>
            ) : library.length === 0 ? (
              <p className="type-body-muted mt-3">
                Library is empty. <Link to="/admin/content/media" className="underline">Open the Media Library</Link> to upload first.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {library.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => pickMedia(item)}
                    className="group overflow-hidden rounded-[3px] border border-linen text-left"
                    title={item.filename || item.url}
                  >
                    <img src={item.secureUrl || item.url} alt={item.altText || item.filename || 'Media'} className="aspect-square w-full object-cover" loading="lazy" />
                    <span className="type-small block truncate px-1 py-1">{item.filename || 'image'}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setMediaOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation */}
      {resetKey && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm reset to default"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/40 p-4"
          onClick={() => {
            if (!resetting) setResetKey(null)
          }}
        >
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="type-h3">Reset to Default?</h2>
            <p className="type-body-muted mt-2">
              “{resetKey}” will be restored to the original CLOTHZA content. Only this section is affected —
              products, users and orders are never touched. This cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="btn btn-secondary" disabled={Boolean(resetting)} onClick={() => setResetKey(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary !border-red-800 !bg-red-800" disabled={Boolean(resetting)} onClick={() => handleReset(resetKey)}>
                {resetting ? 'Resetting…' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Content
