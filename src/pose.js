// 포즈 비교 로직 (화면/React와 무관한 순수 함수 모음)
import { FilesetResolver, PoseLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm'
// 시연 때 네트워크가 불안하면 이 파일을 내려받아 public/models/ 에 넣고 경로를 '/models/pose_landmarker_full.task'로 바꾸세요.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'
// 참고 사진은 한 번만 분석하므로 느리지만 가장 정확한 heavy 모델을 씀 (약 30MB)
const HEAVY_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task'

// 사람 부위 분리 모델 (배경·머리카락·몸 피부·얼굴 피부·옷·기타, 약 16MB). 색감 적용 버튼을 처음 누를 때만 받음
const SEGMENTER_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'

// MediaPipe 실행 파일(WASM)은 포즈 모델과 분리 모델이 같이 씀 → 한 번만 받음
let visionP = null
const getVision = () => (visionP ??= FilesetResolver.forVisionTasks(WASM_URL))

// 참고 사진용(IMAGE)과 카메라용(VIDEO) 모델을 따로 만듭니다. 한 모델은 한 모드만 쓸 수 있기 때문입니다.
export async function createLandmarkers() {
  const vision = await getVision()
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
// 비교할 관절: 어깨·골반(몸통 자세) + 팔꿈치, 손목, 무릎, 발목
export const TORSO = [L_SH, R_SH, L_HIP, R_HIP]
export const TARGETS = [...TORSO, 13, 14, 15, 16, 25, 26, 27, 28]
// 머리 판정용 점: 코, 입 왼쪽·오른쪽 끝 (포즈 모델엔 턱이 없어서 입 가운데를 턱 대신 씀)
const NOSE = 0, MOUTH_L = 9, MOUTH_R = 10
export const HEAD_PTS = [NOSE, MOUTH_L, MOUTH_R]
// 머리 허용 범위: 목 기준 코·입 위치 차이가 몸통 길이의 18% 이내면 "맞음" (실제 기기에서 조정할 값)
const HEAD_T = 0.18
// 뼈대 선
export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]
// 좌우 짝 (거울 모드에서 왼쪽↔오른쪽 바꿀 때 사용)
const SWAP = { 1: 4, 4: 1, 2: 5, 5: 2, 3: 6, 6: 3, 7: 8, 8: 7, 9: 10, 10: 9, 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23, 25: 26, 26: 25, 27: 28, 28: 27 }
// 안내 문구에 쓸 관절 이름 (사용자 몸 기준)
const NAME = {
  11: '왼쪽 어깨를', 12: '오른쪽 어깨를', 23: '왼쪽 골반을', 24: '오른쪽 골반을',
  13: '왼쪽 팔꿈치를', 14: '오른쪽 팔꿈치를', 15: '왼손을', 16: '오른손을',
  25: '왼쪽 무릎을', 26: '오른쪽 무릎을', 27: '왼발을', 28: '오른발을',
}

const VIS = 0.5 // 이 값보다 안 보이는 관절은 판단하지 않음
// 참고 사진은 더 확실한 관절만 판정 (가려진 손·팔처럼 애매한 관절은 찍을 때마다 보였다 안 보였다 해서 점수가 흔들림)
const REF_VIS = 0.7
export const MATCH_T = 0.4 // 몸통 길이의 40% 이내면 "맞음" (실제 기기에서 조정할 값)
// 어깨·골반은 몸통 가운데 가까이 있어서 움직임 폭이 작음 → 더 좁은 15%로 판정
const TORSO_T = 0.15
export const tolOf = (j) => (TORSO.includes(j) ? TORSO_T : MATCH_T)

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

// 상반신 모드에서 어깨 너비를 몸통 길이로 바꾸는 비율 (테스트 사진 정면 기준 1.0~1.4배의 가운데 값)
// → 허용 범위(MATCH_T 등)를 전신 모드와 같은 "몸통 길이" 기준으로 쓸 수 있음
const UPPER_K = 1.35

// 몸통 기준 틀 { cx, cy, s, mode }
// - 전신(full): 중심 = 어깨·골반 4점 평균, 크기 = 어깨 중점~골반 중점 거리
// - 상반신(upper): 골반이 안 보이는 사진용. 중심 = 두 어깨 가운데, 크기 = 어깨 너비 × UPPER_K
// mode를 안 주면 골반이 보이는지로 정함(참고 사진). 카메라는 참고 사진과 같은 mode로 맞춰야 비교가 됨
export function bodyFrame(pts, mode) {
  const seen = (i) => pts[i] && pts[i].v >= VIS
  if (!seen(L_SH) || !seen(R_SH)) return null
  const hipsSeen = seen(L_HIP) && seen(R_HIP)
  const m = mode ?? (hipsSeen ? 'full' : 'upper')
  const shx = (pts[L_SH].x + pts[R_SH].x) / 2, shy = (pts[L_SH].y + pts[R_SH].y) / 2
  if (m === 'upper') {
    const s = Math.hypot(pts[L_SH].x - pts[R_SH].x, pts[L_SH].y - pts[R_SH].y) * UPPER_K
    return s > 1 ? { cx: shx, cy: shy, s, mode: m } : null
  }
  if (!hipsSeen) return null
  const core = [L_SH, R_SH, L_HIP, R_HIP].map((i) => pts[i])
  const cx = core.reduce((s, p) => s + p.x, 0) / 4
  const cy = core.reduce((s, p) => s + p.y, 0) / 4
  const hx = (core[2].x + core[3].x) / 2, hy = (core[2].y + core[3].y) / 2
  const s = Math.hypot(shx - hx, shy - hy)
  return s > 1 ? { cx, cy, s, mode: m } : null
}

// 몸통 기준 상대 좌표로 변환 → 거리·위치·몸 크기 차이가 사라짐
export function normalize(pts, f) {
  return pts.map((p) => ({ x: (p.x - f.cx) / f.s, y: (p.y - f.cy) / f.s, v: p.v }))
}

// 팔다리는 뼈의 방향 각도로 비교: 관절 → 그 관절로 이어지는 뼈의 시작점
// (팔꿈치 ← 어깨: 위팔, 손목 ← 팔꿈치: 아래팔, 무릎 ← 골반: 허벅지, 발목 ← 무릎: 정강이)
// 위치 거리로만 보면 "허리에 손"과 "손 내림"이 몸통 길이의 30%밖에 차이 안 나서 통과됐음. 각도는 팔이 굽은 방향을 바로 잡음
const LIMB_FROM = { 13: 11, 15: 13, 14: 12, 16: 14, 25: 23, 27: 25, 26: 24, 28: 26 }
const ANG_T = 25 // 뼈 방향이 이 각도(도) 이상 다르면 "틀림" (실제 기기에서 조정할 값. 30°는 "주머니에 손" vs "허리에 손"이 통과됨)
const MIN_BONE = 0.12 // 뼈가 몸통 길이의 12%보다 짧게 보이면(카메라 쪽을 향함) 각도가 불안정해서 위치로 비교

// 관절별 차이. 결과: { j: 허용 범위 대비 비율(1 이상이면 틀림) | null(판단 보류) }
export function compare(refN, liveN) {
  const out = {}
  for (const j of TARGETS) {
    if (refN[j].v < REF_VIS) continue // 참고 사진에서 안 보이거나 애매한 관절은 비교 안 함
    if (liveN[j].v < VIS) { out[j] = null; continue }
    const p = LIMB_FROM[j]
    if (p !== undefined && refN[p].v >= REF_VIS && liveN[p].v >= VIS) {
      const rx = refN[j].x - refN[p].x, ry = refN[j].y - refN[p].y
      const lx = liveN[j].x - liveN[p].x, ly = liveN[j].y - liveN[p].y
      if (Math.min(Math.hypot(rx, ry), Math.hypot(lx, ly)) >= MIN_BONE) {
        let diff = Math.abs(Math.atan2(ry, rx) - Math.atan2(ly, lx)) * (180 / Math.PI)
        if (diff > 180) diff = 360 - diff
        out[j] = diff / ANG_T
        continue
      }
    }
    out[j] = Math.hypot(refN[j].x - liveN[j].x, refN[j].y - liveN[j].y) / tolOf(j) // 몸통·짧은 뼈는 위치 거리로
  }
  return out
}

// 목(두 어깨 가운데)에서 본 코·입 가운데 위치. 몸통 기준 정규화 좌표(normalize 결과)에서 계산
// → 귀 사이 거리로 나누던 예전 방식과 달리, 고개를 옆으로 돌려 귀가 가려져도 값이 튀지 않음
function headPos(n) {
  const nx = (n[L_SH].x + n[R_SH].x) / 2, ny = (n[L_SH].y + n[R_SH].y) / 2
  return {
    nose: { x: n[NOSE].x - nx, y: n[NOSE].y - ny },
    mouth: { x: (n[MOUTH_L].x + n[MOUTH_R].x) / 2 - nx, y: (n[MOUTH_L].y + n[MOUTH_R].y) / 2 - ny },
  }
}

// 참고 사진과 내 머리 차이 (참고 - 나). 고개를 숙이거나 들거나 돌리거나 기울이면 코·입 위치가 바뀌는 것으로 판정
// 반환: undefined = 참고 사진에서 얼굴이 안 보여 비교 안 함, null = 내 얼굴이 안 보여 판단 보류
// { dx, dy } = 코·입 평균 이동 방향(안내 문구용), err = 코·입 중 큰 차이 / 허용 범위 (1 미만이면 맞음)
// 코만 보이면 판정하고, 입은 참고·나 모두에서 보일 때만 같이 씀 (손으로 입을 가린 포즈 등)
export function compareHead(refN, liveN) {
  if (refN[NOSE].v < REF_VIS) return undefined
  if (liveN[NOSE].v < VIS) return null
  const r = headPos(refN), l = headPos(liveN)
  const dn = { x: r.nose.x - l.nose.x, y: r.nose.y - l.nose.y }
  const mouthSeen = [MOUTH_L, MOUTH_R].every((i) => refN[i].v >= REF_VIS && liveN[i].v >= VIS)
  if (!mouthSeen) return { dx: dn.x, dy: dn.y, err: Math.hypot(dn.x, dn.y) / HEAD_T }
  const dm = { x: r.mouth.x - l.mouth.x, y: r.mouth.y - l.mouth.y }
  return {
    dx: (dn.x + dm.x) / 2,
    dy: (dn.y + dm.y) / 2,
    err: Math.max(Math.hypot(dn.x, dn.y), Math.hypot(dm.x, dm.y)) / HEAD_T,
  }
}

// 머리 안내 문장 (사용자 몸 기준 왼쪽/오른쪽, adviceFor와 같은 규칙). d = compareHead 결과
export function headAdvice(d, mirrored) {
  if (Math.abs(d.dy) >= Math.abs(d.dx)) return d.dy > 0 ? '고개를 조금 숙여 보세요' : '턱을 조금 들어 보세요'
  const toRight = mirrored ? d.dx > 0 : d.dx < 0 // dx > 0 이면 화면 오른쪽으로 가야 함
  return `고개를 ${toRight ? '오른쪽' : '왼쪽'}으로 조금 돌려 보세요`
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

// ── 피부 보호 ──
// 분리 모델로 피부(얼굴·몸) 영역을 찾아서, 색감 통계에서 빼고 보정도 약하게만 적용 → 얼굴색이 이상해지지 않게
let segmenterP = null
export function getSegmenter() {
  segmenterP ??= getVision()
    .then((vision) => ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: SEGMENTER_URL, delegate: 'GPU' },
      runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
    }))
    .catch(() => null) // 모델을 못 받으면(오프라인 등) 피부 보호 없이 보정
  return segmenterP
}

