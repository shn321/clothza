import { Router } from 'express'
import { cancelOrder, createOrder, getOrder, listOrders } from '../controllers/orderController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

/* Persistent orders — every route requires authentication; the user is
   taken from the JWT session, never from request data. */

const router = Router()

router.use(requireAuth)

router.post('/', createOrder)
router.get('/', listOrders)
router.get('/:orderNumber', getOrder)
router.patch('/:orderNumber/cancel', cancelOrder)

export default router
