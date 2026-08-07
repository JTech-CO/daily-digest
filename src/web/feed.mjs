// RSS(Atom 1.0) · JSON Feed 1.1 생성 — 백서 비범위였던 "알림 채널"의 정적 해법
//
// 구독자 DB·발송 서버 없이 정적 파일 2개만 추가한다. 각자의 RSS 리더·Slack RSS 앱·
// Discord 웹훅이 폴링하므로 운영 부담이 0이다.
//
// 원칙(§4.1, §8): 전문을 싣지 않고 번역 제목 + 요약 + 원문 링크만 제공하며,
// Phys.org·TechXplore는 출처 표기를 유지한다.

const SOURCE_LABEL = {
  hackernews: 'Hacker News', geeknews: 'GeekNews', arxiv: 'arXiv',
  physorg: 'Phys.org', techxplore: 'TechXplore',
};
const ATTRIBUTION_REQUIRED = new Set(['physorg', 'techxplore']);

const esc = s => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

/** 항목의 표시 제목/요약 — 번역본이 있으면 그것을, 없으면 원문을 */
function view(p) {
  const title = p.title_ko || p.title_original || '';
  const summary = p.detail_summary || p.summary_ko || p.summary_original || '';
  const label = SOURCE_LABEL[p.source] ?? p.source;
  const attribution = ATTRIBUTION_REQUIRED.has(p.source) ? ` (출처: ${label})` : '';
  return { title, summary, label, attribution };
}

/** 사이트 내 항목 고유 ID(피드 리더의 중복 판정 기준) */
const entryId = (siteUrl, date, p) =>
  `${siteUrl.replace(/\/$/, '')}/#${date}/${p.source}/${p.source_item_id}`;

/**
 * 최근 N일치를 담은 Atom 1.0 문서.
 * @param {{dates: {date: string, count: number}[], picks: Record<string, object[]>}} data
 * @param {object} options
 * @param {string} options.siteUrl
 * @param {string} [options.title]
 * @param {number} [options.days=30]
 * @param {string} options.updated ISO 문자열(빌드 시각)
 */
export function buildAtom(data, { siteUrl, title = 'daily-digest', days = 30, updated }) {
  const base = siteUrl.replace(/\/$/, '');
  const dates = data.dates.slice(0, days);
  const entries = [];
  for (const { date } of dates) {
    for (const p of data.picks[date] ?? []) {
      const v = view(p);
      entries.push(`  <entry>
    <title>[${esc(v.label)}] ${esc(v.title)}</title>
    <link rel="alternate" type="text/html" href="${esc(p.url)}"/>
    <id>${esc(entryId(base, date, p))}</id>
    <updated>${esc(p.published_at || `${date}T00:00:00Z`)}</updated>
    <category term="${esc(p.source)}"/>
    <summary type="text">${esc(v.summary + v.attribution)}</summary>
  </entry>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(title)}</title>
  <subtitle>매일 5개 기술·과학 소스에서 하나씩 골라 한국어로</subtitle>
  <link rel="alternate" type="text/html" href="${esc(base)}/"/>
  <link rel="self" type="application/atom+xml" href="${esc(base)}/feed.xml"/>
  <id>${esc(base)}/</id>
  <updated>${esc(updated)}</updated>
${entries.join('\n')}
</feed>
`;
}

/** JSON Feed 1.1 문서 */
export function buildJsonFeed(data, { siteUrl, title = 'daily-digest', days = 30 }) {
  const base = siteUrl.replace(/\/$/, '');
  const items = [];
  for (const { date } of data.dates.slice(0, days)) {
    for (const p of data.picks[date] ?? []) {
      const v = view(p);
      items.push({
        id: entryId(base, date, p),
        url: p.url,
        title: `[${v.label}] ${v.title}`,
        content_text: v.summary + v.attribution,
        date_published: p.published_at || `${date}T00:00:00Z`,
        tags: [p.source],
      });
    }
  }
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title,
    home_page_url: `${base}/`,
    feed_url: `${base}/feed.json`,
    description: '매일 5개 기술·과학 소스에서 하나씩 골라 한국어로',
    items,
  };
}
