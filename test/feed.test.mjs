// 구독 피드(Atom · JSON Feed) 생성 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAtom, buildJsonFeed } from '../src/web/feed.mjs';

const SITE = 'https://jtech-co.github.io/daily-digest';
const pick = (over = {}) => ({
  rank: 1, source: 'hackernews', source_item_id: '123',
  title_original: 'Original Title', title_ko: '번역 제목',
  summary_original: 'orig summary', summary_ko: '한국어 요약', detail_summary: null,
  url: 'https://example.com/a', popularity_signal: 100,
  published_at: '2026-08-07T01:00:00.000Z', selection_reason: 'primary', is_translated: 1,
  ...over,
});
const data = {
  generatedAt: '2026-08-07T06:00:00.000Z',
  dates: [{ date: '2026-08-07', count: 2 }, { date: '2026-08-06', count: 1 }],
  picks: {
    '2026-08-07': [pick(), pick({ source: 'physorg', source_item_id: 'p1', title_ko: '물리 기사', url: 'https://phys.org/x' })],
    '2026-08-06': [pick({ source_item_id: '999', title_ko: '어제 글' })],
  },
};

test('Atom: 필수 구조와 전체 항목 포함', () => {
  const xml = buildAtom(data, { siteUrl: SITE, updated: data.generatedAt });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="[^"]*\/feed\.xml"\/>/);
  assert.equal((xml.match(/<entry>/g) ?? []).length, 3);
  assert.match(xml, /<title>\[Hacker News\] 번역 제목<\/title>/);
  assert.match(xml, /<updated>2026-08-07T06:00:00\.000Z<\/updated>/);
});

test('Atom: 원문 링크를 싣고 전문은 싣지 않는다(§4.1)', () => {
  const xml = buildAtom(data, { siteUrl: SITE, updated: data.generatedAt });
  assert.match(xml, /href="https:\/\/example\.com\/a"/);
  assert.match(xml, /<summary type="text">한국어 요약<\/summary>/);
  assert.doesNotMatch(xml, /<content/);   // 전문 재게시 없음
});

test('Atom: Phys.org·TechXplore는 출처 표기 유지(§8)', () => {
  const xml = buildAtom(data, { siteUrl: SITE, updated: data.generatedAt });
  assert.match(xml, /한국어 요약 \(출처: Phys\.org\)/);
  // HN은 출처 표기 의무가 없으므로 붙이지 않는다
  assert.doesNotMatch(xml, /한국어 요약 \(출처: Hacker News\)/);
});

test('Atom: XML 특수문자 이스케이프', () => {
  const risky = {
    generatedAt: '2026-08-07T06:00:00.000Z',
    dates: [{ date: '2026-08-07', count: 1 }],
    picks: {
      '2026-08-07': [pick({
        title_ko: 'A & B <script>alert("x")</script>',
        summary_ko: "it's <b>bold</b>",
        url: 'https://example.com/?a=1&b=2',
      })],
    },
  };
  const xml = buildAtom(risky, { siteUrl: SITE, updated: risky.generatedAt });
  assert.doesNotMatch(xml, /<script>/);
  assert.match(xml, /A &amp; B &lt;script&gt;/);
  assert.match(xml, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/);
});

test('Atom/JSON: days 제한이 적용된다', () => {
  const xml = buildAtom(data, { siteUrl: SITE, updated: data.generatedAt, days: 1 });
  assert.equal((xml.match(/<entry>/g) ?? []).length, 2); // 최신 1일치(2건)만
  const json = buildJsonFeed(data, { siteUrl: SITE, days: 1 });
  assert.equal(json.items.length, 2);
});

test('JSON Feed 1.1: 스펙 필드와 항목 매핑', () => {
  const json = buildJsonFeed(data, { siteUrl: SITE });
  assert.equal(json.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(json.feed_url, `${SITE}/feed.json`);
  assert.equal(json.home_page_url, `${SITE}/`);
  assert.equal(json.items.length, 3);
  assert.equal(json.items[0].url, 'https://example.com/a');
  assert.equal(json.items[0].title, '[Hacker News] 번역 제목');
  assert.deepEqual(json.items[0].tags, ['hackernews']);
  // id는 항목마다 유일해야 리더가 중복 표시하지 않는다
  assert.equal(new Set(json.items.map(i => i.id)).size, 3);
});

test('번역이 없으면 원문 제목·요약으로 폴백', () => {
  const untranslated = {
    generatedAt: '2026-08-07T06:00:00.000Z',
    dates: [{ date: '2026-08-07', count: 1 }],
    picks: { '2026-08-07': [pick({ title_ko: 'Original Title', summary_ko: null, is_translated: 0 })] },
  };
  const json = buildJsonFeed(untranslated, { siteUrl: SITE });
  assert.equal(json.items[0].title, '[Hacker News] Original Title');
  assert.equal(json.items[0].content_text, 'orig summary');
});

test('detail_summary가 있으면 우선 사용(전문 기반 요약)', () => {
  const withDetail = {
    generatedAt: '2026-08-07T06:00:00.000Z',
    dates: [{ date: '2026-08-07', count: 1 }],
    picks: { '2026-08-07': [pick({ detail_summary: '전문 기반 핵심 요약' })] },
  };
  const json = buildJsonFeed(withDetail, { siteUrl: SITE });
  assert.equal(json.items[0].content_text, '전문 기반 핵심 요약');
});
