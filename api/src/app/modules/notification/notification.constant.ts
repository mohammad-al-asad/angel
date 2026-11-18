// What a notification is about. Clients use this (together with the
// reference ids stored on the notification) to decide which screen to open.
export const NotificationType = {
  event_post_comment: 'event_post_comment', // someone commented on your post -> open eventpostId, highlight commentId
  comment_reply: 'comment_reply', // someone replied to your comment -> open eventpostId, highlight commentId / replyId
  group_invitation: 'group_invitation', // invited to join a group -> open groupId
  payment: 'payment', // payment / checkout result
  report_update: 'report_update', // admin reviewed a report you filed -> open 'My reports'
  support_update: 'support_update', // admin resolved your feedback/support message
  general: 'general', // no specific destination
} as const;

export type TNotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NOTIFICATION_TYPES = Object.values(NotificationType);