// selfie_multiclass 모델의 부위 번호: 0 배경, 1 머리카락, 2 몸 피부, 3 얼굴 피부, 4 옷, 5 기타(소품)
// 보호 영역 = 배경이 아닌 곳 전부(머리카락·피부·얼굴·옷·소품) → 색감 보정을 전혀 적용하지 않고 배경만 참고 사진 색감으로
// (머리카락을 빼면 파란 참고 사진에서 머리가 파랗게 물들어서 사람 전체를 보호함)
const BACKGROUND = 0

// 보호 영역일 확률 지도 { data: 0~1, w, h }. 작게 줄인 사본으로 계산(빠름)하고, 쓸 때 위치 비율로 찾아봄
export function skinMaskOf(segmenter, img, max = 512) {
  if (!segmenter) return null
  const iw = img.naturalWidth ?? img.width, ih = img.naturalHeight ?? img.height
  const k = Math.min(1, max / Math.max(iw, ih))
  const c = document.createElement('canvas')
  c.width = Math.round(iw * k); c.height = Math.round(ih * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  let mask = null
  segmenter.segment(c, (result) => { // 결과는 이 함수 안에서만 유효해서 바로 복사
    const m = result.confidenceMasks
    if (!m || !m[BACKGROUND]) return
    const bg = m[BACKGROUND].getAsFloat32Array()
    const data = new Float32Array(bg.length)
    for (let i = 0; i < data.length; i++) data[i] = 1 - bg[i]
    mask = { data, w: m[BACKGROUND].width, h: m[BACKGROUND].height }
  })
  return mask
}

// x·y가 w×h 그림의 위치일 때, 그 자리의 보호 영역 확률
// 작은 지도를 큰 사진에 쓰므로 주변 4칸을 거리만큼 섞어 읽음(이중선형 보간) → 경계가 계단처럼 보이지 않음
function skinAt(mask, x, y, w, h) {
  if (!mask) return 0
  const W = mask.w, d = mask.data
  const fx = Math.min(W - 1, Math.max(0, ((x + 0.5) * W) / w - 0.5))
  const fy = Math.min(mask.h - 1, Math.max(0, ((y + 0.5) * mask.h) / h - 0.5))
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(mask.h - 1, y0 + 1)
  const tx = fx - x0, ty = fy - y0
  return (d[y0 * W + x0] * (1 - tx) + d[y0 * W + x1] * tx) * (1 - ty) + (d[y1 * W + x0] * (1 - tx) + d[y1 * W + x1] * tx) * ty
}

// 너무 어둡거나(L < 4) 하얗게 날아간(L > 96) 픽셀은 색 정보가 없어서 통계에서 뺌
const L_MIN = 4, L_MAX = 96

// 피부가 아닌 곳(배경·옷·머리카락)의 색 통계. 피부일수록 덜 반영(가중치 1 - 피부 확률)
function labStats(data, w, h, mask) {
  const sum = [0, 0, 0], sq = [0, 0, 0], all = [0, 0, 0], allSq = [0, 0, 0], lab = [0, 0, 0]
  let n = 0, total = 0
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    rgbToLab(data[i], data[i + 1], data[i + 2], lab)
    total++
    for (let c = 0; c < 3; c++) { all[c] += lab[c]; allSq[c] += lab[c] ** 2 }
    if (lab[0] < L_MIN || lab[0] > L_MAX) continue
    const wgt = 1 - skinAt(mask, p % w, Math.floor(p / w), w, h)
    n += wgt
    for (let c = 0; c < 3; c++) { sum[c] += wgt * lab[c]; sq[c] += wgt * lab[c] ** 2 }
  }
  // 남은 픽셀이 너무 적으면(얼굴만 크게 나온 사진, 거의 검거나 흰 사진) 전체 픽셀로 계산
  const [S, Q, N] = n > total * 0.05 ? [sum, sq, n] : [all, allSq, total]
  const mean = S.map((v) => v / N)
  const std = Q.map((q, c) => Math.sqrt(Math.max(q / N - mean[c] ** 2, 1)))
  return { mean, std }
}

