import mongoose from 'mongoose'

const MONGODB_HOST = process.env.MONGODB_HOST || 'mongodb'
const MONGODB_PORT = process.env.MONGODB_PORT || '27017'
const MONGODB_USERNAME = process.env.MONGODB_USERNAME || 'root'
const MONGODB_PASSWORD = process.env.MONGODB_PASSWORD || ''
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || 'hq'

const mongoUri = `mongodb://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}?authSource=admin`

export async function connectMongo(): Promise<void> {
  try {
    await mongoose.connect(mongoUri)
    console.log(`MongoDB connected to ${MONGODB_HOST}`)
  } catch (error) {
    console.error('MongoDB connection error:', error)
    throw error
  }
}

mongoose.connection.on('error', (error) => {
  console.error('MongoDB error:', error)
})

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected')
})

export default mongoose
