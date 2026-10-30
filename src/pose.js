// 포즈 비교 로직 (화면/React와 무관한 순수 함수 모음)
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm'
// 시연 때 네트워크가 불안하면 이 파일을 내려받아 public/models/ 에 넣고 경로를 '/models/pose_landmarker_full.task'로 바꾸세요.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'
// 참고 사진은 한 번만 분석하므로 느리지만 가장 정확한 heavy 모델을 씀 (약 30MB)
const HEAVY_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task'

// 참고 사진용(IMAGE)과 카메라용(VIDEO) 모델을 따로 만듭니다. 한 모델은 한 모드만 쓸 수 있기 때문입니다.
export async function createLandmarkers() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL)
  const make = (runningMode, modelAssetPath) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      runningMode,
      numPoses: 1,
    })
  const [image, video] = await Promise.all([make('IMAGE', HEAVY_MODEL_URL), make('VIDEO', MODEL_URL)])
  return { image, video }
}

// 분석용 사본: 화면에 보이는 방향(폰 사진 회전 정보 반영) 그대로, 긴 변을 max 이하로 줄여 캔버스에 그림
export function toAnalysisCanvas(img, max = 1280) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return c
}

// 관절 위치 흔들림 줄이기: 이전 위치와 새 위치를 섞음 (a가 클수록 빠르게 따라가고 덜 부드러움)
export function smoothPoints(prev, pts, a = 0.5) {
  if (!prev) return pts
  return pts.map((p, j) => ({ x: prev[j].x + a * (p.x - prev[j].x), y: prev[j].y + a * (p.y - prev[j].y), v: p.v }))
}

// MediaPipe 관절 번호
const L_SH = 11, R_SH = 12, L_HIP = 23, R_HIP = 24
// 비교할 관절: 팔꿈치, 손목, 무릎, 발목
export const TARGETS = [13, 14, 15, 16, 25, 26, 27, 28]
// 머리 각도용 점: 코, 왼눈, 오른눈, 왼귀, 오른귀
const NOSE = 0, L_EYE = 2, R_EYE = 5, L_EAR = 7, R_EAR = 8
export const HEAD_PTS = [NOSE, L_EYE, R_EYE, L_EAR, R_EAR]
// 머리 각도 허용 범위 (실제 기기에서 조정할 값). 기울기는 도(°), 돌림·숙임은 두 귀 사이 거리 대비 비율
const HEAD_T = { roll: 20, yaw: 0.3, pitch: 0.3 }
// 뼈대 선
export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]
// 좌우 짝 (거울 모드에서 왼쪽↔오른쪽 바꿀 때 사용)
const SWAP = { 1: 4, 4: 1, 2: 5, 5: 2, 3: 6, 6: 3, 7: 8, 8: 7, 9: 10, 10: 9, 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23, 25: 26, 26: 25, 27: 28, 28: 27 }
// 안내 문구에 쓸 관절 이름 (사용자 몸 기준)
const NAME = {
  13: '왼쪽 팔꿈치를', 14: '오른쪽 팔꿈치를', 15: '왼손을', 16: '오른손을',
  25: '왼쪽 무릎을', 26: '오른쪽 무릎을', 27: '왼발을', 28: '오른발을',
}

const VIS = 0.5 // 이 값보다 안 보이는 관절은 판단하지 않음
export const MATCH_T = 0.3 // 몸통 길이의 30% 이내면 "맞음" (실제 기기에서 조정할 값)

// 0~1 정규화 좌표 → 픽셀 좌표 (가로세로 비율이 다른 사진끼리 비교하기 위해)
export function toPixels(lms, w, h) {
  return lms.map((p) => {
    const inside = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
    return { x: p.x * w, y: p.y * h, v: inside ? (p.visibility ?? 1) : 0 }
  })
}

