/**
 * CANDID-053 Step 2 — 관리자/리크루터 역할 부트스트랩 CLI.
 *
 * self-signup으로는 운영자(RECRUITER/ADMIN) 승격이 **불가**하다(가입 API는 role을 항상 CANDIDATE로 강제).
 * 최초 운영자는 본 CLI로만 발급하고, 이후 ADMIN이 앱 내 역할 관리 API(Step 3)로 승격/강등한다.
 *
 * 사용:
 *   pnpm tsx scripts/admin/grant-role.ts <email> <CANDIDATE|RECRUITER|ADMIN>
 *
 * 설계:
 *   - @/lib/prisma·@/lib/audit는 `import 'server-only'`라 tsx CLI에서 throw → 자체 PrismaClient 사용 +
 *     auditLog를 직접 write(같은 트랜잭션으로 role 변경과 감사 원자화). metadata는 PII-free(role 명만).
 *   - 멱등: 이미 목표 role이면 변경/감사 없이 종료.
 */
import { PrismaClient, UserRole } from '@prisma/client';

const ROLES = ['CANDIDATE', 'RECRUITER', 'ADMIN'] as const;

function usage(message: string): never {
  console.error(`[grant-role] ${message}`);
  console.error('사용: pnpm tsx scripts/admin/grant-role.ts <email> <CANDIDATE|RECRUITER|ADMIN>');
  process.exit(1);
}

async function main(): Promise<void> {
  const [email, roleArg] = process.argv.slice(2);
  if (!email || !roleArg) usage('email과 role은 필수입니다.');

  const role = roleArg.toUpperCase();
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    usage(`role은 ${ROLES.join('|')} 중 하나여야 합니다 (입력: ${roleArg}).`);
  }
  const targetRole = role as UserRole;

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (user === null) {
      console.error(`[grant-role] 사용자를 찾을 수 없습니다: ${email}`);
      process.exit(2);
    }
    if (user.role === targetRole) {
      console.log(`[grant-role] 이미 ${targetRole} 입니다: ${email} (id=${user.id}) — 변경 없음.`);
      return;
    }

    const previousRole = user.role;
    // CANDIDATE로 내리면 REVOKE, 그 외(RECRUITER/ADMIN 부여)는 GRANT.
    const eventType = targetRole === 'CANDIDATE' ? 'ROLE_REVOKED' : 'ROLE_GRANTED';

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { role: targetRole } });
      await tx.auditLog.create({
        data: {
          eventType,
          actorUserId: null, // CLI = 시스템/운영자 수동 부트스트랩
          resourceType: 'user',
          resourceId: String(user.id),
          metadataJson: { from: previousRole, to: targetRole, via: 'cli:grant-role' },
        },
      });
    });

    console.log(`✅ [grant-role] ${email} (id=${user.id}) role ${previousRole} → ${targetRole}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[grant-role] 실패:', err instanceof Error ? err.message : err);
  process.exit(1);
});
