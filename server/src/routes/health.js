import { Router } from 'express'
import { getDbState, isDbConnected } from '../config/db.js'

const router = Router()

/* Health check. Reports database state only — never credentials. */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CLOTHZA API is running',
    database: getDbState(),
  })
})

/* Readiness probe (Step 21) for load balancers / deploy platforms.
   200 = serving traffic (DB connected); 503 = still starting or DB
   down. Body carries states only — no URIs, no credentials. */
router.get('/health/ready', (req, res) => {
  if (isDbConnected()) {
    return res.status(200).json({ success: true, ready: true, database: 'connected' })
  }
  return res.status(503).json({ success: false, ready: false, database: getDbState() })
})

export default router
