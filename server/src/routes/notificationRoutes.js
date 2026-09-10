import { Router } from 'express'
import {
  clearNotifications,
  deleteNotification,
  listNotifications,
  readAllNotifications,
  readNotification,
} from '../controllers/notificationController.js'
import { requireAuth } from '../middleware/authMiddleware.js'

/* Owner notifications — every route requires authentication; the user
   is taken from the JWT session, never from request data. */

const router = Router()

router.use(requireAuth)

router.get('/', listNotifications)
router.patch('/read-all', readAllNotifications)
router.patch('/:id/read', readNotification)
router.delete('/', clearNotifications)
router.delete('/:id', deleteNotification)

export default router
