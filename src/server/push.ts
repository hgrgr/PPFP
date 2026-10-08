/**
 * Web Push. The VAPID key pair comes from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
 * when set; otherwise the server makes one on first use and keeps it in
 * AppSetting, the private half encrypted with APP_ENCRYPTION_KEY.
 */
import webpush from 'web-push';
import { decryptSecret, encryptSecret } from './crypto';
import { prisma } from './db';

let keys: { publicKey: string; privateKey: string } | null = null;

export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return keys;
  }
  const rows = await prisma.appSetting.findMany({ where: { key: { in: ['vapid.public', 'vapid.private'] } } });
  const pub = rows.find((r) => r.key === 'vapid.public')?.value;
  const priv = rows.find((r) => r.key === 'vapid.private')?.value;
  if (pub && priv) {
    keys = { publicKey: pub, privateKey: decryptSecret(priv) };
    return keys;
  }
  const made = webpush.generateVAPIDKeys();
  // Two servers starting at once: the first insert wins and both read it back.
  await prisma.appSetting.createMany({
    data: [
      { key: 'vapid.public', value: made.publicKey },
      { key: 'vapid.private', value: encryptSecret(made.privateKey) },
    ],
    skipDuplicates: true,
  });
  return vapidKeys();
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Send to every subscription of the user. Gone subscriptions (404/410) are removed. Returns how many were delivered. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (!subs.length) return 0;
  const k = await vapidKeys();
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey },
        TTL: 60 * 60 * 12,
        urgency: 'high',
      });
      sent++;
      if (s.lastError) await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastError: null } });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      else await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastError: `${status ?? ''} ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) } }).catch(() => {});
    }
  }
  return sent;
}
