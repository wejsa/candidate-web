// P1-3 — Hoji "careers" 락업 로고 (inline SVG, RSC 안전).
// fill을 CSS 변수로 묶어 라이트/다크 모드에 자동 대응한다(public/brand SVG는 정적 자산용 고정색).
//   hoj → --color-text · i → --brand · 구분선 → --color-border · Careers → --color-text-muted
// 폰트는 globals.css의 Pretendard 스택을 그대로 사용(브랜드 워드마크 일관성).

const FONT = "'Pretendard', Inter, -apple-system, sans-serif";

export function HojiLogo({ height = 26 }: { height?: number }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 234 56"
      height={height}
      role="img"
      aria-label="Hoji Careers"
      style={{ display: 'block' }}
    >
      <text
        x="2"
        y="40"
        fontFamily={FONT}
        fontSize="38"
        fontWeight="700"
        letterSpacing="-1"
        fill="var(--color-text)"
      >
        hoj
        <tspan fill="var(--brand)">i</tspan>
      </text>
      <line x1="92" y1="14" x2="92" y2="42" stroke="var(--color-border)" strokeWidth="1.5" />
      <text
        x="104"
        y="37"
        fontFamily={FONT}
        fontSize="20"
        fontWeight="500"
        letterSpacing="0.5"
        fill="var(--color-text-muted)"
      >
        Careers
      </text>
    </svg>
  );
}
