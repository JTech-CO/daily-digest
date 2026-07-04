// TechXplore 어댑터 (기술 백서 §2.6) — Science X 공용 로직 사용
import { createScienceXAdapter } from './sciencex.mjs';

const adapter = createScienceXAdapter({ source: 'techxplore', baseUrl: 'https://techxplore.com' });

export const SOURCE = adapter.SOURCE;
export const fetchCandidates = adapter.fetchCandidates;
