/* Step 30 — clean order-status timeline for My Orders / order detail.
   Pending → Confirmed → Processing → Shipped → Delivered.
   Cancelled orders show a distinct cancelled state. Uses the existing
   CLOTHZA palette — no new design language. */

const STEPS = ['pending', 'confirmed', 'processing', 'shipped', 'delivered']

function label(status) {
  return String(status || '').charAt(0).toUpperCase() + String(status || '').slice(1)
}

function OrderStatusTimeline({ status }) {
  if (status === 'cancelled') {
    return (
      <div
        className="rounded-[3px] border border-red-800/20 bg-red-800/5 p-3 text-sm text-red-800"
        role="status"
      >
        <span className="font-medium">Cancelled.</span>{' '}
        This order was cancelled and will not be fulfilled.
      </div>
    )
  }

  const currentIndex = STEPS.indexOf(status)
  const safeIndex = currentIndex === -1 ? 0 : currentIndex

  return (
    <ol
      className="flex flex-col gap-0"
      aria-label={`Order progress: ${label(status)}`}
    >
      {STEPS.map((step, i) => {
        const done = i < safeIndex || status === 'delivered'
        const current = i === safeIndex && status !== 'delivered'
        return (
          <li key={step} className="flex gap-3">
            <span className="flex flex-col items-center" aria-hidden="true">
              <span
                className={`mt-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                  done
                    ? 'border-green-700 bg-green-700'
                    : current
                      ? 'border-charcoal bg-charcoal'
                      : 'border-linen bg-ivory'
                }`}
              >
                {done && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M1.5 5.2 4 7.5 8.5 2.5"
                      stroke="#fffdf8"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                {current && <span className="h-1.5 w-1.5 rounded-full bg-ivory" />}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={`w-px flex-1 ${i < safeIndex || status === 'delivered' ? 'bg-green-700' : 'bg-linen'}`}
                  style={{ minHeight: '14px' }}
                />
              )}
            </span>
            <span className="pb-3">
              <span
                className={`text-sm ${done || current ? 'font-medium text-charcoal' : 'text-fog'}`}
                aria-current={current ? 'step' : undefined}
              >
                {label(step)}
              </span>
              {current && <span className="type-small block">Current status</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default OrderStatusTimeline
