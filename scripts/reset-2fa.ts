/**
 * Turns two-step sign-in off for one account when its phone and recovery codes are both lost.
 * Runs against the database in DATABASE_URL; whoever can run it already holds the server.
 * Signs the account out everywhere, so the next sign-in is with the password alone.
 *
 *   npm run user:reset-2fa -- me@example.com
 *
 * The Docker image carries no scripts; there, the same in SQL (README, 2단계 인증 되돌리기):
 *   docker compose exec db psql -U ppfp -d ppfp -c "UPDATE \"User\" SET \"totpSecret\" = NULL, ..."
 */
import { prisma } from '@/server/db';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('usage: npm run user:reset-2fa -- <email>');
    process.exit(2);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`no account ${email}`);
    process.exit(1);
  }
  if (!user.totpSecret && !user.totpPending) {
    console.log(`${email}: two-step sign-in is already off`);
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpPending: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
  const s = await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.auditLog.create({ data: { userId: user.id, entity: 'Security', entityId: user.id, action: '2fa.disable', after: { by: 'reset-2fa script', signedOut: s.count } } });
  console.log(`${email}: two-step sign-in turned off, ${s.count} session(s) signed out`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
