// FOUC 방지: 저장된 테마를 문서 렌더 전에 적용한다.
// 인라인 스크립트를 피해 CSP script-src 'self'를 유지하기 위해 외부 파일로 분리(head에서 동기 로드).
(function () {
  var saved = localStorage.getItem('theme');
  document.documentElement.dataset.theme = saved || 'dark';
})();
