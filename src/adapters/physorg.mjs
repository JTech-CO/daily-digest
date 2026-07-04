// Phys.org 어댑터 (기술 백서 §2.5) — Science X 공용 로직 사용
import { createScienceXAdapter } from './sciencex.mjs';

const adapter = createScienceXAdapter({ source: 'physorg', baseUrl: 'https://phys.org' });

export const SOURCE = adapter.SOURCE;
export const fetchCandidates = adapter.fetchCandidates;
