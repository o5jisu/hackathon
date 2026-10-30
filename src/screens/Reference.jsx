// 02 참고 사진 확인 (v2): 사진은 위에 꽉 차게(인식된 뼈대 표시), 정보와 시작 버튼은 아래 시트
import { BONES, REF_VIS } from '../pose'

const SKELETON = [...BONES, [0, 11], [0, 12]] // 코를 두 어깨와 이어 머리 위치를 보여 줌
const DOTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
const DRAW_VIS = 0.1 // 이보다 안 보이면 그리지 않음 (코칭 화면과 같은 기준)

// pts = 참고 사진 픽셀 좌표의 관절, size = 참고 사진 원래 크기 {w, h}
export default function Reference({ url, size, pts, info, analyzing, error, onChange, onStart, onBack }) {
  const aspect = size.w / size.h
  const w = aspect >= 1 ? 1000 : 1000 * aspect, h = aspect >= 1 ? 1000 / aspect : 1000 // viewBox (사진 비율 그대로)
  const P = (j) => ({ x: (pts[j].x / size.w) * w, y: (pts[j].y / size.h) * h })
  const seen = (j) => pts[j].v >= DRAW_VIS
  const sure = (j) => pts[j].v >= REF_VIS // 판정에 쓰는 관절 (흐린 점은 판정에서 빠짐)
  const r = Math.max(w, h) * 0.011
  return (
    <section className="reference">
      <div className="ref-hero">
        {/* 사진 비율 그대로 들어가는 상자: 뼈대 SVG가 사진과 정확히 겹침 */}
        <div className="ref-box" style={{ '--ar': aspect }}>
          <img src={url} alt="참고 사진" />
          <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            {SKELETON.filter(([a, b]) => seen(a) && seen(b)).map(([a, b]) => (
              <line key={`${a}-${b}`} x1={P(a).x} y1={P(a).y} x2={P(b).x} y2={P(b).y}
                stroke="#FAF5EB" strokeWidth={r * 0.55} strokeDasharray={`${r * 1.3} ${r * 1.1}`} strokeLinecap="round"
                opacity={sure(a) && sure(b) ? 1 : 0.4} />
            ))}
            {DOTS.filter(seen).map((j) => (
              <circle key={j} cx={P(j).x} cy={P(j).y} r={j === 0 ? r * 1.3 : r}
                fill="#FAF5EB" stroke="#1A1612" strokeWidth={r * 0.3} opacity={sure(j) ? 1 : 0.4} />
            ))}
          </svg>
        </div>
        <button className="round glass ref-back" onClick={onBack} aria-label="처음 화면으로">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <label className={`glass pill ref-change${analyzing ? ' disabled' : ''}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 8" /></svg>
          {analyzing ? '읽는 중…' : '사진 바꾸기'}
          <input type="file" accept="image/*" disabled={analyzing}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onChange(f) }} />
        </label>
      </div>

      <div className="sheet">
        <span className="handle" aria-hidden="true" />
        <div className="sheet-title">
          <h1>{info.mode === 'upper' ? '상반신 포즈' : '전신 포즈'}</h1>
          <span className="chip">비교 {info.count}곳</span>
        </div>
        <p className="hint left">
          {info.mode === 'upper' ? '상반신 사진이라 어깨·팔·얼굴만 비교해요. ' : ''}
          흐린 점은 사진에서 잘 안 보여서 비교하지 않아요.
        </p>
        <div className="sheet-hint">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="14" rx="2" /><path d="M12 21v-4M8 21h8" /></svg>
          폰을 세워 두고 2~3m 뒤로 물러서 주세요
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="btn primary" onClick={onStart} disabled={analyzing}>따라 찍기 시작</button>
      </div>
    </section>
  )
}
