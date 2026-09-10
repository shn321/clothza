/* Small status pill shared by the account order list and order detail.
   Uses the existing CLOTHZA palette — no new design language. */

const STATUS_STYLES = {
  pending: 'border-linen bg-cream text-charcoal',
  confirmed: 'border-linen bg-parchment text-charcoal',
  processing: 'border-linen bg-parchment text-charcoal',
  shipped: 'border-bronze/40 bg-cream text-bronze-deep',
  delivered: 'border-green-700/30 bg-green-700/5 text-green-800',
  cancelled: 'border-red-800/20 bg-red-800/5 text-red-800',
}

const STATUS_DOT = {
  pending: 'bg-fog',
  confirmed: 'bg-bronze',
  processing: 'bg-bronze',
  shipped: 'bg-bronze-deep',
  delivered: 'bg-green-700',
  cancelled: 'bg-red-800',
}

function OrderStatusBadge({ status }) {
  const key = STATUS_STYLES[status] ? status : 'pending'
  const label = String(status || 'pending').charAt(0).toUpperCase() + String(status || 'pending').slice(1)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[key]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[key]}`} />
      {label}
    </span>
  )
}

export default OrderStatusBadge
