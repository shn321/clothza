import { Router } from 'express'
import { validateCoupon } from '../controllers/couponController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

/* Customer coupon API — authentication required. The backend loads the
   caller's live cart and MongoDB prices; no totals from the client are
   ever trusted. Validation never consumes usage. */

const router = Router()

router.post('/validate', requireAuth, validateCoupon)

export default router
