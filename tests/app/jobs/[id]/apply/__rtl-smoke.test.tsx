// CANDID-039 Step 1 — RTL 인프라 도입 검증용 smoke test.
// 목적: jsdom 환경 매핑(.test.tsx → jsdom) + @testing-library/react render +
//       @testing-library/jest-dom matcher 확장이 정상 동작함을 증명한다.
// Step 2에서 ResumeUploadStep.test.tsx가 추가되면 본 smoke 파일은 삭제한다.
// TODO(CANDID-039-step2): delete this file when ResumeUploadStep.test.tsx lands.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('RTL 인프라 smoke (CANDID-039 Step 1)', () => {
  it('render + jest-dom matcher가 동작한다', () => {
    render(<button type="button">지원하기</button>);
    expect(screen.getByRole('button', { name: '지원하기' })).toBeInTheDocument();
  });

  it('jsdom 환경이 활성화되어 있다', () => {
    expect(typeof window).toBe('object');
    expect(typeof document.createElement).toBe('function');
  });
});
