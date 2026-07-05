// 기사 본문 추출 (파이프라인 전용, 서버 사이드)
//
// 상세 뷰의 "원문 번역본/블로그"를 초록이 아니라 기사 전문 기반으로 만들기 위해
// 기사 HTML에서 읽을 수 있는 본문 텍스트를 heuristic으로 추출한다.
// 입력 HTML은 http.mjs fetchText로 받으며 이미 크기 상한(8MB)이 걸려 있다.

import { decodeEntities } from '../adapters/http.mjs';

/**
 * 기사 HTML → 정제된 본문 텍스트. 추출 실패/과소 시 ''.
 * @param {string} html
 * @param {object} [options]
 * @param {number} [options.maxChars=12000]  LLM 입력 비용을 묶기 위한 상한(~4k 토큰)
 * @returns {string}
 */
export function extractArticleText(html, { maxChars = 12000 } = {}) {
  if (typeof html !== 'string' || html.length === 0) return '';

  let s = html;
  // 주석·비콘텐츠 블록 제거(스크립트/스타일/내비 등)
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|head|nav|header|footer|aside|form|figure)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // 본문 컨테이너 우선 추출(<article> → <main> → <body>)
  const pick = s.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
    || s.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
    || s.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (pick) s = pick[1];

  // 블록 요소 경계를 줄바꿈으로 보존
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li|section|article|blockquote)>/gi, '\n');

  // 남은 태그 제거 → 엔티티 디코드 → 줄 단위 공백 정리
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  const lines = s.split('\n')
    .map(l => l.replace(/[\t\f\r ]+/g, ' ').trim())
    .filter(l => l.length > 0);

  // 내비/캡션 같은 아주 짧은 줄이 과반이면 노이즈일 가능성 — 그래도 문단 위주로 join
  return lines.join('\n').slice(0, maxChars);
}
