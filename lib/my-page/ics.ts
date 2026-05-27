// CANDID-019 Step 2 — RFC 5545 iCalendar 빌더 (면접 일정 .ics 다운로드).
//
// 표준 준수:
//   - CRLF 라인 종결자 (RFC 5545 §3.1)
//   - escape: `\` → `\\`, `;` → `\;`, `,` → `\,`, `\n`/`\r` → `\n` (RFC 5545 §3.3.11)
//   - UID: interview_schedules.ics_uid (멱등성 보장 — schema UNIQUE)
//   - UTC 시각 (DTSTART:YYYYMMDDTHHMMSSZ 형식) — 단순화, VTIMEZONE 생략
//
// 단순화 결정 (MVP):
//   - VTIMEZONE 생략, 모든 시각 UTC
//   - DURATION 대신 DTEND 사용 — 기본 1시간 가정 (실제 면접 시간이 schema에 없음)
//   - SUMMARY는 한국어 "{공고명} 면접 안내" — RFC 5545 UTF-8 허용

import 'server-only';
import type { StageType } from '@prisma/client';

/** RFC 5545 §3.3.11 TEXT escape — `\`, `;`, `,`, 줄바꿈. */
export function icsEscapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Date → `YYYYMMDDTHHMMSSZ` UTC 형식. */
export function icsFormatDateUtc(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

interface BuildIcsInput {
  uid: string;
  scheduledAt: Date;
  /** 면접 종료 시각 — 미전달 시 scheduledAt + 1h 자동 계산. */
  endAt?: Date;
  /** 한국어 요약 (예: "백엔드 엔지니어 1차 면접"). */
  summary: string;
  /** 오프라인 주소 또는 화상 회의 URL. */
  location: string;
  /** 추가 설명 (선택). */
  description?: string;
  /** DTSTAMP — RFC 5545 필수, 미전달 시 new Date() 사용. */
  dtstamp?: Date;
}

/** 단일 VEVENT를 포함한 iCalendar 본문 생성 (CRLF 라인 종결자). */
export function buildInterviewIcs(input: BuildIcsInput): string {
  const dtstamp = input.dtstamp ?? new Date();
  const endAt = input.endAt ?? new Date(input.scheduledAt.getTime() + 60 * 60 * 1000);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//candidate-web//Interview//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscapeText(input.uid)}`,
    `DTSTAMP:${icsFormatDateUtc(dtstamp)}`,
    `DTSTART:${icsFormatDateUtc(input.scheduledAt)}`,
    `DTEND:${icsFormatDateUtc(endAt)}`,
    `SUMMARY:${icsEscapeText(input.summary)}`,
    `LOCATION:${icsEscapeText(input.location)}`,
  ];
  if (input.description !== undefined && input.description.length > 0) {
    lines.push(`DESCRIPTION:${icsEscapeText(input.description)}`);
  }
  lines.push('STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** stage + jobTitle → "{공고명} {단계 라벨} 면접 안내" 한국어 요약. */
export function buildInterviewSummary(jobTitle: string, stage: StageType, stageLabelText: string): string {
  // stage는 SUMMARY 표시에 stageLabel(한국어)을 우선 활용 — enum 값 자체는 무관 (인자 보존 목적)
  void stage;
  return `${jobTitle} ${stageLabelText} 면접 안내`;
}
