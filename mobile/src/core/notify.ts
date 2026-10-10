/**
 * Notices: kept in the app's 알림함 and, on the phone, shown as Android notifications.
 * Without a server they appear when the app checks prices (while it is open, and when it
 * comes back to the front); a linked server watches every minute and the app collects them.
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { db, newId, nowIso } from './db';
import type { Notice } from './types';

let permission: boolean | null = null;

export async function canNotify(ask = false): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (permission !== null && !ask) return permission;
  try {
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === 'granted') return (permission = true);
    if (!ask) return (permission = false);
    const r = await LocalNotifications.requestPermissions();
    return (permission = r.display === 'granted');
  } catch {
    return (permission = false);
  }
}

/** A 31-bit id Android accepts, from our string id */
const intId = (id: string) => {
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 2_000_000_000;
};

export async function pushNotice(n: Omit<Notice, 'id' | 'at' | 'read'> & { id?: string; at?: string }) {
  const notice: Notice = { id: n.id ?? newId(), kind: n.kind, title: n.title.slice(0, 120), body: n.body.slice(0, 1000), at: n.at ?? nowIso(), read: false };
  await db.notices.put(notice);
  if (await canNotify()) {
    await LocalNotifications.schedule({ notifications: [{ id: intId(notice.id), title: notice.title, body: notice.body, extra: { notice: notice.id }, isExactNotification: false }] }).catch(() => {});
  }
  return notice;
}
