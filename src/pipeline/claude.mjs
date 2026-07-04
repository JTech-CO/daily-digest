// Claude API 공용 클라이언트 (기술 백서 §3.2 4차 dedup, §4 번역)
//
// Claude Haiku 4.5 — 이 규모(일 수십 콜)에서는 실시간 Messages API로 충분(§4.2).
// ANTHROPIC_API_KEY가 없으면 호출부가 각자 폴백한다(dedup: 애매 구간 비중복 처리,
// 번역: 원문 유지 + is_translated=0).

const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * system+user 프롬프트로 JSON 응답을 요청하고 파싱해 반환한다.
 * 모델이 코드펜스로 감싸 응답하는 경우까지 흡수한다.
 */
export async function askClaudeJSON({ system, user, maxTokens = 600, fetchImpl = fetch }) {
  if (!hasApiKey()) throw new Error('[claude] ANTHROPIC_API_KEY가 설정되지 않음');

  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[claude] API 오류 ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonText = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  try {
    return JSON.parse(jsonText.trim());
  } catch (cause) {
    throw new Error(`[claude] JSON 파싱 실패: ${text.slice(0, 200)}`, { cause });
  }
}

/**
 * 4차 dedup용 "같은 소식인가" 이진 분류기를 만든다(§3.2).
 * API 키가 없으면 null을 반환 — 호출부는 애매 구간을 비중복으로 처리한다.
 * @returns {null | ((a: object, b: object) => Promise<boolean>)}
 */
export function makeLlmPairClassifier({ fetchImpl = fetch } = {}) {
  if (!hasApiKey()) return null;
  return async (a, b) => {
    const result = await askClaudeJSON({
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
