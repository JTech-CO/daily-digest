// Science X 네트워크(Phys.org·TechXplore) 공용 어댑터 팩토리 (기술 백서 §2.5, §2.6)
//
// 두 사이트는 동일 인프라·동일 RSS 정책(상업적 이용 명시 허용, 헤드라인 변경 금지,
// 출처 표기 의무)이라 어댑터 로직이 같다. 피드 슬러그는 구현 시 실측으로 확정:
//   전체:      /rss-feed/
//   Spotlight: /rss-feed/breaking/   ← feeds 페이지에서 "Spotlight news only"로 확인(2026-07-04)
//
// 인기 신호: Spotlight 피드 포함 여부(에디터 선별). Spotlight 실패 시 전체 피드
// 상위 N건으로 폴백한다(§9).

import Parser from 'rss-parser';
import { fetchText } from './http.mjs';

export function createScienceXAdapter({ source, baseUrl }) {
  const ALL_URL = `${baseUrl}/rss-feed/`;
  const SPOTLIGHT_URL = `${baseUrl}/rss-feed/breaking/`;

  async function fetchCandidates({ windowHours = 24, limit = 30, fetchImpl = fetch } = {}) {
    const sinceMs = Date.now() - windowHours * 3600 * 1000;
    const parser = new Parser();

    const toCandidate = (item, isSpotlight) => ({
      source,
      sourceItemId: item.guid ?? item.link,
      title: (item.title ?? '').trim(),
      url: item.link ?? '',
      summary: (item.contentSnippet ?? item.content ?? '').trim() || null,
      // pubDate는 'Sat, 04 Jul 2026 06:00:01 EDT' 형태 — V8 Date.parse가 미국 약어 존을 처리
      publishedAt: new Date(item.isoDate ?? item.pubDate).toISOString(),
      popularitySignal: null, // 투표 없는 저널리즘 매체 — 숫자 신호 부재(§0)
      isPopularPick: isSpotlight,
    });

    // Spotlight(인기 트랙) — 실패해도 전체 피드로 계속(§9 폴백)
    let spotlight = [];
    try {
      const feed = await parser.parseString(await fetchText(source, SPOTLIGHT_URL, { fetchImpl }));
      spotlight = (feed.items ?? []).map(i => toCandidate(i, true));
    } catch (err) {
      console.warn(`${err.message} — Spotlight 없이 전체 피드 상위로 폴백`);
    }

    const allFeed = await parser.parseString(await fetchText(source, ALL_URL, { fetchImpl }));
    const all = (allFeed.items ?? []).map(i => toCandidate(i, false));

    // Spotlight 우선 + 전체 피드 순서 유지, ID 중복 제거, 24h 창 필터
    const seen = new Set();
    return [...spotlight, ...all]
      .filter(c => {
        if (seen.has(c.sourceItemId)) return false;
        seen.add(c.sourceItemId);
        return Date.parse(c.publishedAt) >= sinceMs;
      })
      .slice(0, limit);
  }

  return { SOURCE: source, fetchCandidates };
}
