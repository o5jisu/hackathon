// 필름 질감 효과 (브라우저 Canvas만 사용, 서버·외부 API 없음)
// 순서: 소프트 포커스 → 따뜻함(플래시) → 비네팅 → 그레인. 그레인을 마지막에 넣어야 다른 효과에 뭉개지지 않음
// 각 값은 0~1 (0이면 효과 없음)

export const NO_FILM = { grain: 0, soft: 0, vignette: 0, warmth: 0 }
export const hasFilm = (f) => f.grain > 0 || f.soft > 0 || f.vignette > 0 || f.warmth > 0

// 소프트 포커스: 흐리게 만든 사본을 원본 위에 살짝 겹침 → 선명도가 낮아지고 밝은 곳이 은은하게 번짐
function softFocus(image, amount) {
  const { width: W, height: H } = image
  const src = document.createElement('canvas')
  src.width = W; src.height = H
  src.getContext('2d').putImageData(image, 0, 0)
  const out = document.createElement('canvas')
  out.width = W; out.height = H
  const ctx = out.getContext('2d')
  ctx.drawImage(src, 0, 0)
  ctx.filter = `blur(${Math.max(W, H) * 0.006}px)` // 사진 크기에 비례한 흐림 (긴 변 1000px이면 6px)
  ctx.globalAlpha = amount * 0.6
  ctx.drawImage(src, 0, 0)
  return ctx.getImageData(0, 0, W, H)
}

// 같은 그레인 무늬가 매번 나오도록 고정된 난수 (슬라이더를 움직여도 알갱이가 깜빡이지 않음)
function seededRandom(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// image: 원본 ImageData (바꾸지 않음), f: { grain, soft, vignette, warmth } → 새 ImageData
export function applyFilm(image, f) {
  const base = f.soft > 0 ? softFocus(image, f.soft) : image
  const { width: W, height: H } = base
  const out = new ImageData(new Uint8ClampedArray(base.data), W, H)
  const d = out.data
  const rand = seededRandom(1234)
  const cx = W / 2, cy = H / 2
  const rMax = Math.hypot(cx, cy)
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2]
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255

      // 따뜻함(플래시): 밝은 곳일수록 붉고 노랗게, 살짝 더 밝게
      if (f.warmth > 0) {
        const w = f.warmth * lum
        r += 28 * w; g += 10 * w; b -= 18 * w
      }

      // 비네팅: 가운데에서 멀수록 어둡게 (가운데 40%는 그대로, 바깥으로 갈수록 부드럽게)
      if (f.vignette > 0) {
        const t = Math.min(1, Math.max(0, (Math.hypot(x - cx, y - cy) / rMax - 0.4) / 0.6))
        const k = 1 - f.vignette * 0.65 * t * t * (3 - 2 * t)
        r *= k; g *= k; b *= k
      }

      // 그레인: 흑백 알갱이. 중간 밝기에서 가장 잘 보이고 아주 어둡거나 밝은 곳에선 약하게 (필름처럼)
      if (f.grain > 0) {
        const n = (rand() + rand() - 1) * 40 * f.grain * (0.4 + 2.4 * lum * (1 - lum))
        r += n; g += n; b += n
      }

      d[i] = r; d[i + 1] = g; d[i + 2] = b // Uint8ClampedArray라 0~255로 자동 제한
    }
  }
  return out
}
