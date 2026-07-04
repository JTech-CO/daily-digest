// 어댑터 공용 HTTP 헬퍼 — 소스·URL 컨텍스트를 포함한 에러, 선택적 재시도(지수 백오프)
//
// 5개 어댑터가 병렬로 돌 때(§1) 어느 소스의 어느 요청이 죽었는지
// 로그만으로 식별 가능해야 한다. arXiv 429(§9)는 retries 옵션으로 흡수한다.

export const USER_AGENT = 'daily-digest/0.1 (personal curation; contact: mjwbryan131@gmail.com)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 텍스트 응답을 가져온다. 실패 시 [source] 컨텍스트를 포함해 throw.
 *
 * @param {string} source    소스 식별자(에러 메시지용)
 * @param {string} url
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.retries=0]        429/5xx/네트워크 오류 재시도 횟수
 * @param {number} [options.retryDelayMs=3000] 첫 재시도 대기(이후 2배씩 증가)
 * @returns {Promise<string>}
 */
export async function fetchText(source, url, { fetchImpl = fetch, retries = 0, retryDelayMs = 3000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
    } catch (cause) {
      lastError = new Error(`[${source}] 요청 실패: ${url}`, { cause });
      continue;
    }
    if (!res.ok) {
      lastError = new Error(`[${source}] API 응답 오류 ${res.status} ${res.statusText}: ${url}`);
      if (res.status === 429 || res.status >= 500) continue; // 재시도 대상
      throw lastError;                                       // 4xx는 재시도 무의미
    }
    return res.text();
  }
  throw lastError;
}

/**
 * JSON 응답을 가져온다. 비-JSON 응답(프록시/CDN 장애 페이지 등)도 컨텍스트와 함께 throw.
 */
export async function fetchJson(source, url, options = {}) {
  const text = await fetchText(source, url, options);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`[${source}] JSON 파싱 실패(비-JSON 응답): ${url}`, { cause });
  }
}

/** HTML 엔티티 최소 디코딩(피드·마크업에서 자주 등장하는 것만) */
export function decodeEntities(s) {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');
}
