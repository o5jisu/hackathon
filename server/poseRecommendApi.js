// 포즈 추천 기능의 서버 부분 (Vite 개발 서버에 끼워 넣는 플러그인)
// 실제 처리는 server/poseCore.js. 배포판(Netlify)은 netlify/functions/poses.mjs가 같은 처리를 씀.
// 엔드포인트 2개: POST /api/poses/analyze (포즈 사진 1장 분석), POST /api/poses/recommend (배경 사진 + 포즈 목록 → 추천)
import { createPoseApi, HttpError, MAX_BODY } from './poseCore.js'

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(new HttpError(413, '사진이 너무 커요.')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new HttpError(400, '요청 형식이 잘못됐어요.')) }
    })
    req.on('error', reject)
  })
}

export default function poseRecommendApi(apiKey, demoCode) {
  const handle = createPoseApi(apiKey, demoCode)

  const middleware = async (req, res, next) => {
    let out
    try {
      out = await handle({ path: req.url, method: req.method, code: req.headers['x-demo-code'], readBody: () => readJson(req) })
    } catch (e) {
      out = { status: e instanceof HttpError ? e.status : 500, body: { error: e.message } }
    }
    if (!out) return next()
    res.statusCode = out.status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(out.body))
  }

  return {
    name: 'pose-recommend-api',
    configureServer(server) { server.middlewares.use(middleware) }, // npm run dev
    configurePreviewServer(server) { server.middlewares.use(middleware) }, // npm run preview
  }
}
