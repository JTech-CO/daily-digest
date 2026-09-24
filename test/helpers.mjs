// 테스트 공용 헬퍼 — 파일마다 재정의되던 env 격리·mock 응답 팩토리를 한곳에 모은다.
// (node --test "test/*.test.mjs" 글롭에 걸리지 않으므로 테스트 파일로 실행되지 않는다)

/** LLM 관련 환경변수 전체 — 실행 환경에 우연히 키가 있어도 테스트가 결정적이도록 모두 비운다 */
export const ALL_LLM_ENV = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER',
  'ANTHROPIC_MODEL', 'OPENAI_MODEL', 'XAI_MODEL', 'GEMINI_MODEL',
];

/** setKeys만 설정된 깨끗한 env에서 fn을 실행하고 원래 env를 복원한다 */
export function withEnv(setKeys, fn) {
  return async () => {
    const saved = Object.fromEntries(ALL_LLM_ENV.map(k => [k, process.env[k]]));
    for (const k of ALL_LLM_ENV) delete process.env[k];
    Object.assign(process.env, setKeys);
    try { await fn(); } finally {
      for (const k of ALL_LLM_ENV) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  };
}

/** 기본: anthropic 키만 설정(mock이 anthropic 응답 형태를 반환하므로) */
export const withKey = fn => withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, fn);

/** Anthropic Messages API의 콘텐츠 블록 형태로 감싼다 */
export const asContent = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

/** asContent로 감싼 JSON을 돌려주는 Response 유사 객체 */
export const llmRes = obj => ({
  ok: true, status: 200, statusText: 'OK',
  async json() { return asContent(obj); },
  async text() { return JSON.stringify(asContent(obj)); },
});

/** 기사 HTML을 돌려주는 Response 유사 객체(전문 추출 경로용) */
export const htmlRes = html => ({
  ok: true, status: 200, statusText: 'OK', headers: new Headers(),
  async text() { return html; },
});

/** payload를 그대로 돌려주는 fetch 구현(문자열이면 비-JSON 본문으로 취급) */
export function mockApi(payload, { status = 200 } = {}) {
  return async () => ({
    ok: status < 400,
    status,
    statusText: 'x',
    async text() { return typeof payload === 'string' ? payload : JSON.stringify(payload); },
    async json() { return typeof payload === 'string' ? JSON.parse(payload) : payload; },
  });
}
