// AiProvider: 같은 개발 서버의 /api/poses/* 를 부릅니다 (API 키는 서버에만 있음, server/poseRecommendApi.js).
// 다른 AI(Gemini 등)로 바꾸려면 이 파일의 두 함수만 같은 모양으로 다시 만들면 됩니다.
import { ANALYZE_TIMEOUT_MS, RECOMMEND_TIMEOUT_MS } from './config'

export class TimeoutError extends Error {}

async function post(path, body, { signal, timeout }) {
  // 사용자가 누른 취소(signal)와 시간 초과(timeout) 둘 중 먼저 오는 것으로 요청을 멈춤
  const stop = new AbortController()
  let timedOut = false
  const t = setTimeout(() => { timedOut = true; stop.abort() }, timeout)
  const onCancel = () => stop.abort()
  signal?.addEventListener('abort', onCancel)
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: stop.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`)
    return data
  } catch (e) {
    if (timedOut) throw new TimeoutError('응답이 너무 오래 걸려요. 다시 시도해 주세요.')
    if (e.name === 'AbortError') throw e // 사용자가 취소
    if (e instanceof TypeError) throw new Error('서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.')
    throw e
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onCancel)
  }
}

// 응답의 snake_case 이름을 앱에서 쓰는 이름(PoseItem 필드)으로 바꿈
export async function analyzePose(base64, opts = {}) {
  const r = await post('/api/poses/analyze', { image: base64 }, { ...opts, timeout: ANALYZE_TIMEOUT_MS })
  return {
    name: r.name, description: r.description, body: r.body, posture: r.posture,
    suitedBackgrounds: r.suited_backgrounds, needs: r.needs, mood: r.mood, composition: r.composition,
  }
}

// 포즈는 글 정보만 보냄 (사진·관절 좌표는 보내지 않음)
export async function recommend(base64, poses, opts = {}) {
  const list = poses.map(({ id, name, description, body, posture, suitedBackgrounds, needs, mood }) =>
    ({ id, name, description, body, posture, suitedBackgrounds, needs, mood }))
  const r = await post('/api/poses/recommend', { image: base64, poses: list }, { ...opts, timeout: RECOMMEND_TIMEOUT_MS })
  return {
    backgroundSummary: r.background_summary ?? '',
    picks: (r.picks ?? []).map((p) => ({ poseId: p.pose_id, score: p.score, reason: p.reason, cameraTip: p.camera_tip })),
  }
}
