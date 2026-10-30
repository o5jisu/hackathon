// 포즈 추천 기능의 서버 부분 (Vite 개발 서버에 끼워 넣는 플러그인)
// API 키는 여기(Node, 내 컴퓨터)에서만 쓰고 브라우저로는 절대 보내지 않습니다.
// 엔드포인트 2개: POST /api/poses/analyze (포즈 사진 1장 분석), POST /api/poses/recommend (배경 사진 + 포즈 목록 → 추천)
import Anthropic from '@anthropic-ai/sdk'

// PRD 7.3: 먼저 Haiku로 시작, 정확도가 부족하면 'claude-sonnet-5-5'로 바꾸세요.
const MODEL = 'claude-haiku-5-5'
const MAX_BODY = 8 * 1024 * 1024 // 요청 크기 제한 (사진은 브라우저에서 1024px로 줄여서 오므로 보통 0.3MB 이하)

// ── 응답 형식 (structured outputs: 이 JSON 모양으로만 답하게 강제) ──
const str = { type: 'string' }
const strArr = { type: 'array', items: str }
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })

const ANALYZE_SCHEMA = obj({
  error: str, // 인물이 없거나 여러 명이면 이유, 정상이면 빈 문자열
  name: str,
  description: str,
  body: { type: 'string', enum: ['full', 'half', 'upper'] },
  posture: str,
  suited_backgrounds: strArr,
  needs: str,
  mood: strArr,
  composition: obj({ x: { type: 'number' }, y: { type: 'number' }, scale: { type: 'number' } }),
})

const RECOMMEND_SCHEMA = obj({
  background_summary: str,
  picks: { type: 'array', items: obj({ pose_id: str, score: { type: 'integer' }, reason: str, camera_tip: str }) },
})

const ANALYZE_PROMPT = `이 사진 속 인물의 포즈를 분석해서 한국어로 답해.
- name: 포즈를 한눈에 알 수 있는 짧은 이름 (예: "난간에 기대 옆보기")
- description: 팔·다리·몸 방향·시선을 1~2문장으로
- body: 사진에 몸이 어디까지 나오는지. full=전신, half=무릎 위, upper=허리 위
- posture: 서기/앉기/걷기/기대기/눕기 등 한 단어
- suited_backgrounds: 이 포즈가 어울리는 배경 3~5개 (예: "카페 창가", "계단", "공원 벤치")
- needs: 필요한 공간·소품 (없으면 "없음")
- mood: 분위기 단어 2~4개
- composition: 사진 안에서 인물 중심의 x, y (0~1, 왼쪽 위가 0)와 인물 높이가 사진 높이에서 차지하는 비율 scale (0~1)
- error: 정상이면 빈 문자열. 인물이 없으면 "사람이 보이지 않아요", 여러 명이면 "한 명만 나온 사진을 골라 주세요". error가 있으면 나머지 항목은 빈 값으로.`

const RECOMMEND_RULES = `너는 사진 포즈 추천 도우미야. 사용자가 보낸 배경 사진에 어울리는 포즈를 아래 "등록된 포즈 목록"에서만 골라.
규칙:
- 최대 3개를 어울리는 순서대로 고르고, pose_id는 목록의 id를 그대로 써. 목록에 없는 포즈는 절대 만들지 마.
- score는 0~100 정수 (배경의 공간·소품·분위기와 포즈가 얼마나 맞는지).
- reason: 왜 어울리는지 배경의 구체적인 요소를 들어 1~2문장.
- camera_tip: 이 배경에서 그 포즈를 찍을 때 카메라 위치·높이·구도 팁 1문장.
- background_summary: 배경을 한 문장으로.
- 어울리는 포즈가 하나도 없으면 picks는 빈 배열.
- 모두 한국어로.`

// 사진 데이터(base64 JPEG)를 Claude에 보낼 이미지 블록으로
const imageBlock = (data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })

