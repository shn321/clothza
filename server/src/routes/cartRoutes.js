import { Router } from 'express'
import {
  addCartItem,
  clearCart,
  getCart,
  mergeCart,
  removeCartItem,
  updateCartItem,
} from '../controllers/cartController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

/* Database cart — every route requires authentication; the user is
   taken from the JWT session, never from request data. */

const router = Router()

router.use(requireAuth)

router.get('/', getCart)
router.post('/items', addCartItem)
router.post('/merge', mergeCart)
router.patch('/items/:productId', updateCartItem)
router.delete('/items/:productId', removeCartItem)
router.delete('/', clearCart)

export default router
