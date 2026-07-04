// 중복 제거 — 우선순위 4단계 (기술 백서 §3.2)
//
// 1차: 정규화 URL 정확 일치        — HN↔GeekNews 케이스에 가장 유효
// 2차: arXiv ID 일치(버전 무시)    — arXiv 자체 중복에 한정
// 3차: 정규화 제목 자카드 유사도    — ≥0.6 중복 확정
// 4차: 애매 구간(0.3~0.6) LLM 판정 — classifyPair 주입, 없으면 비중복 처리
//
// arXiv 논문이 Phys.org/TechXplore 기사로 다뤄지는 경우 기사에 arXiv ID가
// 안 남으므로 1·2차로 못 잡고 3·4차에 의존한다(§3.2).

export const JACCARD_DUP = 0.6;   // 이상이면 중복 확정
export const JACCARD_AMBIG = 0.3; // 이상~미만이면 LLM 판정 대상

/** URL을 비교용으로 정규화 — 프로토콜/www/트레일링 슬래시/트래킹 파라미터/앵커 무시 */
export function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return String(raw).trim().toLowerCase();
  }
  const tracking = /^(utm_|ref$|ref_src$|fbclid$|gclid$|igshid$|source$|cmpid$)/;
  for (const key of [...u.searchParams.keys()]) {
    if (tracking.test(key)) u.searchParams.delete(key);
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
  const qs = u.searchParams.toString();
  return `${host}${path}${qs ? `?${qs}` : ''}`;
}

/** URL에서 arXiv ID(버전 제거)를 뽑는다. abs/pdf/html 경로 모두 지원. 없으면 null */
export function extractArxivBaseId(url) {
  const m = String(url).match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return m ? m[1] : null;
}

/** 제목을 토큰 배열로 정규화 — 소문자화, 문장부호 제거(한글·숫자 보존) */
export function normalizeTitle(title) {
  return String(title)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** 토큰 집합 자카드 유사도 [0,1] */
export function jaccardSimilarity(tokensA, tokensB) {
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * candidate가 alreadyPicked 중 하나와 같은 소식이면 { picked, method, score }를,
 * 아니면 null을 반환한다. method: url | arxiv_id | jaccard | llm (§5 dedup_log와 동일 어휘)
 *
 * @param {object} candidate
 * @param {object[]} alreadyPicked
 * @param {object} [options]
 * @param {null | ((a, b) => Promise<boolean>)} [options.classifyPair] 4차 LLM 판정기
 */
export async function findDuplicate(candidate, alreadyPicked, { classifyPair = null } = {}) {
  const ambiguous = [];
  const candUrl = normalizeUrl(candidate.url);
  const candArxiv = extractArxivBaseId(candidate.url);
  const candTokens = normalizeTitle(candidate.title);

  for (const picked of alreadyPicked) {
    // 1차: 외부 링크 정확 일치(정규화 후)
    if (candUrl === normalizeUrl(picked.url)) return { picked, method: 'url', score: 1 };

    // 2차: arXiv ID 일치(버전 무시)
    const pickedArxiv = extractArxivBaseId(picked.url);
    if (candArxiv && pickedArxiv && candArxiv === pickedArxiv) {
      return { picked, method: 'arxiv_id', score: 1 };
    }

    // 3차: 정규화 제목 자카드
    const sim = jaccardSimilarity(candTokens, normalizeTitle(picked.title));
    if (sim >= JACCARD_DUP) return { picked, method: 'jaccard', score: sim };
    if (sim >= JACCARD_AMBIG) ambiguous.push({ picked, score: sim });
  }

  // 4차: 애매 구간 LLM 이진 분류 — 분류기 없으면 비중복으로 간주(보수적: 과잉 필터링 방지)
  if (classifyPair) {
    for (const { picked, score } of ambiguous.sort((a, b) => b.score - a.score)) {
      if (await classifyPair(candidate, picked)) return { picked, method: 'llm', score };
    }
  }
  return null;
}