// Claude 호출 후 JSON 꺼내기. 형식이 깨지면 1번 다시 시도 (PRD F1)
async function askJson(client, params) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create(params)
    if (res.stop_reason === 'refusal') throw new HttpError(422, 'AI가 이 사진은 분석할 수 없다고 답했어요. 다른 사진을 골라 주세요.')
    const text = res.content.find((b) => b.type === 'text')?.text
    try {
      return JSON.parse(text)
    } catch {
      // 다음 반복에서 재시도
    }
  }
  throw new HttpError(502, 'AI 응답 형식이 올바르지 않아요. 잠시 후 다시 시도해 주세요.')
}

async function analyze(client, { image }) {
  if (!image) throw new HttpError(400, '사진이 없어요.')
  const out = await askJson(client, {
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ANALYZE_SCHEMA } },
    messages: [{ role: 'user', content: [imageBlock(image), { type: 'text', text: ANALYZE_PROMPT }] }],
  })
  if (out.error) throw new HttpError(422, out.error)
  return out
}

// 포즈 목록을 글로 (사진은 보내지 않음 → 포즈가 많아도 싸고 빠름)
const poseLine = (p) =>
  `- id: ${p.id} | 이름: ${p.name} | 설명: ${p.description} | 몸: ${p.body} | 자세: ${p.posture}` +
  ` | 어울리는 배경: ${(p.suitedBackgrounds ?? []).join(', ')} | 필요: ${p.needs} | 분위기: ${(p.mood ?? []).join(', ')}`

async function recommend(client, { image, poses }) {
  if (!image) throw new HttpError(400, '배경 사진이 없어요.')
  if (!Array.isArray(poses) || poses.length === 0) throw new HttpError(400, '등록된 포즈가 없어요.')
  return askJson(client, {
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RECOMMEND_SCHEMA } },
    // 규칙 + 포즈 목록은 요청마다 같으므로 앞쪽(system)에 두고 캐시 (PRD 7.3). 배경 사진만 매번 바뀜
    system: [
      { type: 'text', text: RECOMMEND_RULES },
      { type: 'text', text: '등록된 포즈 목록:\n' + poses.map(poseLine).join('\n'), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: [imageBlock(image), { type: 'text', text: '이 배경 사진에 어울리는 포즈를 골라 줘.' }] }],
  })
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

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

// Anthropic 오류를 사용자에게 보여 줄 한국어 문장으로
function toHttpError(e) {
  if (e instanceof HttpError) return e
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(500, 'API 키가 올바르지 않아요. .env.local의 ANTHROPIC_API_KEY를 확인해 주세요.')
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new HttpError(504, 'AI 응답이 늦어요. 다시 시도해 주세요.')
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(502, '서버가 AI에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
  if (e instanceof Anthropic.APIError) return new HttpError(502, `AI 호출 오류 (${e.status})`)
  return new HttpError(500, '서버 오류: ' + e.message)
}

export default function poseRecommendApi(apiKey) {
  // 사진은 이 함수 안에서만 쓰고 저장하지 않음 (PRD 8: 서버 비저장)
  const client = apiKey ? new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 }) : null
  const routes = { '/api/poses/analyze': analyze, '/api/poses/recommend': recommend }

  const middleware = async (req, res, next) => {
    const handler = routes[req.url]
    if (!handler) return next()
    const send = (status, body) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return send(405, { error: 'POST만 받아요.' })
    if (!client) return send(500, { error: 'API 키가 없어요. 프로젝트 폴더의 .env.local에 ANTHROPIC_API_KEY=... 를 넣고 서버를 다시 켜 주세요.' })
    try {
      send(200, await handler(client, await readJson(req)))
    } catch (e) {
      const err = toHttpError(e)
      if (err.status >= 500) console.error('[pose-recommend]', e)
      send(err.status, { error: err.message })
    }
  }

  return {
    name: 'pose-recommend-api',
    configureServer(server) { server.middlewares.use(middleware) }, // npm run dev
    configurePreviewServer(server) { server.middlewares.use(middleware) }, // npm run preview
  }
}
