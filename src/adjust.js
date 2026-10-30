// 직접 조정 (카메라·사진 앱의 노출·밝기·대비·하이라이트·그림자·채도). 브라우저 안에서만 계산
// 각 값은 -1~1 (0이면 변화 없음). 순서: 노출 → 밝기 → 대비 → 하이라이트·그림자 → 채도

export const NO_ADJUST = { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0 }
export const hasAdjust = (a) => Object.values(a).some((v) => v !== 0)

const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
const toSrgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

// image: 원본 ImageData (바꾸지 않음), a: { exposure, brightness, contrast, highlights, shadows, saturation } → 새 ImageData
export function applyAdjust(image, a) {
  // 노출·밝기·대비는 0~255 값마다 결과가 정해지므로 표(LUT)를 한 번 만들어 씀 (빠름)
  const ev = 2 ** (a.exposure * 1.5) // 노출: 빛의 양을 ±1.5스톱 (실제 빛 세기 = 선형 공간에서 곱함)
  const gamma = 2 ** -a.brightness // 밝기: 중간 톤 곡선 (어두운 곳·밝은 곳 끝은 그대로)
  const k = 1 + a.contrast * 0.6 // 대비: 중간 회색(0.5)을 기준으로 벌리거나 좁힘
  const lut = new Float32Array(256)
  for (let v = 0; v < 256; v++) {
    let x = Math.min(1, toSrgb(Math.min(1, toLinear(v / 255) * ev)))
    x = x ** gamma
    lut[v] = Math.min(1, Math.max(0, 0.5 + (x - 0.5) * k)) * 255
  }

  const out = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]]
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255

    // 하이라이트: 밝은 곳(밝기 50% 이상)만 / 그림자: 어두운 곳(50% 이하)만 밝게·어둡게. 세 채널에 같이 더해 색은 유지
    const shift = a.highlights * 64 * smooth(0.5, 1, lum) + a.shadows * 64 * (1 - smooth(0, 0.5, lum))
    r += shift; g += shift; b += shift

    // 채도: 회색(같은 밝기)에서 멀어지게(+) 또는 가까워지게(-). -1이면 흑백
    if (a.saturation !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b, s = 1 + a.saturation
      r = gray + (r - gray) * s; g = gray + (g - gray) * s; b = gray + (b - gray) * s
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b // Uint8ClampedArray라 0~255로 자동 제한
  }
  return out
}
