import { Router } from 'express';
import {
  createNotificationHandler,
  getNotificationsHandler,
  getNotificationHandler,
  markAsReadHandler,
  markAllAsReadHandler,
  deleteNotificationHandler,
  deleteAllNotificationsHandler,
} from './notifications.controller';

const router = Router();

/**
 * Notification Routes - /api/v1/notifications
 * Real-time notification management for teachers
 */

// Bulk operations (specific routes first)
router.patch('/read-all', markAllAsReadHandler);                            // PATCH /api/v1/notifications/read-all
router.delete('/all', deleteAllNotificationsHandler);                       // DELETE /api/v1/notifications/all

// CRUD operations
router.post('/', createNotificationHandler);                                // POST /api/v1/notifications
router.get('/', getNotificationsHandler);                                   // GET /api/v1/notifications
router.get('/:id', getNotificationHandler);                                 // GET /api/v1/notifications/:id

// Individual notification actions
router.patch('/:id/read', markAsReadHandler);                               // PATCH /api/v1/notifications/:id/read

// Delete notification
router.delete('/:id', deleteNotificationHandler);

export default router;
