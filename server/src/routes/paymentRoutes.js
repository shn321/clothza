import { Router } from 'express'
import {
  confirmDemoPayment,
  createDemoSession,
  failDemoPayment,
  verifyDemoPayment,
} from '../controllers/demoPaymentController.js'
import {
  createRazorpayOrder,
  markRazorpayFailed,
  razorpayWebhook,
  verifyRazorpayPayment,
} from '../controllers/paymentController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

/* Payments. Razorpay TEST MODE session routes require authentication
   (user from JWT); the webhook is server-to-server and authenticates
   via its HMAC signature instead. Step 30 adds the simulated
   DEMO online-payment flow (no real gateway): quote → confirm, all
   authenticated, all totals computed server-side. */

const router = Router()

router.post('/razorpay/order', requireAuth, createRazorpayOrder)
router.post('/razorpay/verify', requireAuth, verifyRazorpayPayment)
router.post('/razorpay/fail', requireAuth, markRazorpayFailed)
/* No session here — req.user is absent; signature is the authority. */
router.post('/razorpay/webhook', razorpayWebhook)

/* Simulated demo online payment (portfolio only — no real gateway). */
router.post('/demo/order', requireAuth, createDemoSession)
router.post('/demo/confirm', requireAuth, confirmDemoPayment)
router.post('/demo/verify', requireAuth, verifyDemoPayment)
router.post('/demo/fail', requireAuth, failDemoPayment)

export default router
