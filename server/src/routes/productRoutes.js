import { Router } from 'express'
import { getProductBySlug, listProducts } from '../controllers/productController.js'

const router = Router()

router.get('/', listProducts)
router.get('/:slug', getProductBySlug)

export default router
