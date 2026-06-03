import { describe, expect, it } from 'vitest';
import { buildInfectedFileEmail } from '@/lib/email/templates/infected-file';

// CANDID-029 Step 3 — INFECTED 알림 템플릿 단위 테스트.

describe('buildInfectedFileEmail', () => {
  it('to/subject/html/text를 구성하고 이름·파일명을 포함한다', () => {
    const msg = buildInfectedFileEmail({
      to: 'owner@example.com',
      name: '홍길동',
      filename: 'cv.pdf',
    });
    expect(msg.to).toBe('owner@example.com');
    expect(msg.subject).toContain('차단');
    expect(msg.html).toContain('홍길동');
    expect(msg.html).toContain('cv.pdf');
    expect(msg.text).toContain('cv.pdf');
  });

  it('파일명/이름의 HTML 특수문자를 escape한다(XSS 이중 방어)', () => {
    const msg = buildInfectedFileEmail({
      to: 'o@x.com',
      name: '<b>name</b>',
      filename: '<script>alert(1)</script>.pdf',
    });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
    expect(msg.html).toContain('&lt;b&gt;name&lt;/b&gt;');
  });
});
