// 번역 파이프라인 검증 (M3 DoD, 기술 백서 §4)
// 실 API 대신 mock fetch로 JSON 파싱·폴백·정제 분기를 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateItem, translateAll } from '../src/pipeline/translate.mjs';

// 모든 프로바이더 키를 격리한다 — 실행 환경에 우연히 키가 있어도 결정적으로 동작
const ALL_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER'];

function withEnv(setKeys, fn) {
  return async () => {
    const saved = Object.fromEntries(ALL_KEYS.map(k => [k, process.env[k]]));
    for (const k of ALL_KEYS) delete process.env[k];
    Object.assign(process.env, setKeys);
    try { await fn(); } finally {
      for (const k of ALL_KEYS) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  };
}
// 기본: anthropic 키만 설정(mock이 anthropic 응답 형태를 반환하므로)
const withKey = fn => withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, fn);

// Anthropic Messages API 응답을 흉내내는 mock fetch
function mockApi(payload, { status = 200 } = {}) {
  return async () => ({
    ok: status < 400,
    status,
    statusText: 'x',
    async text() { return typeof payload === 'string' ? payload : JSON.stringify(payload); },
    async json() { return typeof payload === 'string' ? JSON.parse(payload) : payload; },
  });
}
const asContent = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

const enItem = {
  source: 'hackernews', sourceItemId: '1', title: 'Optical writing of antiferromagnets',
  url: 'https://phys.org/x', summary: 'Researchers demonstrate optical control.',
  publishedAt: '2026-07-04T00:00:00.000Z', popularitySignal: 714, isPopularPick: true,
  selectionReason: 'primary',
};
const koItem = {
  source: 'geeknews', sourceItemId: '2', title: '루프엔지니어링의미학',
  url: 'https://news.hada.io/topic?id=1', summary: '에이전트를 안정적으로...',
  publishedAt: '2026-07-04T00:00:00.000Z', popularitySignal: 16, isPopularPick: true,
  selectionReason: 'primary',
};

test('키 없음: 원문 유지, is_translated=false', withEnv({}, async () => {
  const r = await translateItem(enItem, { fetchImpl: mockApi(asContent({ title_ko: '무시됨' })) });
  assert.equal(r.titleKo, enItem.title);      // API를 부르지 않고 원문 유지
  assert.equal(r.summaryKo, enItem.summary);
  assert.equal(r.isTranslated, false);
}));

test('영어 항목 번역: title_ko/summary_ko 반영, is_translated=true', withKey(async () => {
  const r = await translateItem(enItem, {
    fetchImpl: mockApi(asContent({ title_ko: '반강자성체의 광학적 기록', summary_ko: '연구진이 광학 제어를 시연했다.' })),
  });
  assert.equal(r.titleKo, '반강자성체의 광학적 기록');
  assert.equal(r.summaryKo, '연구진이 광학 제어를 시연했다.');
  assert.equal(r.isTranslated, true);
}));

test('GeekNews: 정제 모드 → is_translated=false(번역 아님, §0)', withKey(async () => {
  const r = await translateItem(koItem, {
    fetchImpl: mockApi(asContent({ title_ko: '루프 엔지니어링의 미학', summary_ko: '에이전트를 안정적으로 운용하려면...' })),
  });
  assert.equal(r.titleKo, '루프 엔지니어링의 미학'); // 정제됨(띄어쓰기 교정)
  assert.equal(r.isTranslated, false);              // 정제는 번역이 아님
}));

test('코드펜스로 감싼 JSON도 파싱', withKey(async () => {
  const fenced = { content: [{ type: 'text', text: '```json\n{"title_ko":"제목","summary_ko":null}\n```' }] };
  const r = await translateItem(enItem, { fetchImpl: mockApi(fenced) });
  assert.equal(r.titleKo, '제목');
  assert.equal(r.summaryKo, null);
  assert.equal(r.isTranslated, true);
}));

test('JSON 파싱 실패: 원문 폴백 + translateError 기록', withKey(async () => {
  const garbage = { content: [{ type: 'text', text: '죄송합니다, 번역하겠습니다: 반강자성체...' }] };
  const r = await translateItem(enItem, { fetchImpl: mockApi(garbage) });
  assert.equal(r.titleKo, enItem.title);   // 폴백
  assert.equal(r.isTranslated, false);
  assert.match(r.translateError, /JSON 파싱 실패/);
}));

test('API 오류(4xx): 원문 폴백 + translateError', withKey(async () => {
  const r = await translateItem(enItem, { fetchImpl: mockApi('rate limited', { status: 429 }) });
  assert.equal(r.titleKo, enItem.title);
  assert.equal(r.isTranslated, false);
  assert.match(r.translateError, /API 오류 429/);
}));

test('translateAll 통계: 실패율 집계', withKey(async () => {
  let n = 0;
  const flaky = async () => {
    n++;
    const good = { content: [{ type: 'text', text: '{"title_ko":"제목","summary_ko":"요약"}' }] };
    const bad = { content: [{ type: 'text', text: '깨진 응답' }] };
    const payload = n === 2 ? bad : good; // 2번째만 실패
    return { ok: true, status: 200, statusText: 'x', async json() { return payload; }, async text() { return JSON.stringify(payload); } };
  };
  const order = [enItem, { ...enItem, sourceItemId: '9' }, koItem];
  const { items, stats } = await translateAll(order, { fetchImpl: flaky });
  assert.equal(stats.total, 3);
  assert.equal(stats.failed, 1);
  assert.ok(Math.abs(stats.failureRate - 1 / 3) < 1e-9);
  assert.equal(items[1].isTranslated, false); // 실패 항목
}));
