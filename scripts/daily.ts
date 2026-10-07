/**
 * Daily market-data + snapshot job, for a plain cron on the server:
 *   10 7,16 * * 1-5  cd /app && npm run job:daily
 * (07:10 KST after the US close, 16:10 KST after the KR close)
 * Alternatively call POST /api/cron/daily with the CRON_SECRET bearer token.
 */
import { prisma } from '@/server/db';
import { runDailyForAll } from '@/server/services/jobs';

runDailyForAll()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
