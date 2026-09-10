import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import adminRoutes from './routes/adminRoutes.js'
import authRoutes from './routes/authRoutes.js'
import cartRoutes from './routes/cartRoutes.js'
import couponRoutes from './routes/couponRoutes.js'
import healthRoutes from './routes/health.js'
import notificationRoutes from './routes/notificationRoutes.js'
import orderRoutes from './routes/orderRoutes.js'
import paymentRoutes from './routes/paymentRoutes.js'
import productRoutes from './routes/productRoutes.js'
import reviewRoutes from './routes/reviewRoutes.js'
import wishlistRoutes from './routes/wishlistRoutes.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { authLimiter, corsOptions, paymentLimiter, securityHeaders } from './middleware/security.js'

export function createApp() {
  const app = express()

  /* Single-proxy deployments (Render/Railway/Heroku) terminate TLS at
     the proxy — trust one hop so req.ip/secure cookies are correct. */
  app.set('trust proxy', 1)

  /* Production hardening (Step 21): secure headers first. Helmet never
     touches body parsing, so the Razorpay raw-body webhook below is
     unaffected. */
  app.disable('x-powered-by')
  app.use(securityHeaders())

  /* Razorpay webhooks authenticate via HMAC over the RAW body, so this
     path must keep the raw bytes — registered before express.json(). */
  app.use('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  /* Strict CORS: exact allowlist (CLIENT_URL, plus localhost in dev).
     Never a wildcard while credentials are required. */
  app.use(cors(corsOptions()))

  /* Rate limits on sensitive endpoints only — browsing, cart,
     analytics and webhooks are never throttled. */
  app.use('/api/auth/login', authLimiter())
  app.use('/api/auth/register', authLimiter())
  app.use('/api/payments/razorpay/order', paymentLimiter())
  app.use('/api/payments/razorpay/verify', paymentLimiter())

  app.use('/api', healthRoutes)
  app.use('/api/products', productRoutes)
  app.use('/api', reviewRoutes)
  app.use('/api/auth', authRoutes)
  app.use('/api/cart', cartRoutes)
  app.use('/api/coupons', couponRoutes)
  app.use('/api/notifications', notificationRoutes)
  app.use('/api/wishlist', wishlistRoutes)
  app.use('/api/orders', orderRoutes)
  app.use('/api/payments', paymentRoutes)
  app.use('/api/admin', adminRoutes)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
