// 배포판(Netlify)에서 포즈 추천 API를 처리하는 서버 함수. 처리 내용은 개발 서버와 같음 (server/poseCore.js)
// 환경 변수(Netlify 사이트 설정에서 넣음): ANTHROPIC_API_KEY, DEMO_CODE(시연 코드, 비우면 검사 안 함)
import { createPoseApi, HttpError, MAX_BODY } from '../../server/poseCore.js'

const handle = createPoseApi(Netlify.env.get('ANTHROPIC_API_KEY'), Netlify.env.get('DEMO_CODE'))

async function readJson(req) {
  const text = await req.text()
  if (text.length > MAX_BODY) throw new HttpError(413, '사진이 너무 커요.')
  try { return JSON.parse(text) } catch { throw new HttpError(400, '요청 형식이 잘못됐어요.') }
}

export default async (req) => {
  const out = await handle({
    path: new URL(req.url).pathname, method: req.method, code: req.headers.get('x-demo-code') ?? undefined, readBody: () => readJson(req),
  })
  return Response.json(out?.body ?? { error: '없는 주소예요.' }, { status: out?.status ?? 404 })
}

export const config = {
  path: ['/api/poses/analyze', '/api/poses/recommend'],
  // 같은 IP에서 1분에 20번까지만 (요금 폭탄 방지)
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 20 },
}
