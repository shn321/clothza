import { Router } from 'express'
import { getPublicContent, listPublicContent } from '../controllers/contentController.js'

/* Public CMS reads — no auth. Only published content is served, and
   missing documents are seeded from factory defaults so the
   storefront never breaks. */

const router = Router()

router.get('/', listPublicContent)
router.get('/:key', getPublicContent)

export default router
