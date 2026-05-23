import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@/lib/security/sanitize';

// BR-SEC-05: XSS 방어. 어드민 HTML은 화이트리스트, 사용자 입력은 strip.
// DOMPurify의 일반 회귀 케이스 + 도메인 특화 케이스(공고 description의 허용 태그/속성).

describe('sanitizeHtml — job-posting profile', () => {
  it('허용 태그(p/h2/strong/em/ul/li)는 보존', () => {
    const input = '<p>채용 <strong>공고</strong></p><h2>요건</h2><ul><li>경력</li></ul>';
    expect(sanitizeHtml(input, 'job-posting')).toContain('<p>');
    expect(sanitizeHtml(input, 'job-posting')).toContain('<strong>공고</strong>');
    expect(sanitizeHtml(input, 'job-posting')).toContain('<h2>요건</h2>');
    expect(sanitizeHtml(input, 'job-posting')).toContain('<li>경력</li>');
  });

  it('<script> 태그는 제거되고 내용도 제거 (DOMPurify 기본)', () => {
    const result = sanitizeHtml('<p>안전</p><script>alert("xss")</script>', 'job-posting');
    expect(result).toBe('<p>안전</p>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert');
  });

  it('<iframe>/<object>/<embed>는 제거', () => {
    const input = '<iframe src="evil"></iframe><object data="bad"></object><embed src="x">';
    expect(sanitizeHtml(input, 'job-posting')).toBe('');
  });

  it('이벤트 핸들러 속성(onclick/onerror/onload)은 제거', () => {
    const result = sanitizeHtml(
      '<p onclick="bad()">텍스트</p><img onerror="evil()" src="x">',
      'job-posting',
    );
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onerror');
    expect(result).toContain('텍스트');
  });

  it('javascript: URI는 href에서 제거', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">클릭</a>', 'job-posting');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('클릭');
  });

  it('data: URI는 href에서 제거 (data exfiltration 방어)', () => {
    const result = sanitizeHtml('<a href="data:text/html,evil">x</a>', 'job-posting');
    expect(result).not.toContain('data:');
  });

  it('https:/http:/mailto: URI는 보존', () => {
    const r1 = sanitizeHtml('<a href="https://example.com">예시</a>', 'job-posting');
    expect(r1).toContain('href="https://example.com"');
    const r2 = sanitizeHtml('<a href="mailto:hr@example.com">메일</a>', 'job-posting');
    expect(r2).toContain('href="mailto:hr@example.com"');
  });

  it('style 속성과 <style> 태그 제거 (CSS 기반 데이터 추출 방어)', () => {
    const result = sanitizeHtml(
      '<p style="background:url(evil)">x</p><style>body{}</style>',
      'job-posting',
    );
    expect(result).not.toContain('style=');
    expect(result).not.toContain('<style>');
  });

  it('<form>/<input>는 제거 (사용자 입력 도용 방어)', () => {
    const result = sanitizeHtml('<form><input name="pw"></form>', 'job-posting');
    expect(result).toBe('');
  });

  it('비허용 태그(<div>/<span>)는 strip되지만 텍스트 컨텐츠는 보존', () => {
    const result = sanitizeHtml('<div><span>본문</span></div>', 'job-posting');
    expect(result).toContain('본문');
    expect(result).not.toContain('<div>');
    expect(result).not.toContain('<span>');
  });
});

describe('sanitizeHtml — plain profile', () => {
  it('모든 HTML 태그를 strip하고 텍스트만 반환', () => {
    expect(sanitizeHtml('<p>안녕 <strong>홍길동</strong></p>', 'plain')).toBe(
      '안녕 홍길동',
    );
  });

  it('<script>의 내용도 함께 제거', () => {
    expect(sanitizeHtml('hello<script>alert(1)</script>world', 'plain')).toBe('helloworld');
  });

  it('이벤트 핸들러는 태그와 함께 제거', () => {
    expect(sanitizeHtml('<img onerror="x" src="y">텍스트', 'plain')).toBe('텍스트');
  });
});

describe('sanitizeHtml — 입력 방어', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    ['', ''],
  ])('null/undefined/빈 입력은 빈 문자열 반환', (input, expected) => {
    expect(sanitizeHtml(input as string | null | undefined, 'job-posting')).toBe(expected);
    expect(sanitizeHtml(input as string | null | undefined, 'plain')).toBe(expected);
  });

  it('multi-byte 문자(한글/이모지)는 보존', () => {
    expect(sanitizeHtml('<p>한국어 🚀 채용</p>', 'job-posting')).toContain('한국어 🚀 채용');
    expect(sanitizeHtml('한국어 🚀 채용', 'plain')).toBe('한국어 🚀 채용');
  });
});
