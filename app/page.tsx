// P1-1 — 홈 랜딩 (RSC). 기존 셋업 검증용 플레이스홀더를 교체.
// 정적 콘텐츠만 사용(DB 비의존) → 기본 SSG. 카피/직군은 예시값으로, 운영 시 교체 대상.
import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: '엔지니어 채용',
  description:
    'Hoji는 무인 환전·결제 플랫폼을 설