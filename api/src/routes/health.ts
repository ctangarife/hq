import { Router } from 'express'

const router = Router()

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hq-api',
    timestamp: new Date().toISOString()
  })
})

router.get('/ping', (req, res) => {
  res.send('pong')
})

export default router
