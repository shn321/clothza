/* Shared loading / error states in the CLOTHZA design language.
   Used wherever products now arrive over the API. */

export function ProductGridSkeleton({ count = 8 }) {
  return (
    <div
      role="status"
      aria-label="Loading products"
      className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 md:gap-6 lg:grid-cols-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col" aria-hidden="true">
          <div className="aspect-[3/4] w-full animate-pulse rounded-[4px] border border-linen bg-porcelain" />
          <div className="mx-auto mt-4 h-3 w-2/3 animate-pulse rounded-[3px] bg-linen" />
          <div className="mx-auto mt-2 h-3 w-1/2 animate-pulse rounded-[3px] bg-linen" />
        </div>
      ))}
      <span className="sr-only">Loading products…</span>
    </div>
  )
}

export function ProductInlineLoading({ label = 'Loading…' }) {
  return (
    <p role="status" aria-live="polite" className="type-small mt-8 text-center">
      {label}
    </p>
  )
}

export function ProductLoadError({ message, onRetry }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-16 text-center">
      <h2 className="type-h3">Something went wrong.</h2>
      <p className="type-body-muted">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-secondary mt-2">
          Try Again
        </button>
      )}
    </div>
  )
}
