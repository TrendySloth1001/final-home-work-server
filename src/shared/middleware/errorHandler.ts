import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

/**
 * Global error handler middleware
 * Catches all errors and sends appropriate responses
 */
export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // Log error for debugging
    console.error('Error:', {
        name: err.name,
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        path: req.path,
        method: req.method
    });

    // Handle known application errors
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: {
                name: err.name,
                message: err.message,
                ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
            }
        });
    }

    // Handle Prisma errors
    if (err.name === 'PrismaClientKnownRequestError') {
        return res.status(400).json({
            success: false,
            error: {
                name: 'DatabaseError',
                message: 'Database operation failed',
                ...(process.env.NODE_ENV === 'development' && { details: err.message })
            }
        });
    }

    // Handle validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: {
                name: 'ValidationError',
                message: err.message
            }
        });
    }

    // Handle unknown errors
    return res.status(500).json({
        success: false,
        error: {
            name: 'InternalServerError',
            message: process.env.NODE_ENV === 'production' 
                ? 'An unexpected error occurred' 
                : err.message,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        }
    });
};

/**
 * Async handler wrapper to catch promise rejections
 */
export const asyncHandler = (fn: Function) => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
