/**
 * HQ API - Versión Simplificada
 * Solo funcionalidad esencial para gestión de tareas y agentes
 */

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { connectMongo } from './lib/mongodb.js'
import { errorHandler } from './middleware/errorHandler.js'

// Cargar variables de entorno
dotenv.config()

const app = express()
const PORT = process.env.API_PORT || 3001

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*'
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Rutas simples
import missionRoutes from './routes/missions.js'
import agentRoutes from './routes/agents.js'
import taskRoutes from './routes/tasks.js'

// Health check (sin auth)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'hq-api', timestamp: new Date().toISOString() })
})

// API Routes
app.use('/api/missions', missionRoutes)
app.use('/api/agents', agentRoutes)
app.use('/api/tasks', taskRoutes)

// Error handler
app.use(errorHandler)

// Start server
async function start() {
  try {
    // Connect to MongoDB
    await connectMongo()
    console.log('MongoDB connected')

    // Start listening
    app.listen(PORT, () => {
      console.log(`HQ API running on port ${PORT}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()
