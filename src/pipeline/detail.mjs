// 상세 뷰 콘텐츠 생성 (제목/패널 클릭 시 여는 창)
//
// 정적 사이트라 상세 콘텐츠는 파이프라인 단계에서 미리 생성해 DB에 저장한다.
// 입력은 제목 + 요약(초록/RSS description)뿐이다 — 전문 스크래핑은 하지 않으므로(§4.1, §8)
// 요약 범위를 넘어 사실을 지어내지 않도록 프롬프트에 명시한다.
//
// 3가지 구성:
//   translation — 원문 번역본(제목+요약을 충실히 한국어로)
//   summary     — 핵심 요약(한두 문단)
//   blog        — 기술 블로그 글 작성용 초안(마크다운)
//
// GeekNews는 이미 한국어이므로 translation은 정제만(§0). LLM 키 없으면 전부 null.

import { askLlmJSON, hasLlm } from './llm.mjs';

const OUT_SPEC =
  '출력은 JSON만: {"translation":"...","summary":"...","blog":"..."}. '
  + 'blog는 마크다운(제안 제목 # 한 줄, 도입 문단, 핵심 포인트 불릿, 짧은 시사점). '
  + '주어진 제목·요약 범위를 넘어 없는 사실을 지어내지 말 것.';

const SYSTEM_TRANSLATE =
  '너는 기술/과학 콘텐츠 에디터다. 입력은 영어 기술/과학 뉴스의 제목과 요약(초록/발췌)이며 '
  + '전체 본문이 아니다. 이를 바탕으로 한국어로 세 가지를 생성한다: '
  + 'translation(제목과 요약을 자연스럽고 충실하게 옮긴 번역본), '
  + 'summary(핵심을 3~6문장 한두 문단으로 정리), '
  + 'blog(기술 블로그 글에 바로 쓸 수 있는 한국어 초안). ' + OUT_SPEC;

const SYSTEM_REFINE =
  '너는 한국어 기술 콘텐츠 에디터다. 입력은 이미 한국어인 기술 뉴스의 제목과 요약이다. '
  + 'translation(원문을 맞춤법·표기만 정제해 담기), '
  + 'summary(핵심을 3~6문장 한두 문단으로 정리), '
  + 'blog(기술 블로그 글 초안)을 생성한다. ' + OUT_SPEC;

const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * 항목 1건의 상세 3구성을 생성한다. 키 없음/실패 시 전부 null(+ detailError).
 * @param {object} item  translateItem 결과(title, summary, source 필요)
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {boolean} [options.forceRefine]
 * @returns {Promise<{translation: string|null, summary: string|null, blog: string|null, detailError?: string}>}
 */
export async function generateDetail(item, { fetchImpl = fetch, forceRefine } = {}) {
  if (!hasLlm()) return { translation: null, summary: null, blog: null };

  const refineOnly = forceRefine ?? item.source === 'geeknews';
  const user = `출처: ${item.source}\n제목: ${item.title}\n요약: ${item.summary ?? '(요약 없음)'}`;
  try {
    const out = await askLlmJSON({
      fetchImpl,
      maxTokens: 2000,
      system: refineOnly ? SYSTEM_REFINE : SYSTEM_TRANSLATE,
      user,
    });
    return { translation: str(out.translation), summary: str(out.summary), blog: str(out.blog) };
  } catch (err) {
    return { translation: null, summary: null, blog: null, detailError: err.message };
  }
}

/**
 * 선별·번역된 항목 목록에 상세 3구성을 붙인다.
 * @returns {Promise<{ items: object[], stats: { total, generated, failed } }>}
 */
export async function generateDetailsAll(items, options = {}) {
  const out = [];
  let generated = 0, failed = 0;
  for (const item of items) {
    const d = await generateDetail(item, options);
    if (d.detailError) failed++;
    else if (d.translation || d.summary || d.blog) generated++;
    out.push({ ...item, detailTranslation: d.translation, detailSummary: d.summary, detailBlog: d.blog });
  }
  return { items: out, stats: { total: items.length, generated, failed } };
}