// 촬영 틀 = 참고 사진. 틀이 카메라 화면에서 차지하는 영역을 0~1 비율로 계산
// a = { scale, dx, dy }: 기본(scale 1, 이동 0)은 가운데에 원래 비율 그대로 가장 크게. dx·dy는 화면 크기 대비 이동량
export function frameRect(refAspect, videoAspect, a) {
  const w = Math.min(1, refAspect / videoAspect) * a.scale
  const h = Math.min(1, videoAspect / refAspect) * a.scale
  return { x: 0.5 - w / 2 + a.dx, y: 0.5 - h / 2 + a.dy, w, h }
}

// 카메라 0~1 좌표({x, y, v}) → 참고 사진 틀 좌표(참고 사진 픽셀 크기 fw×fh와 같은 좌표계). r = frameRect 결과
// 보이는지(v)는 카메라 화면 기준 그대로 둠 → 사진을 줄여 틀이 작아져도 카메라에 보이는 관절은 계속 판정
export function toFrame(pts, r, fw, fh) {
  return pts.map((p) => ({ x: ((p.x - r.x) / r.w) * fw, y: ((p.y - r.y) / r.h) * fh, v: p.v }))
}

// 거울 화면용 변환: x를 뒤집고 좌우 관절 번호를 바꿈
// → 결과의 j번 관절 = "화면에서 참고 사진의 j번 관절과 같은 쪽에 보이는 사용자의 관절"
export function mirror(pts, w) {
  return pts.map((_, j) => {
    const src = pts[SWAP[j] ?? j]
    return { ...src, x: w - src.x }
  })
}

// 몸통 기준 틀: 중심 = 어깨·엉덩이 4점 평균, 크기 = 어깨 중점~엉덩이 중점 거리
export function bodyFrame(pts) {
  const core = [L_SH, R_SH, L_HIP, R_HIP].map((i) => pts[i])
  if (core.some((p) => !p || p.v < VIS)) return null
  const cx = core.reduce((s, p) => s + p.x, 0) / 4
  const cy = core.reduce((s, p) => s + p.y, 0) / 4
  const shx = (core[0].x + core[1].x) / 2, shy = (core[0].y + core[1].y) / 2
  const hx = (core[2].x + core[3].x) / 2, hy = (core[2].y + core[3].y) / 2
  const s = Math.hypot(shx - hx, shy - hy)
  return s > 1 ? { cx, cy, s } : null
}

// 몸통 기준 상대 좌표로 변환 → 거리·위치·몸 크기 차이가 사라짐
export function normalize(pts, f) {
  return pts.map((p) => ({ x: (p.x - f.cx) / f.s, y: (p.y - f.cy) / f.s, v: p.v }))
}

// 관절별 거리 계산. 결과: { j: 거리 | null(판단 보류) }
export function compare(refN, liveN) {
  const out = {}
  for (const j of TARGETS) {
    if (refN[j].v < VIS) continue // 참고 사진에서 안 보이는 관절은 비교 안 함
    if (liveN[j].v < VIS) { out[j] = null; continue }
    out[j] = Math.hypot(refN[j].x - liveN[j].x, refN[j].y - liveN[j].y)
  }
  return out
}

// 머리 각도 3가지 (두 점 a·b = 양쪽 귀 또는 양쪽 눈)
// roll: 두 점을 이은 선의 기울기(도, +면 화면 오른쪽이 내려감)
// yaw: 코가 두 점의 가운데에서 화면 오른쪽으로 간 정도 / pitch: 코가 두 점을 이은 선보다 아래로 간 정도(+면 숙임)
function headAngles(pts, a, b) {
  const A = pts[a], B = pts[b], N = pts[NOSE]
  let ux = B.x - A.x, uy = B.y - A.y
  const len = Math.hypot(ux, uy)
  if (len < 1) return null
  ux /= len; uy /= len
  if (ux < 0) { ux = -ux; uy = -uy } // 방향을 항상 화면 오른쪽으로 통일
  const nx = N.x - (A.x + B.x) / 2, ny = N.y - (A.y + B.y) / 2
  return {
    roll: (Math.atan2(uy, ux) * 180) / Math.PI,
    yaw: (nx * ux + ny * uy) / len,
    pitch: (-nx * uy + ny * ux) / len,
  }
}

