// 멀티 프로바이더 LLM 클라이언트 검증 (Anthropic/OpenAI/Grok/Gemini)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askLlmJSON, hasLlm, activeProviderInfo } from '../src/pipeline/llm.mjs';

const ALL_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER', 'ANTHROPIC_MODEL', 'OPENAI_MODEL',
  'XAI_MODEL', 'GEMINI_MODEL'];

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

// 요청을 가로채 URL/헤더/바디를 기록하고, 고정 응답을 돌려주는 mock
function captureFetch(responsePayload) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, statusText: 'OK', async json() { return responsePayload; }, async text() { return JSON.stringify(responsePayload); } };
  };
  return { impl, calls };
}

const RESULT = { title_ko: '번역', summary_ko: '요약' };

// 프로바이더별 응답 형태
const shape = {
  anthropic: { content: [{ type: 'text', text: JSON.stringify(RESULT) }] },
  openai: { choices: [{ message: { content: JSON.stringify(RESULT) } }] },
  grok: { choices: [{ message: { content: JSON.stringify(RESULT) } }] },
  gemini: { candidates: [{ content: { parts: [{ text: JSON.stringify(RESULT) }] } }] },
};

// ── 키 탐지·우선순위 ──────────────────────────────────────────

test('키 없음: hasLlm false, activeProviderInfo null', withEnv({}, () => {
  assert.equal(hasLlm(), false);
  assert.equal(activeProviderInfo(), null);
}));

test('anthropic 키만: sonnet-5 기본 모델', withEnv({ ANTHROPIC_API_KEY: 'k' }, () => {
  assert.deepEqual(activeProviderInfo(), { name: 'anthropic', model: 'claude-sonnet-5' });
}));

test('openai 키만: gpt-5.5 기본 모델', withEnv({ OPENAI_API_KEY: 'k' }, () => {
  assert.deepEqual(activeProviderInfo(), { name: 'openai', model: 'gpt-5.5' });
}));

test('grok 키(XAI_API_KEY): grok-4.3', withEnv({ XAI_API_KEY: 'k' }, () => {
  assert.deepEqual(activeProviderInfo(), { name: 'grok', model: 'grok-4.3' });
}));

test('grok 대체 키(GROK_API_KEY)도 인식', withEnv({ GROK_API_KEY: 'k' }, () => {
  assert.equal(activeProviderInfo()?.name, 'grok');
}));

test('gemini 키: gemini-3.5-flash', withEnv({ GEMINI_API_KEY: 'k' }, () => {
  assert.deepEqual(activeProviderInfo(), { name: 'gemini', model: 'gemini-3.5-flash' });
}));

test('키 여럿이면 우선순위(anthropic 먼저)', withEnv({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' }, () => {
  assert.equal(activeProviderInfo().name, 'anthropic');
}));

test('LLM_PROVIDER로 명시 override', withEnv({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', LLM_PROVIDER: 'openai' }, () => {
  assert.equal(activeProviderInfo().name, 'openai');
}));

test('모델 env override', withEnv({ ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'claude-opus-4-8' }, () => {
  assert.equal(activeProviderInfo().model, 'claude-opus-4-8');
}));

// ── 프로바이더별 요청 조립 ────────────────────────────────────

test('anthropic 요청: /v1/messages, x-api-key, system 분리', withEnv({ ANTHROPIC_API_KEY: 'sk-a' }, async () => {
  const { impl, calls } = captureFetch(shape.anthropic);
  const out = await askLlmJSON({ system: 'SYS', user: 'USR', fetchImpl: impl });
  assert.deepEqual(out, RESULT);
  assert.match(calls[0].url, /api\.anthropic\.com\/v1\/messages/);
  assert.equal(calls[0].headers['x-api-key'], 'sk-a');
  assert.equal(calls[0].body.system, 'SYS');
  assert.equal(calls[0].body.messages[0].content, 'USR');
  assert.equal(calls[0].body.model, 'claude-sonnet-5');
}));

test('openai 요청: chat/completions, Bearer, system+user 메시지, json 모드', withEnv({ OPENAI_API_KEY: 'sk-o' }, async () => {
  const { impl, calls } = captureFetch(shape.openai);
  const out = await askLlmJSON({ system: 'SYS', user: 'USR', fetchImpl: impl });
  assert.deepEqual(out, RESULT);
  assert.match(calls[0].url, /api\.openai\.com\/v1\/chat\/completions/);
  assert.equal(calls[0].headers.authorization, 'Bearer sk-o');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.equal(calls[0].body.messages[1].content, 'USR');
  assert.equal(calls[0].body.response_format.type, 'json_object');
}));

test('grok 요청: api.x.ai, OpenAI 호환 형태', withEnv({ XAI_API_KEY: 'sk-x' }, async () => {
  const { impl, calls } = captureFetch(shape.grok);
  const out = await askLlmJSON({ system: 'SYS', user: 'USR', fetchImpl: impl });
  assert.deepEqual(out, RESULT);
  assert.match(calls[0].url, /api\.x\.ai\/v1\/chat\/completions/);
  assert.equal(calls[0].headers.authorization, 'Bearer sk-x');
  assert.equal(calls[0].body.model, 'grok-4.3');
}));

test('gemini 요청: generateContent, x-goog-api-key, system_instruction/contents', withEnv({ GEMINI_API_KEY: 'sk-g' }, async () => {
  const { impl, calls } = captureFetch(shape.gemini);
  const out = await askLlmJSON({ system: 'SYS', user: 'USR', fetchImpl: impl });
  assert.deepEqual(out, RESULT);
  assert.match(calls[0].url, /gemini-3\.5-flash:generateContent/);
  assert.equal(calls[0].headers['x-goog-api-key'], 'sk-g');
  assert.equal(calls[0].body.system_instruction.parts[0].text, 'SYS');
  assert.equal(calls[0].body.contents[0].parts[0].text, 'USR');
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
}));

// ── 오류·파싱 ─────────────────────────────────────────────────

test('키 없이 askLlmJSON 호출하면 throw', withEnv({}, async () => {
  await assert.rejects(askLlmJSON({ system: 's', user: 'u' }), /사용 가능한 API 키가 없음/);
}));

test('API 오류는 프로바이더명 포함해 throw', withEnv({ OPENAI_API_KEY: 'k' }, async () => {
  const impl = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', async text() { return 'bad key'; } });
  await assert.rejects(askLlmJSON({ system: 's', user: 'u', fetchImpl: impl }), /\[llm:openai\] API 오류 401/);
}));

test('gemini 코드펜스 JSON도 파싱', withEnv({ GEMINI_API_KEY: 'k' }, async () => {
  const fenced = { candidates: [{ content: { parts: [{ text: '```json\n{"title_ko":"제목"}\n```' }] } }] };
  const { impl } = captureFetch(fenced);
  const out = await askLlmJSON({ system: 's', user: 'u', fetchImpl: impl });
  assert.deepEqual(out, { title_ko: '제목' });
}));
