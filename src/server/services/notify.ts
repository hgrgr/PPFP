import { prisma } from '../db';
import { pushToUser } from '../push';

export type NotificationKind = 'PRICE' | 'DRIFT' | 'TEST';

/** Put a message in the user's inbox and push it to their devices. */
export async function notify(userId: string, n: { kind: NotificationKind; title: string; body: string; url?: string }) {
  const row = await prisma.notification.create({ data: { userId, kind: n.kind, title: n.title.slice(0, 120), body: n.body.slice(0, 1000), url: n.url ?? null } });
  try {
    await pushToUser(userId, { title: n.title, body: n.body, url: n.url ?? '/alerts', tag: row.id });
  } catch (e) {
    console.error('[notify] push failed', e instanceof Error ? e.message : e);
  }
  return row;
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
