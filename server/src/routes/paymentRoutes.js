import { Router } from 'express'
import {
  createRazorpayOrder,
  markRazorpayFailed,
  razorpayWebhook,
  verifyRazorpayPayment,
} from '../controllers/paymentController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

/* Razorpay TEST MODE payments. Session routes require authentication
   (user from JWT); the webhook is server-to-server and authenticates
   via its HMAC signature instead. */

const router = Router()

router.post('/razorpay/order', requireAuth, createRazorpayOrder)
router.post('/razorpay/verify', requireAuth, verifyRazorpayPayment)
router.post('/razorpay/fail', requireAuth, markRazorpayFailed)
/* No session here — req.user is absent; signature is the authority. */
router.post('/razorpay/webhook', razorpayWebhook)

export default router
