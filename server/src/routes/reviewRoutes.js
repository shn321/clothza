import { Router } from 'express'
import {
  createProductReview,
  deleteReview,
  getReviewEligibility,
  listProductReviews,
  updateReview,
} from '../controllers/reviewController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

/* Product reviews — reads are public; everything else is session
   authenticated with ownership enforced in the controller. Mounted
   at /api (see app.js) so product-scoped paths stay RESTful. */

const router = Router()

router.get('/products/:productId/reviews', listProductReviews)
router.get('/products/:productId/reviews/eligibility', requireAuth, getReviewEligibility)
router.post('/products/:productId/reviews', requireAuth, createProductReview)

router.patch('/reviews/:id', requireAuth, updateReview)
router.delete('/reviews/:id', requireAuth, deleteReview)

export default router
