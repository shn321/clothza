import { Router } from 'express'
import {
  createAdminProduct,
  deleteAdminProduct,
  deleteAdminReview,
  getAdminOrder,
  getAdminProduct,
  getDashboard,
  listAdminCustomers,
  listAdminOrders,
  listAdminProducts,
  listAdminReviews,
  updateAdminOrderStatus,
  updateAdminProduct,
  updateAdminReviewStatus,
} from '../controllers/adminController.js'
import {
  getAnalyticsCategories,
  getAnalyticsCoupons,
  getAnalyticsCustomers,
  getAnalyticsOverview,
  getAnalyticsProducts,
  getAnalyticsSales,
} from '../controllers/analyticsController.js'
import {
  createAdminCoupon,
  deleteAdminCoupon,
  getAdminCoupon,
  listAdminCoupons,
  updateAdminCoupon,
} from '../controllers/couponController.js'
import { requireAdmin, requireAuth } from '../middleware/authMiddleware.js'

/* Admin API — every route requires a session AND the admin role.
   Authorization is enforced here on the backend; the frontend route
   guards are convenience only. */

const router = Router()

router.use(requireAuth, requireAdmin)

router.get('/dashboard', getDashboard)

router.get('/analytics/overview', getAnalyticsOverview)
router.get('/analytics/sales', getAnalyticsSales)
router.get('/analytics/products', getAnalyticsProducts)
router.get('/analytics/categories', getAnalyticsCategories)
router.get('/analytics/customers', getAnalyticsCustomers)
router.get('/analytics/coupons', getAnalyticsCoupons)

router.get('/products', listAdminProducts)
router.post('/products', createAdminProduct)
router.get('/products/:id', getAdminProduct)
router.patch('/products/:id', updateAdminProduct)
router.delete('/products/:id', deleteAdminProduct)

router.get('/orders', listAdminOrders)
router.get('/orders/:orderNumber', getAdminOrder)
router.patch('/orders/:orderNumber/status', updateAdminOrderStatus)

router.get('/customers', listAdminCustomers)

router.get('/reviews', listAdminReviews)
router.patch('/reviews/:id/status', updateAdminReviewStatus)
router.delete('/reviews/:id', deleteAdminReview)

router.get('/coupons', listAdminCoupons)
router.post('/coupons', createAdminCoupon)
router.get('/coupons/:id', getAdminCoupon)
router.patch('/coupons/:id', updateAdminCoupon)
router.delete('/coupons/:id', deleteAdminCoupon)

export default router
