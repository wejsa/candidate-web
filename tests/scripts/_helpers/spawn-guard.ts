import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

// CANDID-045 Step 2 (MINOR DRY): 회귀 가드 테스트의 공통 패턴 추출.
// CANDID-041(migrations) + CANDID-043(guard-wiring) 두 테스트가 동일한
// "가드 스크립트를 자식 프로세스로 실행 + tmpdir fixture 정리" 로직을 중복 보유했다.
// 본 헬퍼로 일원화하여 회귀 가드 테스트가 늘어도 spawn/cleanup 규약을 한 곳에서 유지한다.

export type GuardResult = { exitCode: number; stdout: string; stderr: string };

/**
 * 가드 스크립트를 `node`로 실행하고 exit code + stdout/stderr를 캡처한다.
 * execFileSync는 exit != 0이면 throw하므로 catch에서 status/출력을 정규화한다.
 */
export function runGuard(scriptPath: string, cwd: string): GuardResult {
  try {
    const stdout = execFileSync('node', [scriptPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? -1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

/**
 * afterEach에서 일괄 정리할 tmpdir 추적기. 파일별로 독립 인스턴스를 생성해
 * 테스트 파일 간 공유 가변 상태(워커 오염)를 만들지 않는다.
 */
export function createTmpTracker() {
  const dirs: string[] = [];
  return {
    track(cwd: string): string {
      dirs.push(cwd);
      return cwd;
    },
    cleanupAll(): void {
      while (dirs.length > 0) {
        rmSync(dirs.pop()!, { recursive: true, force: true });
      }
    },
  };
}
