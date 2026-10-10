/**
 * Collects a linked server's notifications into the 알림함 and shows them on the phone. The
 * server watches prices every minute; the app asks when it opens, every few minutes while
 * open, and (when Android allows) in the background.
 */
import { db, getSetting, setSetting } from './db';
import { pushNotice } from './notify';
import { notifications, ServerError, type ServerLink } from './server';

let running = false;

/** New server notifications since the last check; returns how many were added. */
export async function pollServer(force = false): Promise<number> {
  const link = await getSetting<ServerLink | null>('server', null);
  if (!link || (running && !force)) return 0;
  running = true;
  try {
    const after = await getSetting<string | null>('serverNoticeAfter', null);
    const r = await notifications(link, after);
    let added = 0;
    // Oldest first, so the newest ends on top of the shade
    for (const n of [...r.notifications].reverse()) {
      if (await db.notices.get(`srv:${n.id}`)) continue;
      await pushNotice({ id: `srv:${n.id}`, kind: 'SERVER', title: n.title, body: n.body, at: n.createdAt });
      added++;
    }
    const newest = r.notifications[0]?.createdAt;
    if (newest) await setSetting('serverNoticeAfter', newest);
    await setSetting('serverPolledAt', new Date().toISOString());
    return added;
  } catch (e) {
    if (e instanceof ServerError && e.status === 401) {
      await pushNotice({ kind: 'INFO', title: '서버 연결이 끊겼습니다', body: '서버에서 이 기기를 로그아웃했거나 토큰이 만료됐습니다. 더보기 › 서버 연동에서 다시 로그인하세요.' });
      await db.settings.bulkDelete(['server', 'serverNoticeAfter']);
    }
    if (force) throw e;
    return 0;
  } finally {
    running = false;
  }
}