export function statsOf(img, mask = null) {
  const c = document.createElement('canvas')
  const k = 200 / Math.max(img.width, img.height) // 작게 줄여서 빠르게 계산
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return labStats(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, mask)
}

// 퍼짐(대비·채도) 변화 폭 제한: 밝기 0.7~1.4배, 색(a·b) 0.8~1.25배 → 색이 과하게 튀지 않게
const RATIO_RANGE = [[0.7, 1.4], [0.8, 1.25], [0.8, 1.25]]
// '참고 사진 색감 적용' 버튼을 눌렀을 때 한 번만 계산하는 100% 보정 결과 (원본은 건드리지 않음)
// mask가 있으면 보호 영역(사람 전체)은 원래 색 그대로 (경계는 확률만큼 부드럽게 섞임)
export function matchColor(original, src, ref, mask = null) {
  const { width: W, height: H } = original
  const out = new ImageData(new Uint8ClampedArray(original.data), W, H)
  const d = out.data
  const ratio = RATIO_RANGE.map(([lo, hi], c) => Math.min(hi, Math.max(lo, ref.std[c] / src.std[c])))
  const lab = [0, 0, 0], rgb = [0, 0, 0]
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const wgt = 1 - skinAt(mask, p % W, Math.floor(p / W), W, H)
    rgbToLab(d[i], d[i + 1], d[i + 2], lab)
    for (let c = 0; c < 3; c++) {
      const moved = (lab[c] - src.mean[c]) * ratio[c] + ref.mean[c]
      lab[c] += wgt * (moved - lab[c])
    }
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
