/* CLOTHZA transactional email templates (Step 19) — server-side only.
   Every template returns { subject, html, text }. Content is limited to
   safe order facts (names, order number, item names/quantities, totals,
   status). Card numbers, CVV, UPI ids, tokens and secrets are NEVER
   included — callers only pass the sanitized order summary. */

function formatINR(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '₹0'
  return `₹${n.toLocaleString('en-IN')}`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/* Shared branded shell — table-based for broad client support,
   single column, readable without images. */
function layout({ heading, intro, rows, closing }) {
  const rowHtml = (rows || [])
    .map(
      ({ label, value }) => `
        <tr>
          <td style="padding:8px 0;color:#8a8378;font-size:14px;">${escapeHtml(label)}</td>
          <td align="right" style="padding:8px 0;color:#1c1a17;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join('')
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f7f3ec;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="text-align:center;letter-spacing:6px;font-size:20px;color:#1c1a17;margin:0 0 8px;">CLOTHZA</p>
    <p style="text-align:center;font-size:12px;color:#8a8378;margin:0 0 24px;">Timeless essentials, delivered with care.</p>
    <div style="background:#ffffff;border:1px solid #e5ddcf;border-radius:6px;padding:28px 24px;">
      <h1 style="font-size:22px;color:#1c1a17;margin:0 0 12px;">${escapeHtml(heading)}</h1>
      <p style="font-size:15px;line-height:1.6;color:#3d3a34;margin:0 0 20px;">${escapeHtml(intro)}</p>
      ${rowHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5ddcf;margin-bottom:8px;">${rowHtml}</table>` : ''}
      <p style="font-size:14px;line-height:1.6;color:#8a8378;margin:16px 0 0;">${escapeHtml(closing)}</p>
    </div>
    <p style="text-align:center;font-size:12px;color:#8a8378;margin:20px 0 0;">This is a transactional message about your CLOTHZA order. Please do not reply to automated mail.</p>
  </div>
</body>
</html>`
}

function itemLines(items) {
  return (items || [])
    .map((l) => `${l.name} × ${l.qty} — ${formatINR(l.price * l.qty)}`)
    .join('\n')
}

/* Normalized order facts for templates. */
export function orderFacts(order) {
  const customerName = `${order?.customer?.firstName || ''} ${order?.customer?.lastName || ''}`.trim() || 'there'
  return {
    customerName,
    email: order?.customer?.email || '',
    orderNumber: order?.orderNumber || '',
    itemCount: (order?.items || []).reduce((n, l) => n + (Number(l.qty) || 0), 0),
    itemsText: itemLines(order?.items),
    subtotal: formatINR(order?.subtotal),
    discount: formatINR(order?.discount),
    shipping: Number(order?.shippingCost) === 0 ? 'Free' : formatINR(order?.shippingCost),
    total: formatINR(order?.total),
    paymentLabel: order?.paymentMethodLabel || order?.paymentMethod || '',
  }
}

export function orderPlacedEmail(order) {
  const f = orderFacts(order)
  const subject = `Your CLOTHZA order ${f.orderNumber} is confirmed`
  const rows = [
    { label: 'Order', value: f.orderNumber },
    { label: 'Items', value: String(f.itemCount) },
    { label: 'Subtotal', value: f.subtotal },
    ...(Number(order?.discount) > 0 ? [{ label: 'Coupon discount', value: `−${f.discount}` }] : []),
    { label: 'Delivery', value: f.shipping },
    { label: 'Total', value: f.total },
    { label: 'Payment', value: f.paymentLabel },
  ]
  return {
    subject,
    html: layout({
      heading: `Thank you, ${f.customerName}.`,
      intro: `Your order ${f.orderNumber} has been placed successfully. We will notify you as it moves through confirmation, shipping and delivery.`,
      rows,
      closing: 'Track progress any time from your CLOTHZA account under My Orders.',
    }),
    text: [
      `CLOTHZA — Thank you, ${f.customerName}.`,
      '',
      `Your order ${f.orderNumber} has been placed successfully.`,
      '',
      ...f.itemsText.split('\n').filter(Boolean),
      '',
      `Subtotal: ${f.subtotal}`,
      ...(Number(order?.discount) > 0 ? [`Coupon discount: −${f.discount}`] : []),
      `Delivery: ${f.shipping}`,
      `Total: ${f.total}`,
      `Payment: ${f.paymentLabel}`,
      '',
      'Track progress any time from your CLOTHZA account under My Orders.',
    ].join('\n'),
  }
}

export function paymentSuccessEmail(order) {
  const f = orderFacts(order)
  const subject = `Payment received for order ${f.orderNumber}`
  const rows = [
    { label: 'Order', value: f.orderNumber },
    { label: 'Amount paid', value: f.total },
    { label: 'Payment', value: f.paymentLabel },
  ]
  return {
    subject,
    html: layout({
      heading: 'Payment successful.',
      intro: `Hi ${f.customerName} — we have received your payment of ${f.total} for order ${f.orderNumber}. Your items are being prepared.`,
      rows,
      closing: 'A receipt is available with your order details in your CLOTHZA account.',
    }),
    text: [
      'CLOTHZA — Payment successful.',
      '',
      `Hi ${f.customerName} — we received ${f.total} for order ${f.orderNumber}.`,
      `Payment method: ${f.paymentLabel}. Your items are being prepared.`,
      '',
      'A receipt is available with your order details in your CLOTHZA account.',
    ].join('\n'),
  }
}

export function paymentFailedEmail(order) {
  const f = orderFacts(order)
  const ref = f.orderNumber ? ` for order ${f.orderNumber}` : ''
  const subject = `Payment${ref} did not go through`
  const greeting = f.customerName && f.customerName !== 'there' ? `Hi ${f.customerName} — ` : ''
  const body1 = `your payment of ${f.total}${ref} could not be completed. No amount has been charged by CLOTHZA. Please try again or choose Cash on Delivery.`
  return {
    subject,
    html: layout({
      heading: 'Payment unsuccessful.',
      intro: `${greeting}${body1}`,
      rows: [
        ...(f.orderNumber ? [{ label: 'Order', value: f.orderNumber }] : []),
        { label: 'Amount', value: f.total },
      ],
      closing: 'Your bag is saved, so you can retry checkout whenever you are ready.',
    }),
    text: [
      'CLOTHZA — Payment unsuccessful.',
      '',
      `${greeting}${body1}`,
      ...(f.orderNumber ? [`Order: ${f.orderNumber}`] : []),
      `Amount: ${f.total}`,
    ].join('\n'),
  }
}

function statusEmail(order, statusWord, introLine) {
  const f = orderFacts(order)
  const subject = `Order ${f.orderNumber}: ${statusWord}`
  return {
    subject,
    html: layout({
      heading: `Order ${statusWord.toLowerCase()}.`,
      intro: `Hi ${f.customerName} — ${introLine}`,
      rows: [
        { label: 'Order', value: f.orderNumber },
        { label: 'Items', value: String(f.itemCount) },
        { label: 'Total', value: f.total },
      ],
      closing: 'Track progress any time from your CLOTHZA account under My Orders.',
    }),
    text: [
      `CLOTHZA — Order ${statusWord.toLowerCase()}.`,
      '',
      `Hi ${f.customerName} — ${introLine}`,
      `Order: ${f.orderNumber} · Total: ${f.total}`,
      '',
      'Track progress any time from your CLOTHZA account under My Orders.',
    ].join('\n'),
  }
}

export function orderShippedEmail(order) {
  return statusEmail(
    order,
    'shipped',
    `your order ${orderFacts(order).orderNumber} is on its way. We will let you know the moment it is delivered.`,
  )
}

export function orderDeliveredEmail(order) {
  return statusEmail(
    order,
    'delivered',
    `your order ${orderFacts(order).orderNumber} has been delivered. We hope you love it — you can review your items from your account.`,
  )
}

export function orderCancelledEmail(order) {
  return statusEmail(
    order,
    'cancelled',
    `your order ${orderFacts(order).orderNumber} has been cancelled. If you paid online, any captured amount will be refunded to the original payment method.`,
  )
}
