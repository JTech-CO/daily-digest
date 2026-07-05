// 로컬 정적 서버 — public/ 미리보기용 (배포는 GitHub Pages 정적 호스팅)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const PORT = process.env.PORT ?? 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const forbidden = (res) => res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Forbidden');

createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return forbidden(res); // 잘못된 퍼센트 인코딩
  }
  if (path === '/') path = '/index.html';

  // 경로 탈출 방지:
  // 1) 디코딩된 경로에 '..' 세그먼트나 NUL이 있으면 거절(%2f로 인코딩된 슬래시가
  //    URL 정규화를 우회해 '..'로 되살아나는 케이스 차단).
  const segments = path.split(/[\\/]+/);
  if (path.includes('\0') || segments.includes('..')) return forbidden(res);

  // 2) 정규화 후 경로가 반드시 PUBLIC_DIR 경계(구분자 포함) 안이어야 한다.
  //    startsWith(PUBLIC_DIR)만으로는 'public-secret' 같은 형제 디렉터리가 통과한다.
  const filePath = normalize(join(PUBLIC_DIR, path));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    return forbidden(res);
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(PORT, () => console.log(`[serve] http://localhost:${PORT}`));
