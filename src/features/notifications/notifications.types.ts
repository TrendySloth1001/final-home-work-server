// Notification types

export interface CreateNotificationInput {
  teacherId: string;
  title: string;
  message: string;
}

export interface GetNotificationsQuery {
  teacherId: string;
  isRead?: boolean;
  limit?: number;
  skip?: number;
}

export interface MarkAsReadInput {
  notificationId: string;
  teacherId: string;
}

export interface MarkAllAsReadInput {
  teacherId: string;
}

export interface DeleteNotificationInput {
  notificationId: string;
  teacherId: string;
}
