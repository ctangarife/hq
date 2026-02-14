import { Request, Response, NextFunction } from 'express'

export interface AppError extends Error {
  statusCode?: number
  isOperational?: boolean
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const statusCode = (err as AppError).statusCode || 500
  const message = err.message || 'Internal Server Error'

  console.error('Error:', {
    message,
    statusCode,
    path: req.path,
    stack: err.stack
  })

  res.status(statusCode).json({
    error: message,
    path: req.path,
    timestamp: new Date().toISOString()
  })
}
