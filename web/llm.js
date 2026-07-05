// 브라우저 LLM 클라이언트 — 사용자가 사이트에서 입력한 API 키로 직접 호출(BYOK).
//
// 브라우저 직접 호출(CORS) 지원 실측 근거:
//   anthropic — anthropic-dangerous-direct-browser-access: true 헤더 필요
//   openai    — 지원(특수 헤더 불필요)
//   gemini    — 지원(x-goog-api-key 헤더)
//   grok(xAI) — 공식 지원 없음, CORS로 차단될 가능성 높음(실패 시 안내)
//
// 키는 이 브라우저(localStorage)에만 저장되고, 선택한 프로바이더로만 직접 전송된다.

const STORE_KEY = 'dd:llmConfig';

export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-sonnet-5',
    corsRisk: false,
    build(apiKey, model, system, user, maxTokens) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json',
        },
        body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
      };
    },
    extract: d => (d.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(''),
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-5.5',
    corsRisk: false,
    build(apiKey, model, system, user, maxTokens) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: {
          model, max_completion_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        },
      };
    },
    extract: d => d.choices?.[0]?.message?.content ?? '',
  },
  grok: {
    label: 'Grok (xAI)',
    defaultModel: 'grok-4.3',
    corsRisk: true, // 브라우저 직접 호출이 CORS로 막힐 수 있음
    build(apiKey, model, system, user, maxTokens) {
      return {
        url: 'https://api.x.ai/v1/chat/completions',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: {
          model, max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        },
      };
    },
    extract: d => d.choices?.[0]?.message?.content ?? '',
  },
  gemini: {
    label: 'Gemini',
    defaultModel: 'gemini-3.5-flash',
    corsRisk: false,
    build(apiKey, model, system, user, maxTokens) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: {
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
        },
      };
    },
    extract: d => (d.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join(''),
  },
};

export function defaultModelFor(provider) {
  return PROVIDERS[provider]?.defaultModel ?? '';
}

/** 저장된 설정을 반환한다(없으면 null). */
export function getConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.provider && c.apiKey ? c : null;
  } catch { return null; }
}

export function saveConfig({ provider, model, apiKey }) {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    provider,
    model: model?.trim() || defaultModelFor(provider),
    apiKey: apiKey.trim(),
  }));
}

export function clearConfig() {
  localStorage.removeItem(STORE_KEY);
}

export function hasConfig() {
  return getConfig() !== null;
}

/** 설정된 프로바이더로 JSON 응답을 요청한다. 타임아웃·코드펜스 파싱 포함. */
export async function askLlmJSON({ system, user, maxTokens = 2000, timeoutMs = 60000 }) {
  const cfg = getConfig();
  if (!cfg) throw new Error('API 키가 설정되지 않았습니다. 우측 상단 ⚙ 설정에서 입력하세요.');
  const provider = PROVIDERS[cfg.provider];
  if (!provider) throw new Error(`알 수 없는 프로바이더: ${cfg.provider}`);

  const model = cfg.model || provider.defaultModel;
  const { url, headers, body } = provider.build(cfg.apiKey, model, system, user, maxTokens);
  const timeoutMsg = `요청 시간 초과(${Math.round(timeoutMs / 1000)}초). 다시 시도하세요.`;

  // 멈춘 요청이 버튼을 영구 잠그지 않도록 타임아웃으로 중단한다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error(timeoutMsg);
      // CORS/네트워크 실패는 여기로 온다(TypeError: Failed to fetch)
      const hint = provider.corsRisk
        ? ` (${provider.label}는 브라우저 직접 호출이 CORS로 차단될 수 있습니다. 다른 프로바이더를 사용해 보세요.)`
        : ' (네트워크 또는 CORS 오류)';
      throw new Error(`요청 실패${hint}`);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch {}
      throw new Error(`API 오류 ${res.status}: ${detail}`);
    }

    // 200이어도 프록시/게이트웨이가 HTML 등 비-JSON을 줄 수 있다 — 원시 예외 대신 안내.
    let data;
    try {
      data = await res.json();
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error(timeoutMsg);
      throw new Error('응답 형식 오류(JSON이 아닌 응답). 프록시/게이트웨이가 개입했을 수 있습니다.');
    }

    const text = provider.extract(data);
    const jsonText = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
    try {
      return JSON.parse(jsonText.trim());
    } catch {
      throw new Error(`응답 JSON 파싱 실패: ${text.slice(0, 120)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// 상세 3구성 생성 프롬프트 — src/pipeline/detail.mjs와 동일한 규격
const OUT_SPEC =
  '출력은 JSON만: {"translation":"...","summary":"...","blog":"..."}. '
  + 'blog는 마크다운(제안 제목 # 한 줄, 도입 문단, 핵심 포인트 불릿, 짧은 시사점). '
  + '주어진 제목·요약 범위를 넘어 없는 사실을 지어내지 말 것.';
const SYS_TRANSLATE =
  '너는 기술/과학 콘텐츠 에디터다. 입력은 영어 기술/과학 뉴스의 제목과 요약(초록/발췌)이며 전체 본문이 아니다. '
  + '한국어로 translation(제목·요약을 자연스럽고 충실히 옮긴 번역본), summary(핵심을 3~6문장 한두 문단), '
  + 'blog(기술 블로그 글 초안)을 생성한다. ' + OUT_SPEC;
const SYS_REFINE =
  '너는 한국어 기술 콘텐츠 에디터다. 입력은 이미 한국어인 기술 뉴스의 제목과 요약이다. '
  + 'translation(원문을 맞춤법·표기만 정제), summary(핵심 3~6문장 한두 문단), blog(기술 블로그 초안)을 생성한다. ' + OUT_SPEC;

/** 상세 뷰용 3구성을 브라우저에서 직접 생성한다. */
export async function generateDetail(pick) {
  const refineOnly = pick.source === 'geeknews';
  const user = `출처: ${pick.source}\n제목: ${pick.title_original || pick.title_ko}\n요약: ${pick.summary_original || pick.summary_ko || '(요약 없음)'}`;
  const out = await askLlmJSON({ system: refineOnly ? SYS_REFINE : SYS_TRANSLATE, user, maxTokens: 2000 });
  const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { translation: str(out.translation), summary: str(out.summary), blog: str(out.blog) };
}

// 생성 결과 캐시(재방문 시 재생성 방지)
const cacheKey = pick => `dd:detail:${pick.source}:${pick.source_item_id}`;
export function cachedDetail(pick) {
  try { return JSON.parse(localStorage.getItem(cacheKey(pick)) || 'null'); } catch { return null; }
}
export function cacheDetail(pick, detail) {
  try { localStorage.setItem(cacheKey(pick), JSON.stringify(detail)); } catch {}
}
