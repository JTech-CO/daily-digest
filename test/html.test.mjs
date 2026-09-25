// HTML → 평문 변환 검증 (화면에 마크업이 노출되던 문제의 회귀 테스트)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, htmlToText, stripHtmlIfAny } from '../src/adapters/http.mjs';
import { toCandidate } from '../src/adapters/hackernews.mjs';
import { parseHomepage } from '../src/adapters/geeknews.mjs';

// ── decodeEntities ────────────────────────────────────────────

test('엔티티: 이름·10진·16진 참조를 모두 디코딩', () => {
  assert.equal(decodeEntities('a &#x2F; b'), 'a / b');          // HN이 '/'를 escape하는 형태
  assert.equal(decodeEntities('it&#x27;s'), "it's");
  assert.equal(decodeEntities('it&#39;s'), "it's");
  assert.equal(decodeEntities('&#8217;'), '\u2019');
  assert.equal(decodeEntities('A &amp; B &lt;tag&gt; &quot;q&quot;'), 'A & B <tag> "q"');
});

test('엔티티: 모르는 엔티티·잘못된 코드포인트는 그대로 둔다', () => {
  assert.equal(decodeEntities('&unknown; &#x110000; &#0;'), '&unknown; &#x110000; &#0;');
});

test('엔티티: 이중 디코딩하지 않는다(&amp;lt; → &lt;)', () => {
  // 한 번만 훑어야 원문에 있던 리터럴 '&lt;'가 태그로 둔갑하지 않는다
  assert.equal(decodeEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
});

// ── htmlToText ────────────────────────────────────────────────

test('HTML→평문: 화면에 노출되던 실제 story_text를 복원', () => {
  const raw = '<a href="https:&#x2F;&#x2F;terrytao.wordpress.com&#x2F;2026&#x2F;09&#x2F;11&#x2F;x&#x2F;" '
    + 'rel="nofollow">https:&#x2F;&#x2F;terrytao.wordpress.com&#x2F;2026&#x2F;09&#x2F;11&#x2F;x&#x2F;</a>'
    + '<p>Tao writes about it&#x27;s a problem.';
  assert.equal(
    htmlToText(raw),
    'https://terrytao.wordpress.com/2026/09/11/x/\nTao writes about it\'s a problem.',
  );
});

test('HTML→평문: 블록 경계는 줄바꿈, 인라인 태그는 제거', () => {
  assert.equal(htmlToText('<p>첫째</p><p>둘째<br>셋째</p>'), '첫째\n둘째\n셋째');
  assert.equal(htmlToText('강조 <b>굵게</b> 유지'), '강조 굵게 유지');
});

test('HTML→평문: script/style 내용은 버린다', () => {
  assert.equal(htmlToText('<p>본문</p><script>evil()</script>'), '본문');
});

test('HTML→평문: 빈 입력·비문자열은 빈 문자열', () => {
  for (const v of ['', null, undefined, 42]) assert.equal(htmlToText(v), '');
});

test('HTML→평문: 소스가 자르며 남긴 미완성 태그도 제거', () => {
  // GeekNews 본문은 소스에서 이미 잘려 온다. 닫는 '>'가 없는 채로 끝나는 태그가 남는다
  assert.equal(htmlToText('본문입니다. 최근에 <a href="https://new'), '본문입니다. 최근에');
});

// ── stripHtmlIfAny(게이트) ─────────────────────────────────

test('게이트: 마크업이 있을 때만 평문화한다', () => {
  assert.equal(stripHtmlIfAny('본문 <a href="https://x">링크</a>'), '본문 링크');
  assert.equal(stripHtmlIfAny('본문 <a href="https://new'), '본문');
});

test('게이트: 평문의 꺾쇠는 건드리지 않는다', () => {
  // 실제 데이터에 있는 문자열들: 무차별로 태그를 걷어내면 본문이 잘린다
  for (const s of [
    'lab | up >/conf는, 래블업이 만들어 온 컨퍼런스',
    'responses <You are right, I made a mistake> and x < y',
    'if a < b, c > d then',
  ]) assert.equal(stripHtmlIfAny(s), s);
});

// ── HN 어댑터 결합 ─────────────────────────────────────────────

const hit = (over = {}) => ({
  objectID: '1', title: 'T', url: 'https://example.com/a',
  created_at_i: 1_760_000_000, points: 10, ...over,
});

test('HN: story_text의 마크업이 summary에 남지 않는다', () => {
  const c = toCandidate(hit({ story_text: '<p>본문 &#x27;인용&#x27;</p>' }));
  assert.equal(c.summary, "본문 '인용'");
  assert.doesNotMatch(c.summary, /<[a-z]|&#/i);
});

test('HN: story_text 없거나 태그뿐이면 summary=null', () => {
  assert.equal(toCandidate(hit()).summary, null);
  assert.equal(toCandidate(hit({ story_text: '<p></p>' })).summary, null);
});

// ── GeekNews 어댑터 결합 ─────────────────────────────

const homeBlock = (title, desc) =>
  `<div class='topic_row' data-topic-state-id='100' data-topic-voteable='1'>`
  + `<div class=topictitle><a href='https://ex.com/a' id='tr1'><h2 class='topic-title-heading'>${title}</h2></a></div>`
  + `<div class='topicdesc'><a href='topic?id=100'>${desc}</a></div>`
  + `<div class='topicinfo'><span id='tp100'>42</span> points <time data-timestamp="1783125362"></time></div></div>`;

test('GeekNews 홈: escape된 마크업을 살리지 않고 평문으로 내린다', () => {
  // decodeEntities만 하면 &lt;a href=...&gt;가 살아있는 태그로 변해 화면에 노출된다
  const [c] = parseHomepage(homeBlock('제목', '본문 &lt;a href=&quot;https://x&quot;&gt;링크&lt;/a&gt; 끝'));
  assert.equal(c.summary, '본문 링크 끝');
  assert.doesNotMatch(c.summary, /<[a-z]/i);
});

test('GeekNews 홈: 제목의 태그도 걷어낸다', () => {
  const [c] = parseHomepage(homeBlock('<em>강조</em> 제목', '요약'));
  assert.equal(c.title, '강조 제목');
});

test('GeekNews 홈: 평문의 꺾쇠는 보존한다', () => {
  // 'lab | up >/conf' 같은 실제 제목이 있다
  const [c] = parseHomepage(homeBlock('lab | up &gt;/conf 후기', '요약'));
  assert.equal(c.title, 'lab | up >/conf 후기');
});

// ── 저장된 행 복구 ─────────────────────────────────────────────

const { openDb, savePicks } = await import('../src/db/index.mjs');
const { repairHtml } = await import('../src/pipeline/repair-html.mjs');

const pick = (over = {}) => ({
  source: 'hackernews', sourceItemId: 'a1', title: 'T', titleKo: 'T',
  summary: null, summaryKo: null, url: 'https://example.com/a',
  popularitySignal: 1, publishedAt: '2026-07-04T00:00:00.000Z',
  selectionReason: 'primary', isTranslated: false, ...over,
});

function seed(items) {
  const db = openDb(':memory:');
  savePicks(db, { pickDate: '2026-07-04', items });
  return db;
}

test('복구: HN 행의 마크업을 평문으로 되돌린다', () => {
  const dirty = '<p>본문 &#x2F; 경로</p>';
  const db = seed([pick({ summary: dirty, summaryKo: dirty })]);
  const { scanned, repaired } = repairHtml(db);
  assert.equal(scanned, 1);
  assert.equal(repaired.length, 1);
  const row = db.prepare('SELECT summary_original AS s, summary_ko AS k FROM daily_picks').get();
  assert.equal(row.s, '본문 / 경로');
  assert.equal(row.k, '본문 / 경로');
});

test('복구: 번역 상태는 건드리지 않는다(LLM 백필 대상 유지)', () => {
  const db = seed([pick({ summary: '<p>x</p>', summaryKo: '<p>x</p>' })]);
  repairHtml(db);
  const row = db.prepare('SELECT is_translated AS t, backfilled_at AS b FROM daily_picks').get();
  assert.equal(row.t, 0);
  assert.equal(row.b, null);
});

test('복구: 평문에 부등호가 있는 다른 소스는 손대지 않는다', () => {
  // arXiv 초록의 '<You are right, ...>'를 태그로 오인해 지우면 안 된다(실제 데이터에 존재)
  const prose = 'responses <You are right, I made a mistake> and x < y';
  const db = seed([pick({ source: 'arxiv', sourceItemId: 'x1', summary: prose, summaryKo: prose })]);
  const { repaired } = repairHtml(db);
  assert.equal(repaired.length, 0);
  assert.equal(db.prepare('SELECT summary_original AS s FROM daily_picks').get().s, prose);
});

test('복구: --dry는 DB를 바꾸지 않고 대상만 센다', () => {
  const db = seed([pick({ summary: '<p>x</p>' })]);
  const { repaired } = repairHtml(db, { dry: true });
  assert.equal(repaired.length, 1);
  assert.equal(db.prepare('SELECT summary_original AS s FROM daily_picks').get().s, '<p>x</p>');
});

test('복구: 이미 깨끗한 행은 다시 쓰지 않는다(멱등)', () => {
  const db = seed([pick({ summary: '깨끗한 본문', summaryKo: '깨끗한 본문' })]);
  assert.equal(repairHtml(db).repaired.length, 0);
});
