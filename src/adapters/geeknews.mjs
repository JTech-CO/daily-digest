// GeekNews 어댑터 — 홈페이지(인기 순위) + 공식 RSS 폴백 (기술 백서 §2.3)
//
// 홈페이지는 투표로 순위가 정해지므로 "인기" 신호의 원천이다. 마크업:
//   <div class='topic_row' data-topic-state-id='31106' ...>
//     <div class=topictitle><a href='외부URL'><h2 class='topic-title-heading'>제목</h2></a>
//     <div class='topicdesc'><a href='topic?id=31106'>한국어 요약...</a>
//     <div class='topicinfo'><span id='tp31106'>12</span> points ...
//       <time ... data-timestamp="1783125362">
// 홈 구조가 바뀌어 파싱이 실패하면(§9 리스크) RSS 게시 순서로 자동 폴백한다.
//
// GeekNews 텍스트는 한국어(번역 대상 아님 — M3에서 정제만, §0).

import Parser from 'rss-parser';
import { fetchText, decodeEntities } from './http.mjs';

export const SOURCE = 'geeknews';

const HOME_URL = 'https://news.hada.io/';
const RSS_URL = 'https://news.hada.io/rss/news';

export async function fetchCandidates({ windowHours = 24, limit = 20, fetchImpl = fetch } = {}) {
  const sinceMs = Date.now() - windowHours * 3600 * 1000;

  // 1차: 홈페이지 인기 순위
  try {
    const html = await fetchText(SOURCE, HOME_URL, { fetchImpl });
    const parsed = parseHomepage(html);
    if (parsed.length === 0) throw new Error(`[${SOURCE}] 홈페이지에서 topic_row를 찾지 못함(구조 변경 의심)`);
    return parsed
      .filter(c => Date.parse(c.publishedAt) >= sinceMs)
      .slice(0, limit);
  } catch (err) {
    console.warn(`${err.message} — RSS 게시 순서로 폴백`);
  }

  // 2차 폴백: 공식 RSS(Atom) — 시간순, 인기 신호 없음
  const xml = await fetchText(SOURCE, RSS_URL, { fetchImpl });
  const feed = await new Parser().parseString(xml);
  return (feed.items ?? [])
    .map(item => ({
      source: SOURCE,
      sourceItemId: extractTopicId(item.link ?? item.id ?? '') ?? String(item.link),
      title: (item.title ?? '').trim(),
      url: item.link ?? '',
      summary: (item.contentSnippet ?? '').trim().slice(0, 500) || null,
      publishedAt: new Date(item.isoDate ?? item.pubDate).toISOString(),
      popularitySignal: null,
      isPopularPick: false, // RSS에는 인기 신호가 없다(§2.3)
    }))
    .filter(c => Date.parse(c.publishedAt) >= sinceMs)
    .slice(0, limit);
}

/** 홈페이지 HTML에서 topic_row 블록들을 순위 순서대로 파싱한다. 실패 항목은 건너뜀. */
// 실제 topic_row 블록은 ~2KB 남짓이다. 신뢰 불가 HTML에서 비정상적으로 큰 블록이
// 초선형 정규식 백트래킹(ReDoS)을 유발하지 못하도록 블록 입력을 상한으로 자른다.
const MAX_BLOCK_CHARS = 32 * 1024;

export function parseHomepage(html) {
  const out = [];
  const blocks = html.split("<div class='topic_row'").slice(1);
  for (const rawBlock of blocks) {
    const block = rawBlock.length > MAX_BLOCK_CHARS ? rawBlock.slice(0, MAX_BLOCK_CHARS) : rawBlock;
    const id = block.match(/data-topic-state-id='(\d+)'/)?.[1];
    const titleM = block.match(/<div class=topictitle>.*?<a href='([^']*)'[^>]*>.*?<h2 class='topic-title-heading'>([\s\S]*?)<\/h2>/s);
    if (!id || !titleM) continue;
    const desc = block.match(/<div class='topicdesc'><a[^>]*>([\s\S]*?)<\/a>/s)?.[1];
    const points = block.match(new RegExp(`<span id='tp${id}'>(\\d+)</span>`))?.[1];
    const ts = block.match(/data-timestamp="(\d+)"/)?.[1];
    if (!ts) continue;

    const rawUrl = titleM[1];
    out.push({
      source: SOURCE,
      sourceItemId: id,
      title: decodeEntities(titleM[2]).trim(),
      // Ask GN 등 외부 링크가 없는 글은 상대경로(topic?id=) → 절대경로로
      url: /^https?:\/\//.test(rawUrl) ? rawUrl : new URL(rawUrl, HOME_URL).href,
      summary: desc ? decodeEntities(desc).trim() : null,
      publishedAt: new Date(Number(ts) * 1000).toISOString(),
      popularitySignal: points ? Number(points) : null,
      isPopularPick: true, // 홈페이지 노출 순서 자체가 투표 랭킹
    });
  }
  return out;
}

function extractTopicId(link) {
  return link.match(/topic\?id=(\d+)/)?.[1] ?? null;
}
