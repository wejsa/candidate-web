import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // CANDID-002에서 required로 격상 — Prisma client가 부팅 시 DATABASE_URL 필요.
  // 로컬은 docker-compose db 서비스, 운영은 관리형 PostgreSQL 연결 문자열.
  // .env.example의 CHANGE_ME placeholder를 그대로 두면 부팅 차단(약한 자격증명 사고 방지).
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (url) => !/CHANGE_ME|REPLACE_ME|TODO/i.test(url),
      'DATABASE_URL contains placeholder — set actual credentials before startup',
    ),

  // CANDID-006에서 required로 격상 (BR-AUTH-07) — JWT 시그니처 검증의 단일 진실원.
  // HS512 알고리즘. `openssl rand -base64 48` 권장. Access/Refresh secret은 *분리* 필수
  // (서로 다른 라이프사이클 + 누수 영향 격리).
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  // CANDID-006: TTL 환경 변수화 — 운영/스테이징 환경별 조정 가능.
  // 기본: Access 30분(1800), Refresh 14일(1209600), 상태유지 미체크 시 1일(86400).
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(1800),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(1209600),
  JWT_REFRESH_TTL_SHORT_SEC: z.coerce.number().int().positive().default(86400),

  // CANDID-008에서 required로 격상 — 부팅 시 키 없으면 차단 (BR-PII-01).
  // `openssl rand -hex 32`로 생성. AES-256-GCM 키 (32 bytes).
  PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64-char hex (32 bytes)'),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),

  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached !== null) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Required environment variable missing: ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}

/**
 * 테스트 전용 — env 캐시 초기화 (CANDID-030 D3).
 * 키 회전 또는 process.env 변경 후 재로드가 필요한 테스트에서 사용.
 * production에서 호출되면 throw — 운영 안전 가드.
 * @internal
 */
export function __resetCachedEnvForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetCachedEnvForTesting must not be called in production');
  }
  cached = null;
}
