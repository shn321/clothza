import { Router } from 'express'
import {
  addWishlistItem,
  clearWishlist,
  getWishlist,
  mergeWishlist,
  removeWishlistItem,
} from '../controllers/wishlistController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

/* Database wishlist — every route requires authentication; the user is
   taken from the JWT session, never from request data. */

const router = Router()

router.use(requireAuth)

router.get('/', getWishlist)
router.post('/items/:productId', addWishlistItem)
router.post('/merge', mergeWishlist)
router.delete('/items/:productId', removeWishlistItem)
router.delete('/', clearWishlist)

export default router