// 참고 사진과 내 머리 각도 차이(참고 - 나). 각 값은 허용 범위로 나눠서 1 이상이면 "틀림"
// 반환: undefined = 참고 사진에서 머리가 안 보여 비교 안 함, null = 내 머리가 안 보여 판단 보류
// 귀가 둘 다 보이면 귀로, 고개를 돌려 한쪽 귀가 가려지면 눈으로 계산 (참고·나 모두 같은 점으로)
export function compareHead(refPts, livePts) {
  const seen = (pts, ...ids) => ids.every((i) => pts[i].v >= VIS)
  if (!seen(refPts, NOSE) || !(seen(refPts, L_EAR, R_EAR) || seen(refPts, L_EYE, R_EYE))) return undefined
  // 눈 사이는 귀 사이의 절반쯤이라 같은 비율 기준이면 2배 민감 → 눈일 땐 허용 범위를 2배로
  const pair = seen(refPts, L_EAR, R_EAR) && seen(livePts, NOSE, L_EAR, R_EAR) ? [L_EAR, R_EAR, 1]
    : seen(refPts, L_EYE, R_EYE) && seen(livePts, NOSE, L_EYE, R_EYE) ? [L_EYE, R_EYE, 2] : null
  if (!pair) return null
  const r = headAngles(refPts, pair[0], pair[1]), l = headAngles(livePts, pair[0], pair[1])
  if (!r || !l) return null
  return {
    roll: (r.roll - l.roll) / HEAD_T.roll,
    yaw: (r.yaw - l.yaw) / (HEAD_T.yaw * pair[2]),
    pitch: (r.pitch - l.pitch) / (HEAD_T.pitch * pair[2]),
  }
}

// 머리 각도 중 가장 많이 틀린 방향 하나에 대한 안내 문장 (사용자 몸 기준 왼쪽/오른쪽, adviceFor와 같은 규칙)
export function headAdvice(axis, diff, mirrored) {
  if (axis === 'pitch') return diff > 0 ? '고개를 조금 숙여 보세요' : '턱을 조금 들어 보세요'
  const toRight = mirrored ? diff > 0 : diff < 0 // diff > 0 이면 화면 오른쪽으로 가야 함
  const side = toRight ? '오른쪽' : '왼쪽'
  return axis === 'roll' ? `고개를 ${side}으로 조금 기울여 보세요` : `고개를 ${side}으로 조금 돌려 보세요`
}

// 가장 많이 틀린 관절 하나에 대한 안내 문장 (사용자 몸 기준 왼쪽/오른쪽)
// mirrored=true(앞 카메라): live는 mirror()로 좌우 번호가 바뀌어 있고, 화면 오른쪽 = 사용자 오른쪽
// mirrored=false(뒤 카메라): 카메라를 마주 보고 있으므로 화면 오른쪽 = 사용자 왼쪽
export function adviceFor(j, refN, liveN, mirrored) {
  const dx = refN[j].x - liveN[j].x
  const dy = refN[j].y - liveN[j].y
  const name = NAME[mirrored ? SWAP[j] : j]
  const toRight = mirrored ? dx > 0 : dx < 0
  let action
  if (Math.abs(dy) >= Math.abs(dx)) action = dy < 0 ? '조금 올려 보세요' : '조금 내려 보세요'
  else action = toRight ? '조금 오른쪽으로 옮겨 보세요' : '조금 왼쪽으로 옮겨 보세요'
  return `${name} ${action}`
}

// ── 촬영 사진 색감을 참고 사진에 맞추기 (Reinhard 색 전이) ──
// RGB 대신 Lab 색공간(L = 밝기, a = 초록↔빨강, b = 파랑↔노랑)에서 채널별 평균·표준편차를 맞춤
// → 밝기와 색이 따로 움직여서 RGB에서 할 때보다 색이 덜 탁하고 자연스러움

