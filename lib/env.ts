import { z } from 'zod';

const envSchema = z
  .object({
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
    // HS512 알고리즘 — RFC 7518 §3.2: HMAC 키는 해시 출력(512비트=64바이트) 이상 길이 권장.
    // `openssl rand -base64 64`로 생성. Access/Refresh secret은 *분리* 필수 (아래 refine 강제).
    JWT_ACCESS_SECRET: z.string().min(64),
    JWT_REFRESH_SECRET: z.string().min(64),

    // CANDID-006: TTL 환경 변수화 — 운영/스테이징 환경별 조정 가능.
    // 기본: Access 30분(1800), Refresh 14일(1209600), 상태유지 미체크 시 1일(86400).
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(1800),
    JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(1209600),
    JWT_REFRESH_TTL_SHORT_SEC: z.coerce.number().int().positive().default(86400),

    // CANDID-008에서 required로 격상 — 부팅 시 키 없으면 차단 (BR-PII-01).
    // `openssl rand -hex 32`로 생성. AES-256-GCM 키 (32 bytes).
    PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64-char hex (32 bytes)'),

    // CANDID-009: CORS 화이트리스트 (BR-SEC-03) — CSV 형식, NEXT_PUBLIC_APP_URL의 origin이
    // 항상 자동 포함되므로 단일 도메인이면 빈 값으로 두면 된다.
    // Step 2 보강(H005): `*`/wildcard/null 거부 + 각 항목이 http(s):// URL인지 부팅 시 검증.
    // 잘못된 값(오타 포함)은 silent drop 대신 부팅 차단 (fail-fast 운영성).
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .refine(
        (s) =>
          s
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p !== '')
            .every((p) => {
              if (p === '*' || p === 'null' || p.includes('*')) return false;
              try {
                const u = new URL(p);
                return (u.protocol === 'https:' || u.protocol === 'http:') && u.host !== '';
              } catch {
                return false;
              }
            }),
        {
          message:
            'CORS_ALLOWED_ORIGINS must be comma-separated http(s) URLs — wildcards (*), "null", or invalid URLs are rejected (BR-SEC-03)',
        },
      ),

    // CANDID-009: HTTPS 강제 (BR-SEC-01) — production은 true 권장. 'true'/'1'만 활성으로 인정.
    // 빈 값/누락 시 false — z.coerce.boolean()은 'false' 문자열도 true로 변환되는 함정 회피.
    FORCE_HTTPS_REDIRECT: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),

    // CANDID-009 Step 2 보강(H001): X-Forwarded-Proto/For 헤더를 신뢰할지 여부.
    // 신뢰된 LB/CDN/ingress 뒤에서만 true로 설정. 직접 노출 환경(localhost/dev)에서는 false 유지.
    // false면 isSecureRequest는 nextUrl.protocol만 사용 — 클라이언트의 헤더 위조로 HTTPS 우회 차단.
    TRUST_PROXY: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),

    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
    GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),

    // CANDID-016: 이력서 첨부용 S3/MinIO presigned URL 발급.
    // 4개 모두 set 또는 모두 unset 두 상태만 허용 (아래 superRefine에서 강제).
    // dev: docker-compose minio 서비스가 채움. 운영: 관리형 S3 또는 호환 스토리지 endpoint.
    S3_ENDPOINT: z.string().url().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    // BR-FILE-05: presigned URL 유효기간 5분 (300초) — 기본값 고정, 운영 조정 가능.
    S3_PRESIGN_TTL_SEC: z.coerce.number().int().positive().max(900).default(300),

    // CANDID-010에서 required로 격상 — 회원가입 인증 메일 발송에 SMTP 필수.
    // dev/test: Mailtrap(sandbox.smtp.mailtrap.io:2525) 또는 ethereal.email.
    // 운영: AWS SES / SendGrid / Mailgun — SMTP_FROM은 검증된 발신자 주소.
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    SMTP_FROM: z.string().email(),
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    // CANDID-006: Access/Refresh secret 분리 강제 — 동일 값이면 누수 영향 격리 무력화.
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
    path: ['JWT_REFRESH_SECRET'],
  })
  // CANDID-012: OAuth client credential 쌍 무결성 강제 — 한쪽만 채워진 부분 구성은 부팅 차단.
  // start handler가 secret 없이 authorize URL을 만들거나, callback이 client_id 없이 token exchange를
  // 시도해 런타임 5xx로 노출되는 사고를 방지한다. 둘 다 채우거나 둘 다 비우는 두 상태만 허용.
  .superRefine((e, ctx) => {
    const pairs = [
      ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'] as const,
      ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'] as const,
    ];
    for (const [idKey, secretKey] of pairs) {
      const idSet = typeof e[idKey] === 'string' && e[idKey] !== '';
      const secretSet = typeof e[secretKey] === 'string' && e[secretKey] !== '';
      if (idSet !== secretSet) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [idSet ? secretKey : idKey],
          message: `${idKey} and ${secretKey} must both be set or both empty (partial OAuth credentials forbidden)`,
        });
      }
    }
  })
  // CANDID-016: S3 4변수 strong-tuple — 부분 구성 차단.
  // 일부만 설정된 상태로 부팅하면 presign 호출 시 SDK가 runtime 5xx로 노출되므로 부팅 차단.
  // 모두 set(저장소 활성) 또는 모두 unset(저장소 비활성 — 파일 API는 호출 시 FILE_UPLOAD_FAILED).
  .superRefine((e, ctx) => {
    const s3Keys = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;
    const setKeys = s3Keys.filter((k) => typeof e[k] === 'string' && e[k] !== '');
    if (setKeys.length !== 0 && setKeys.length !== s3Keys.length) {
      const missing = s3Keys.filter((k) => !setKeys.includes(k));
      for (const k of missing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [k],
          message: `S3 credentials must be fully set or fully empty (partial S3 config forbidden): missing ${k}`,
        });
      }
    }
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
