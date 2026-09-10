/* Razorpay Checkout loader (Step 15, TEST MODE).
   The gateway script is loaded on demand — never bundled, never needed
   for COD or guest demo checkout. Sensitive card/UPI details stay
   inside the Razorpay modal; this module only opens it and forwards
   the signed response for SERVER verification. */

const CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

let loadingPromise = null

export function loadRazorpayCheckout() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Online payment needs a browser.'))
  }
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (loadingPromise) return loadingPromise
  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay)
      else {
        loadingPromise = null
        reject(new Error('Could not load the payment window. Please try again or use Cash on Delivery.'))
      }
    }
    script.onerror = () => {
      loadingPromise = null
      reject(new Error('Could not load the payment window. Please try again or use Cash on Delivery.'))
    }
    document.body.appendChild(script)
  })
  return loadingPromise
}

/* Open the TEST MODE modal. `handlers`: onSuccess(response),
   onDismiss(), onError(error). Returns a close() for cleanup. */
export function openRazorpayCheckout({ keyId, amountPaise, currency, razorpayOrderId, prefill, handlers }) {
  const Razorpay = window.Razorpay
  if (!Razorpay) throw new Error('Payment window is not ready.')
  const rzp = new Razorpay({
    key: keyId,
    amount: amountPaise,
    currency: currency || 'INR',
    name: 'CLOTHZA',
    description: 'CLOTHZA purchase (test mode — no real charge)',
    order_id: razorpayOrderId,
    prefill: {
      name: prefill?.name || '',
      email: prefill?.email || '',
      contact: prefill?.contact || '',
    },
    theme: { color: '#1c1b1a' },
    modal: {
      ondismiss: () => handlers?.onDismiss?.(),
    },
    handler: (response) => handlers?.onSuccess?.(response),
  })
  rzp.on('payment.failed', (response) => handlers?.onError?.(response?.error))
  rzp.open()
  return () => {
    try {
      rzp.close()
    } catch {
      // Modal already closed.
    }
  }
}
