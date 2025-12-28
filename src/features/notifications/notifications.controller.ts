import { Request, Response } from 'express';
import { asyncHandler } from '../../shared/middleware/errorHandler';
import {
  createNotificationService,
  getNotificationsService,
  getNotificationByIdService,
  markAsReadService,
  markAllAsReadService,
  deleteNotificationService,
  deleteAllNotificationsService,
} from './notifications.service';

/**
 * POST /api/notifications
 */
export const createNotificationHandler = asyncHandler(async (req: Request, res: Response) => {
    console.log('function invoked');
    
  if (!req.body || Object.keys(req.body).length === 0) {
    throw new Error('Notification payload is required');
  }

  const notification = await createNotificationService(req.body);

  if (!notification) {
    throw new Error('Failed to create notification');
  }

  res.status(201).json({
    success: true,
    message: 'Notification created successfully',
    data: notification,
  });
});

/**
 * GET /api/notifications
 */
export const getNotificationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { teacherId, isRead, limit, skip } = req.query;

  if (!teacherId) {
    throw new Error('teacherId query param is required');
  }

  const query: any = {
    teacherId: teacherId as string,
    limit: limit ? parseInt(limit as string, 10) : 20,
    skip: skip ? parseInt(skip as string, 10) : 0,
  };

  if (isRead === 'true') query.isRead = true;
  if (isRead === 'false') query.isRead = false;

  const result = await getNotificationsService(query);

  res.status(200).json({
    success: true,
    message: 'Notifications retrieved successfully',
    data: result.notifications,
    meta: {
      totalCount: result.totalCount,
      unreadCount: result.unreadCount,
      limit: result.limit,
      skip: result.skip,
    },
  });
});

/**
 * GET /api/notifications/:id
 */
export const getNotificationHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { teacherId } = req.query;

  if (!id || !teacherId) {
    throw new Error('Notification ID and teacherId are required');
  }

  const notification = await getNotificationByIdService(id, teacherId as string);

  if (!notification) {
    throw new Error('Notification not found');
  }

  res.status(200).json({
    success: true,
    message: 'Notification retrieved successfully',
    data: notification,
  });
});

/**
 * PATCH /api/notifications/:id/read
 */
export const markAsReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { teacherId } = req.body;

  if (!id || !teacherId) {
    throw new Error('Notification ID and teacherId are required');
  }

  const notification = await markAsReadService({
    notificationId: id,
    teacherId,
  });

  if (!notification) {
    throw new Error('Notification not found');
  }

  res.status(200).json({
    success: true,
    message: 'Notification marked as read',
    data: notification,
  });
});

/**
 * PATCH /api/notifications/read-all
 */
export const markAllAsReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const { teacherId } = req.body;

  if (!teacherId) {
    throw new Error('teacherId is required');
  }

  const result = await markAllAsReadService({ teacherId });

  res.status(200).json({
    success: true,
    message: result.message,
    data: { count: result.count },
  });
});

/**
 * DELETE /api/notifications/:id
 */
export const deleteNotificationHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { teacherId } = req.body;

  if (!id || !teacherId) {
    throw new Error('Notification ID and teacherId are required');
  }

  const result = await deleteNotificationService({
    notificationId: id,
    teacherId,
  });

  if (!result) {
    throw new Error('Notification not found');
  }

  res.status(200).json({
    success: true,
    message: result.message,
    data: { deletedId: result.deletedId },
  });
});

/**
 * DELETE /api/notifications
 */
export const deleteAllNotificationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { teacherId } = req.body;

  if (!teacherId) {
    throw new Error('teacherId is required');
  }

  const result = await deleteAllNotificationsService(teacherId);

  res.status(200).json({
    success: true,
    message: result.message,
    data: { count: result.count },
  });
});
