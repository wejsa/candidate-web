import { getEnv } from '@/lib/env';

// CANDID-029 Step 3 — 바이러스 스캔 추상화 (BR-FILE-04 골격).
//
// 본 모듈은 스캐너 *인터페이스*와 스텁만 제공한다. 실제 ClamAV(clamd TCP INSTREAM) 클라이언트는
// 후속 작업 범위다. CLAMAV_ENABLED=false(기본)면 스텁이 'SKIPPED'를 반환해 PENDING 파일을
// 그대로 둔다 — 미검사 파일을 임의로 CLEAN 처리하지 않는다(false-confidence 차단).
// processPendingScans(lib/batch/virus-scan.ts)는 본 인터페이스에만 의존하므로, 실제 스캐너가
// 주입/구현되면 CLEAN/INFECTED/FAILED 처리 파이프라인이 그대로 동작한다.
//
// server-only 미사용: 야간 배치(tsx CLI)가 import한다(lib/prisma 등과 동일 제약).

/** 스캔 판정. SKIPPED = 스캐너 비활성(미검사 — 상태 변경 없음). */
export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'FAILED' | 'SKIPPED';

export interface ScanTarget {
  storedPath: string;
}

export interface VirusScanner {
  scan(target: ScanTarget): Promise<ScanVerdict>;
}

/** 비활성/미구현 스텁 — 항상 SKIPPED. 실제 clamd 연동은 후속 작업. */
class StubScanner implements VirusScanner {
  async scan(): Promise<ScanVerdict> {
    return 'SKIPPED';
  }
}

let cached: VirusScanner | null = null;

/** 환경에 따른 스캐너 반환. 현재는 항상 스텁(clamd 클라이언트 미구현 — 골격). */
export function getScanner(): VirusScanner {
  if (cached !== null) return cached;
  if (getEnv().CLAMAV_ENABLED) {
    // 활성화됐으나 실제 clamd 클라이언트가 없으면 운영자가 인지하도록 경고 후 스텁 폴백.
    console.warn(
      '[scanner] CLAMAV_ENABLED=true이나 clamd 클라이언트 미구현 — SKIPPED 폴백(후속 작업)',
    );
  }
  cached = new StubScanner();
  return cached;
}

/** 테스트 전용 — 스캐너 캐시 초기화 (L-002 패턴). @internal */
export function __resetScannerForTesting(): void {
  cached = null;
}
