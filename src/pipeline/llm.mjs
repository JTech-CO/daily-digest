// 멀티 프로바이더 LLM 클라이언트 (기술 백서 §3.2 4차 dedup, §4 번역)
//
// Anthropic / OpenAI / Grok(xAI) / Gemini 중 API 키가 설정된 프로바이더를 자동 선택한다.
// 각 프로바이더의 "최상위이면서 빠른" 모델을 기본값으로 쓰되 env로 override 가능:
//   Anthropic  claude-sonnet-5     (ANTHROPIC_MODEL) — Opus 4.8도 사용 가능
//   OpenAI     gpt-5.5             (OPENAI_MODEL)
//   Grok(xAI)  grok-4.3           (XAI_MODEL)
//   Gemini     gemini-3.5-flash   (GEMINI_MODEL)
//
// 키가 여럿이면 LLM_PROVIDER로 명시하거나, 없으면 PRIORITY 순서로 첫 키를 쓴다.
// 모델 ID는 릴리스 시점에 따라 달라질 수 있으므로 위 env로 정정할 수 있게 열어 둔다.

// 각 프로바이더: 키 탐색 → 요청 조립(build) → 응답 텍스트 추출(extract).
const PROVIDERS = {
  anthropic: {
    name: 'anthropic',
    keys: ['ANTHROPIC_API_KEY'],
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-sonnet-5',
    build({ apiKey, model, system, user, maxTokens }) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
      };
    },
    extract: data => (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(''),
  },

  openai: {
    name: 'openai',
    keys: ['OPENAI_API_KEY'],
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-5.5',
    build({ apiKey, model, system, user, maxTokens }) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: {
          model,
          max_completion_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        },
      };
    },
    extract: data => data.choices?.[0]?.message?.content ?? '',
  },

  grok: {
    name: 'grok',
    keys: ['XAI_API_KEY', 'GROK_API_KEY'],
    modelEnv: 'XAI_MODEL',
    defaultModel: 'grok-4.3',
    build({ apiKey, model, system, user, maxTokens }) {
      // xAI는 OpenAI 호환 API
      return {
        url: 'https://api.x.ai/v1/chat/completions',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: {
          model,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        },
      };
    },
    extract: data => data.choices?.[0]?.message?.content ?? '',
  },

  gemini: {
    name: 'gemini',
    keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-3.5-flash',
    build({ apiKey, model, system, user, maxTokens }) {
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
    extract: data => (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join(''),
  },
};

// 키가 여럿일 때의 기본 우선순위(LLM_PROVIDER로 명시 override 가능)
const PRIORITY = ['anthropic', 'openai', 'gemini', 'grok'];

function keyFor(provider) {
  for (const k of provider.keys) {
    if (process.env[k]) return process.env[k];
  }
  return null;
}

/** 현재 활성 프로바이더 객체(없으면 null). LLM_PROVIDER가 지정되면 그 프로바이더만 고려. */
export function activeProvider() {
  const forced = process.env.LLM_PROVIDER;
  if (forced) {
    const p = PROVIDERS[forced.toLowerCase()];
    return p && keyFor(p) ? p : null;
  }
  for (const name of PRIORITY) {
    if (keyFor(PROVIDERS[name])) return PROVIDERS[name];
  }
  return null;
}

export function hasLlm() {
  return activeProvider() !== null;
}

/** 활성 프로바이더 이름·모델(로그용). 키 없으면 null. */
export function activeProviderInfo() {
  const p = activeProvider();
  if (!p) return null;
  return { name: p.name, model: process.env[p.modelEnv] || p.defaultModel };
}

/**
 * 활성 프로바이더로 system+user 프롬프트를 보내 JSON 응답을 파싱해 반환한다.
 * 프로바이더별 응답 형태 차이를 extract()로 흡수하고, 코드펜스 감싸기까지 처리한다.
 */
export async function askLlmJSON({ system, user, maxTokens = 600, fetchImpl = fetch }) {
  const p = activeProvider();
  if (!p) throw new Error('[llm] 사용 가능한 API 키가 없음 (ANTHROPIC/OPENAI/XAI/GEMINI)');

  const apiKey = keyFor(p);
  const model = process.env[p.modelEnv] || p.defaultModel;
  const { url, headers, body } = p.build({ apiKey, model, system, user, maxTokens });

  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`[llm:${p.name}] API 오류 ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = p.extract(data);
  const jsonText = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  try {
    return JSON.parse(jsonText.trim());
  } catch (cause) {
    throw new Error(`[llm:${p.name}] JSON 파싱 실패: ${text.slice(0, 200)}`, { cause });
  }
}

/**
 * 4차 dedup용 "같은 소식인가" 이진 분류기(§3.2).
 * 키가 없으면 null — 호출부는 애매 구간을 비중복으로 처리한다.
 * @returns {null | ((a: object, b: object) => Promise<boolean>)}
 */
export function makeLlmPairClassifier({ fetchImpl = fetch } = {}) {
  if (!hasLlm()) return null;
  return async (a, b) => {
    const result = await askLlmJSON({
      fetchImpl,
      maxTokens: 100,
      system: '두 기사가 같은 소식(같은 사건/발표/논문)을 다루는지 판정한다. '
        + '언어가 달라도 내용이 같으면 같은 소식이다. 출력은 JSON만: {"duplicate": true|false}',
      user: `A: [${a.source}] ${a.title}\n${a.summary?.slice(0, 300) ?? ''}\n\n`
        + `B: [${b.source}] ${b.title}\n${b.summary?.slice(0, 300) ?? ''}`,
    });
    return result.duplicate === true;
  };
}