// sRGB(0~255) ↔ 선형 밝기(0~1). 화면용 RGB는 감마가 적용돼 있어서 계산 전에 풀어 줘야 함
const LIN = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
const toSrgb = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.cbrt(c) ** 1.25 - 0.055) // c^(1/2.4) = cbrt(c)^1.25

const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
const labFInv = (t) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787)

function rgbToLab(r, g, b, out) {
  const R = LIN[r], G = LIN[g], B = LIN[b]
  const x = labF((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = labF(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = labF((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  out[0] = 116 * y - 16; out[1] = 500 * (x - y); out[2] = 200 * (y - z)
}

function labToRgb(L, A, Bv, out) {
  const fy = (L + 16) / 116
  const X = 0.95047 * labFInv(fy + A / 500), Y = labFInv(fy), Z = 1.08883 * labFInv(fy - Bv / 200)
  out[0] = toSrgb(Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z))
  out[1] = toSrgb(Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z))
  out[2] = toSrgb(Math.max(0, 0.0557 * X - 0.2040 * Y + 1.0570 * Z))
}

// 너무 어둡거나(L < 4) 하얗게 날아간(L > 96) 픽셀은 색 정보가 없어서 통계에서 뺌
const L_MIN = 4, L_MAX = 96

function labStats(data) {
  const sum = [0, 0, 0], sq = [0, 0, 0], all = [0, 0, 0], allSq = [0, 0, 0], lab = [0, 0, 0]
  let n = 0, total = 0
  for (let i = 0; i < data.length; i += 4) {
    rgbToLab(data[i], data[i + 1], data[i + 2], lab)
    total++
    for (let c = 0; c < 3; c++) { all[c] += lab[c]; allSq[c] += lab[c] ** 2 }
    if (lab[0] < L_MIN || lab[0] > L_MAX) continue
    n++
    for (let c = 0; c < 3; c++) { sum[c] += lab[c]; sq[c] += lab[c] ** 2 }
  }
  // 남은 픽셀이 너무 적으면(거의 검거나 흰 사진) 전체 픽셀로 계산
  const [S, Q, N] = n > total * 0.05 ? [sum, sq, n] : [all, allSq, total]
  const mean = S.map((v) => v / N)
  const std = Q.map((q, c) => Math.sqrt(Math.max(q / N - mean[c] ** 2, 1)))
  return { mean, std }
}

export function statsOf(img) {
  const c = document.createElement('canvas')
  const k = 200 / Math.max(img.width, img.height) // 작게 줄여서 빠르게 계산
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return labStats(ctx.getImageData(0, 0, c.width, c.height).data)
}

// 퍼짐(표준편차) 비율은 0.5~2배로 제한 → 참고 사진이 아주 밋밋하거나 강해도 결과가 깨지지 않게
const clampRatio = (v) => Math.min(2, Math.max(0.5, v))

// '참고 사진 색감 적용' 버튼을 눌렀을 때 한 번만 계산하는 100% 보정 결과 (원본은 건드리지 않음)
export function matchColor(original, src, ref) {
  const out = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height)
  const d = out.data
  const ratio = [0, 1, 2].map((c) => clampRatio(ref.std[c] / src.std[c]))
  const lab = [0, 0, 0], rgb = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) {
    rgbToLab(d[i], d[i + 1], d[i + 2], lab)
    for (let c = 0; c < 3; c++) lab[c] = (lab[c] - src.mean[c]) * ratio[c] + ref.mean[c]
    labToRgb(lab[0], lab[1], lab[2], rgb)
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2] // Uint8ClampedArray라 0~255로 자동 제한
  }
  return out
}

// 슬라이더 강도 s(0~1)로 원본과 보정 결과를 섞음. 매번 원본에서 새로 만들어 보정이 누적되지 않음
export function blendImages(original, matched, s) {
  const out = new ImageData(original.width, original.height)
  const a = original.data, b = matched.data, d = out.data
  for (let i = 0; i < d.length; i++) d[i] = a[i] + s * (b[i] - a[i])
  return out
}
