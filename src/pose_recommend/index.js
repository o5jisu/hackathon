// 포즈 추천 기능의 공개 함수 (PRD 6.2). 화면(PoseLibrary.jsx)은 이 함수들만 씁니다.
//
// PoseItem = { id, image(Blob, 1024px JPEG), name, description, body: 'full'|'half'|'upper', posture,
//              suitedBackgrounds[], needs, mood[], composition{x,y,scale}, landmarks: [[x,y],...] | null, createdAt }
// (PRD의 imagePath 대신 사진 자체를 Blob으로 저장: 웹앱에는 파일 경로가 없어서)
import { toAnalysisCanvas } from '../pose'
import { IMAGE_MAX_SIDE, MIN_SCORE, MAX_PICKS } from './config'
import { poseStore } from './store'
import * as ai from './ai'

// ImageProcessor: 사진(File/Blob)을 긴 변 maxSide로 줄여 JPEG로. 기존 pose.js의 축소 함수를 재사용
async function resize(file, maxSide = IMAGE_MAX_SIDE) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = toAnalysisCanvas(img, maxSide)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    return { canvas, blob, base64 }
  } catch {
    throw new Error('사진을 열 수 없어요. JPG·PNG·WEBP 사진을 골라 주세요.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

const newId = () => 'pose_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// F1: 사진 분석 → 저장 전 초안을 돌려줌 (사용자가 고친 뒤 savePose로 저장)
// detect(canvas)를 넘기면 관절 좌표(0~1)도 같이 담아 둠 (F6, 기존 MediaPipe 재사용)
export async function registerPose(file, { detect, signal } = {}) {
  const { canvas, blob, base64 } = await resize(file)
  const info = await ai.analyzePose(base64, { signal })
  let landmarks = null
  try { landmarks = detect?.(canvas) ?? null } catch { /* 관절을 못 찾아도 등록은 진행 */ }
  return { id: newId(), image: blob, ...info, landmarks, createdAt: new Date().toISOString() }
}

export const savePose = (item) => poseStore.save(item)
export const listPoses = () => poseStore.getAll() // F2
export const updatePose = (id, patch) => poseStore.update(id, patch)
export const deletePose = (id) => poseStore.remove(id)

// AI가 준 추천을 검증: 실제로 있는 포즈만, 같은 포즈는 한 번만, 점수 기준 미만은 버림 (PRD F4)
export function validatePicks(picks, poses) {
  const byId = new Map(poses.map((p) => [p.id, p]))
  const seen = new Set()
  return picks
    .filter((p) => byId.has(p.poseId) && !seen.has(p.poseId) && seen.add(p.poseId))
    .map((p) => ({ ...p, score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))) }))
    .filter((p) => p.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PICKS)
    .map((p) => ({ ...p, pose: byId.get(p.poseId) }))
}

// F3·F4: 배경 사진 → 추천 (picks가 비어 있으면 "맞는 포즈 없음")
export async function recommendPose(file, { signal } = {}) {
  const poses = await listPoses()
  if (poses.length === 0) throw new Error('등록된 포즈가 없어요. 먼저 포즈 사진을 등록해 주세요.')
  const { base64 } = await resize(file)
  const r = await ai.recommend(base64, poses, { signal })
  return { backgroundSummary: r.backgroundSummary, picks: validatePicks(r.picks, poses) }
}

export { TimeoutError } from './ai'
