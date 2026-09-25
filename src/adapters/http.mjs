// 어댑터 공용 HTTP 헬퍼 — 소스·URL 컨텍스트를 포함한 에러, 선택적 재시도(지수 백오프)
//
// 5개 어댑터가 병렬로 돌 때(§1) 어느 소스의 어느 요청이 죽었는지
// 로그만으로 식별 가능해야 한다. arXiv 429(§9)는 retries 옵션으로 흡수한다.

export const USER_AGENT = 'daily-digest/0.1 (personal curation; contact: mjwbryan131@gmail.com)';

// 신뢰 불가 외부 응답의 본문 상한(피드·홈 HTML엔 충분). 무제한 버퍼링에 의한
// 메모리 고갈 DoS와 파싱 폭발(ReDoS 증폭)을 막는다.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 응답 본문을 상한(MAX_RESPONSE_BYTES)까지만 스트리밍으로 읽는다. 초과 시 중단·throw. */
async function readCapped(res, source, url) {
  // Content-Length가 이미 상한을 넘으면 즉시 거절(스트림을 열지 않음)
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error(`[${source}] 응답이 상한(${MAX_RESPONSE_BYTES}B)을 초과(Content-Length ${declared}): ${url}`);
  }
  const reader = res.body?.getReader?.();
  if (!reader) return res.text(); // 스트림 미지원 환경(테스트 mock 등) 폴백

  const decoder = new TextDecoder('utf-8');
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`[${source}] 응답이 상한(${MAX_RESPONSE_BYTES}B)을 초과: ${url}`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return text + decoder.decode();
}

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
    return readCapped(res, source, url);
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

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * HTML 엔티티 디코딩 — 이름 엔티티와 숫자 참조(&#39; &#x2F; 등)를 모두 처리한다.
 * HN story_text는 '/'까지 &#x2F;로 escape해 오므로 16진 참조 처리가 필수다.
 * 한 번만 훑기 때문에 &amp;lt;는 &lt;로 남는다(이중 디코딩 방지).
 */
export function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    const code = body[1] === 'x' || body[1] === 'X'
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : whole;
  });
}

/**
 * HTML 조각 → 평문. 태그를 걷어내고 엔티티를 디코딩한다.
 *
 * 주의: '<'가 그냥 쓰인 평문(arXiv 초록의 부등호 등)에 적용하면 문장을 태그로
 * 오인해 지워버린다. 소스가 실제로 HTML을 주는 필드에만 쓴다.
 */
export function htmlToText(html) {
  if (typeof html !== 'string' || html === '') return '';
  let text = decodeEntities(stripTags(html));
  // 디코딩하고 나서야 드러나는 마크업이 있다 — GeekNews는 본문의 <a>를 &lt;a&gt;로 실어 보낸다.
  // 여기서 한 번 더 걷어내되, 엔티티는 다시 풀지 않는다(이중 디코딩 방지).
  if (LOOKS_LIKE_HTML.test(text)) text = stripTags(text);
  return text
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 마크업이 섞여 있을 때만 평문화한다.
 *
 * 이미 평문인 필드(rss-parser contentSnippet 등)에 쓴다. 그런 필드에는 'a < b, c > d'나
 * 'lab | up >/conf'처럼 꺾쇠가 그냥 들어 있을 수 있어 무조건 태그를 걷어내면 본문이 잘린다.
 * 반대로 소스가 확실히 HTML을 주는 필드(HN story_text 등)에는 htmlToText를 바로 쓴다 —
 * 거기선 평문 '<'가 &lt;로 와 있어 걷어낼 태그와 구분된다.
 */
export function stripHtmlIfAny(text) {
  if (typeof text !== 'string' || text === '') return '';
  return LOOKS_LIKE_HTML.test(text) ? htmlToText(text) : text;
}

// 실제 태그처럼 보이는 조각(닫는 '>'가 잘려나간 것 포함 — 소스가 본문을 중간에 자르기도 한다).
const LOOKS_LIKE_HTML =
  /<\/?(a|p|br|div|span|img|ul|ol|li|pre|code|em|strong|b|i|h[1-6]|blockquote|table)\b[^>]*>?/i;

function stripTags(s) {
  return s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|br|div|li|tr|h[1-6])\b[^>]*>/gi, '\n')   // 블록 경계는 줄바꿈으로 보존
    .replace(/<[^>]*>/g, '')
    .replace(/<[a-zA-Z][^>]*$/, '');                          // 소스가 본문을 자르며 남긴 미완성 태그
}
