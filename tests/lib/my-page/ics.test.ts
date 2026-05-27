// CANDID-019 Step 2 — RFC 5545 iCalendar 빌더 단위 테스트.

import { describe, expect, it } from 'vitest';
import { buildInterviewIcs, icsEscapeText, icsFormatDateUtc } from '@/lib/my-page/ics';

describe('icsEscapeText (RFC 5545 §3.3.11)', () => {
  it('backslash → \\\\', () => {
    expect(icsEscapeText('a\\b')).toBe('a\\\\b');
  });
  it('semicolon → \\;', () => {
    expect(icsEscapeText('a;b')).toBe('a\\;b');
  });
  it('comma → \\,', () => {
    expect(icsEscapeText('a,b')).toBe('a\\,b');
  });
  it('LF → \\n', () => {
    expect(icsEscapeText('a\nb')).toBe('a\\nb');
  });
  it('CRLF → \\n (단일)', () => {
    expect(icsEscapeText('a\r\nb')).toBe('a\\nb');
  });
  it('CR → \\n', () => {
    expect(icsEscapeText('a\rb')).toBe('a\\nb');
  });
  it('한글/UTF-8 그대로 보존', () => {
    expect(icsEscapeText('백엔드 엔지니어')).toBe('백엔드 엔지니어');
  });
  it('escape 조합 (backslash + comma + semicolon)', () => {
    expect(icsEscapeText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
  });
});

describe('icsFormatDateUtc', () => {
  it('UTC ISO → YYYYMMDDTHHMMSSZ', () => {
    expect(icsFormatDateUtc(new Date('2026-05-27T13:45:30Z'))).toBe('20260527T134530Z');
  });
  it('2자리 패딩 (자정)', () => {
    expect(icsFormatDateUtc(new Date('2026-01-01T00:00:00Z'))).toBe('20260101T000000Z');
  });
});

describe('buildInterviewIcs', () => {
  const baseInput = {
    uid: 'interview-42@candidate.example.com',
    scheduledAt: new Date('2026-05-30T05:00:00Z'),
    summary: '백엔드 엔지니어 1차 면접 안내',
    location: '서울시 강남구',
    dtstamp: new Date('2026-05-27T13:45:30Z'),
  };

  it('VCALENDAR/VEVENT 골격 + 필수 필드', () => {
    const ics = buildInterviewIcs(baseInput);
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('VERSION:2.0\r\n');
    expect(ics).toContain('BEGIN:VEVENT\r\n');
    expect(ics).toContain('END:VEVENT\r\n');
    expect(ics).toContain('END:VCALENDAR\r\n');
    expect(ics).toContain('UID:interview-42@candidate.example.com\r\n');
    expect(ics).toContain('DTSTART:20260530T050000Z\r\n');
    expect(ics).toContain('DTSTAMP:20260527T134530Z\r\n');
    expect(ics).toContain('STATUS:CONFIRMED\r\n');
  });

  it('DTEND 미전달 시 자동 +1h', () => {
    const ics = buildInterviewIcs(baseInput);
    expect(ics).toContain('DTEND:20260530T060000Z\r\n');
  });

  it('DTEND 전달 시 그대로 사용', () => {
    const ics = buildInterviewIcs({
      ...baseInput,
      endAt: new Date('2026-05-30T07:30:00Z'),
    });
    expect(ics).toContain('DTEND:20260530T073000Z\r\n');
  });

  it('SUMMARY/LOCATION에 escape 적용 (semicolon, comma)', () => {
    const ics = buildInterviewIcs({
      ...baseInput,
      summary: '면접; 안내, 중요',
      location: '서울; 강남구, 1층',
    });
    expect(ics).toContain('SUMMARY:면접\\; 안내\\, 중요\r\n');
    expect(ics).toContain('LOCATION:서울\\; 강남구\\, 1층\r\n');
  });

  it('description 전달 시 DESCRIPTION 라인 포함', () => {
    const ics = buildInterviewIcs({
      ...baseInput,
      description: '지원 번호: A-202605-00001',
    });
    expect(ics).toContain('DESCRIPTION:지원 번호: A-202605-00001\r\n');
  });

  it('description 미전달 시 DESCRIPTION 라인 부재', () => {
    const ics = buildInterviewIcs(baseInput);
    expect(ics).not.toContain('DESCRIPTION:');
  });

  it('CRLF 라인 종결자 일관성', () => {
    const ics = buildInterviewIcs(baseInput);
    const lines = ics.split('\r\n');
    // Last element is empty string after trailing \r\n
    expect(lines.length).toBeGreaterThan(10);
    expect(lines[lines.length - 1]).toBe('');
  });
});
