/* Shared order input validation (Steps 14–15) — mirrors the checkout
   form rules so COD orders and Razorpay-verified orders validate
   identically. Customer-safe messages only, suitable for API responses. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function invalid(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

export function str(value) {
  return String(value ?? '').trim()
}

export function validateCustomer(input) {
  const customer = {
    firstName: str(input?.firstName),
    lastName: str(input?.lastName),
    email: str(input?.email),
    phone: str(input?.phone),
  }
  if (!customer.firstName) throw invalid('First name is required.')
  if (!customer.lastName) throw invalid('Last name is required.')
  if (!customer.email) throw invalid('Email address is required.')
  if (!EMAIL_RE.test(customer.email)) throw invalid('Enter a valid email address.')
  const digits = customer.phone.replace(/\D/g, '')
  if (!customer.phone) throw invalid('Phone number is required.')
  if (digits.length < 7 || digits.length > 15) {
    throw invalid('Enter a valid phone number (7–15 digits).')
  }
  customer.email = customer.email.toLowerCase()
  return customer
}

export function validateShipping(input) {
  const shipping = {
    address: str(input?.address),
    apartment: str(input?.apartment),
    city: str(input?.city),
    state: str(input?.state),
    pin: str(input?.pin),
    country: str(input?.country),
  }
  if (!shipping.address) throw invalid('Address is required.')
  if (!shipping.city) throw invalid('City is required.')
  if (!shipping.state) throw invalid('State is required.')
  if (!shipping.country) throw invalid('Country is required.')
  if (!shipping.pin) throw invalid('PIN / ZIP code is required.')
  if (shipping.country === 'India') {
    if (!/^\d{6}$/.test(shipping.pin.replace(/\s/g, ''))) {
      throw invalid('Enter a valid 6-digit PIN code.')
    }
  } else if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(shipping.pin)) {
    throw invalid('Enter a valid ZIP / postal code.')
  }
  return shipping
}
