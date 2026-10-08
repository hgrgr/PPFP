import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { vapidKeys } from '@/server/push';

export const dynamic = 'force-dynamic';

/** The VAPID public key a browser needs to subscribe. */
export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ publicKey: (await vapidKeys()).publicKey });
}
