// 상세 뷰 3구성 생성 검증 (제목/패널 클릭 시 여는 창)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDetail, generateDetailsAll } from '../src/pipeline/detail.mjs';

const ALL_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER'];
function withEnv(setKeys, fn) {
  return async () => {
    const saved = Object.fromEntries(ALL_KEYS.map(k => [k, process.env[k]]));
    for (const k of ALL_KEYS) delete process.env[k];
    Object.assign(process.env, setKeys);
    try { await fn(); } finally {
      for (const k of ALL_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };
}
const withKey = fn => withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, fn);

const asContent = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const mockApi = payload => async () => ({
  ok: true, status: 200, statusText: 'OK',
  async json() { return payload; }, async text() { return JSON.stringify(payload); },
});
const captureApi = (payload) => {
  const calls = [];
  return {
    calls,
    impl: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, statusText: 'OK', async json() { return payload; }, async text() { return JSON.stringify(payload); } };
    },
  };
};

const enItem = {
  source: 'hackernews', title: 'Optical writing of antiferromagnets',
  summary: 'Researchers demonstrate optical control of antiferromagnets.', url: 'https://phys.org/x',
};
const koItem = { source: 'geeknews', title: '루프 엔지니어링의 미학', summary: '에이전트 하네스 설계...', url: 'https://news.hada.io/topic?id=1' };

const DETAIL = {
  translation: '반강자성체의 광학적 기록. 연구진이 광학 제어를 시연했다.',
  summary: '핵심 요약 문단.',
  blog: '# 반강자성체 광학 기록\n\n도입 문단.\n\n- 포인트 1\n- 포인트 2\n\n시사점.',
};

test('키 없음: 전부 null', withEnv({}, async () => {
  const d = await generateDetail(enItem, { fetchImpl: mockApi(asContent(DETAIL)) });
  assert.deepEqual(d, { translation: null, summary: null, blog: null });
}));

test('영어 항목: 3구성 생성', withKey(async () => {
  const d = await generateDetail(enItem, { fetchImpl: mockApi(asContent(DETAIL)) });
  assert.equal(d.translation, DETAIL.translation);
  assert.equal(d.summary, DETAIL.summary);
  assert.match(d.blog, /# 반강자성체/);
}));

test('영어 항목: 번역(정제 아님) 프롬프트 사용', withKey(async () => {
  const { impl, calls } = captureApi(asContent(DETAIL));
  await generateDetail(enItem, { fetchImpl: impl });
  assert.match(calls[0].body.system, /영어 기술\/과학 뉴스/);   // TRANSLATE 시스템
  assert.match(calls[0].body.messages[0].content, /Optical writing/);
}));

test('GeekNews: 정제 프롬프트 사용(이미 한국어)', withKey(async () => {
  const { impl, calls } = captureApi(asContent(DETAIL));
  await generateDetail(koItem, { fetchImpl: impl });
  assert.match(calls[0].body.system, /이미 한국어/);           // REFINE 시스템
}));

test('JSON 파싱 실패: 전부 null + detailError', withKey(async () => {
  const garbage = { content: [{ type: 'text', text: '죄송합니다 생성하겠습니다...' }] };
  const d = await generateDetail(enItem, { fetchImpl: mockApi(garbage) });
  assert.deepEqual({ t: d.translation, s: d.summary, b: d.blog }, { t: null, s: null, b: null });
  assert.match(d.detailError, /JSON 파싱 실패/);
}));

test('빈 필드는 null로 정규화', withKey(async () => {
  const d = await generateDetail(enItem, { fetchImpl: mockApi(asContent({ translation: '번역', summary: '   ', blog: '' })) });
  assert.equal(d.translation, '번역');
  assert.equal(d.summary, null);   // 공백만 → null
  assert.equal(d.blog, null);
}));

test('generateDetailsAll: 항목에 detail* 필드 부착 + 통계', withKey(async () => {
  const items = [enItem, { ...enItem, title: '2번' }];
  const { items: out, stats } = await generateDetailsAll(items, { fetchImpl: mockApi(asContent(DETAIL)) });
  assert.equal(out.length, 2);
  assert.equal(out[0].detailTranslation, DETAIL.translation);
  assert.equal(out[0].detailSummary, DETAIL.summary);
  assert.ok(out[0].detailBlog);
  assert.equal(stats.total, 2);
  assert.equal(stats.generated, 2);
  assert.equal(stats.failed, 0);
}));

test('generateDetailsAll: 키 없으면 부착은 하되 전부 null, generated=0', withEnv({}, async () => {
  const { items: out, stats } = await generateDetailsAll([enItem], { fetchImpl: mockApi(asContent(DETAIL)) });
  assert.equal(out[0].detailTranslation, null);
  assert.equal(stats.generated, 0);
  assert.equal(stats.failed, 0);
}));
