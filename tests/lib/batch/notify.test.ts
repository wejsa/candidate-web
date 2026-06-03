import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// CANDID-029 Step 3 — 배치 mailer 단위 테스트. nodemailer를 mock.
const { sendMailMock, createTransportMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  createTransportMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: createTransportMock.mockReturnValue({ sendMail: sendMailMock }),
  },
}));

import { __resetBatchMailerForTesting, notifyInfectedFile } from '@/lib/batch/notify';
import { __resetCachedEnvForTesting } from '@/lib/env';

beforeEach(() => {
  sendMailMock.mockReset().mockResolvedValue({});
  createTransportMock.mockClear().mockReturnValue({ sendMail: sendMailMock });
  __resetBatchMailerForTesting();
  __resetCachedEnvForTesting();
});

afterEach(() => {
  __resetBatchMailerForTesting();
});

describe('notifyInfectedFile', () => {
  it('INFECTED 템플릿을 SMTP_FROM 발신으로 발송한다', async () => {
    await notifyInfectedFile({ to: 'owner@example.com', name: 'A', filename: 'cv.pdf' });

    expect(sendMailMock).toHaveBeenCalledOnce();
    const sent = sendMailMock.mock.calls[0]?.[0] as Record<string, string>;
    expect(sent.to).toBe('owner@example.com');
    expect(sent.from).toBe('noreply@candidate.test'); // tests/setup.ts SMTP_FROM
    expect(sent.subject).toContain('차단');
    expect(sent.html).toContain('cv.pdf');
  });

  it('transporter를 캐시한다(재발송 시 createTransport 1회)', async () => {
    await notifyInfectedFile({ to: 'a@x.com', name: 'A', filename: 'a.pdf' });
    await notifyInfectedFile({ to: 'b@x.com', name: 'B', filename: 'b.pdf' });
    expect(createTransportMock).toHaveBeenCalledOnce();
  });
});
