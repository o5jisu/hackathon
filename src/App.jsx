import { useEffect, useRef, useState } from 'react'
import {
  createLandmarkers, toPixels, toFrame, frameRect, mirror, bodyFrame, normalize, compare, adviceFor,
  TARGETS, tolOf, HEAD_PTS, BONES, compareHead, headAdvice, MATCH_T, statsOf, matchColor, blendImages, toAnalysisCanvas, smoothPoints,
} from './pose'
import './App.css'

const NO_ALIGN = { scale: 1, dx: 0, dy: 0 } // 참고 사진 처음 상태: 가운데에 원래 비율로 가장 크게
const MIN_SCALE = 0.3, MAX_SCALE = 2

export default function App() {
  const [screen, setScreen] = useState('upload') // upload | coaching | captured
  const [status, setStatus] = useState('AI 모델을 불러오는 중…')
  const [ready, setReady] = useState(false)
  const [refUrl, setRefUrl] = useState(null)
  const [message, setMessage] = useState('')
  const [score, setScore] = useState(0)
  const [matchedCapture, setMatchedCapture] = useState(null) // 색감 적용 버튼을 누른 뒤 계산한 결과
  const [colorMatchStrength, setColorMatchStrength] = useState(0.7)
  const [busy, setBusy] = useState(false)
  const [facing, setFacing] = useState('user') // 'user' = 앞 카메라(거울 화면), 'environment' = 뒤 카메라
  const [canSwitch, setCanSwitch] = useState(false) // 카메라가 2개 이상일 때만 전환 버튼 표시
  const [showGrid, setShowGrid] = useState(true) // 3×3 구도 격자 (촬영 사진에는 안 들어감)
  const [showSettings, setShowSettings] = useState(false) // 촬영에 방해되지 않게 설정은 접어 둠
  const [refOpacity, setRefOpacity] = useState(0.35) // 참고 사진 불투명도 (화면엔 투명도 = 1 - 이 값으로 표시)
  const [refAspect, setRefAspect] = useState(1) // 참고 사진 가로/세로 비율 = 촬영 틀 비율
  const [videoAspect, setVideoAspect] = useState(9 / 16) // 카메라 영상 가로/세로 비율 (영상이 오면 실제 값으로 바뀜)
  const [align, setAlign] = useState(NO_ALIGN) // 참고 사진 틀 크기·위치 (끌기·두 손가락으로 조절)
  const [cropToRef, setCropToRef] = useState(true) // 촬영 사진을 참고 사진 틀에 맞춰 자를지
  const [stream, setStream] = useState(null) // 켜져 있는 카메라 영상

  const models = useRef(null)
  const refImg = useRef(null)
  const refPts = useRef(null) // 참고 포즈 (참고 사진 픽셀 좌표 = 틀 좌표) → 화면에 기준점 그릴 때
  const refN = useRef(null) // 참고 포즈 (몸통 기준 상대 좌표) → 판정할 때
  const alignRef = useRef(align) // 카메라 루프에서 최신 틀 위치를 읽기 위한 복사본
  useEffect(() => { alignRef.current = align }, [align])
  const touches = useRef({ pts: new Map(), start: null }) // 화면을 누르고 있는 손가락들
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const originalRef = useRef(null) // 원본 캔버스 (왼쪽, 고정)
  const previewRef = useRef(null) // 보정 미리보기 캔버스 (오른쪽, 슬라이더로 바뀜)
  const shots = useRef(null) // 촬영 결과 { full: 카메라 전체, crop: 참고 사진 틀만큼 자른 것 } (캔버스)
  const originalCapture = useRef(null) // { image: ImageData, canvas } 편집 중 바꾸지 않는 원본 (full 또는 crop)

  // 1) 앱 시작 시 AI 모델 로드
  useEffect(() => {
    createLandmarkers()
      .then((m) => { models.current = m; setReady(true); setStatus('') })
      .catch((e) => setStatus('모델 로드 실패: 인터넷 연결을 확인해 주세요. (' + e.message + ')'))
  }, [])

  // 2) 참고 사진 업로드 → 포즈 분석
  async function onUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (refUrl) URL.revokeObjectURL(refUrl)
    setStatus('참고 사진의 포즈를 분석하는 중…')
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    await img.decode()
    const res = models.current.image.detect(toAnalysisCanvas(img))
    const lms = res.landmarks?.[0]
    const pts = lms && toPixels(lms, img.naturalWidth, img.naturalHeight)
    const f = pts && bodyFrame(pts)
    if (!f) {
      setStatus('사람의 어깨와 골반이 잘 보이는 사진을 골라 주세요.')
      setRefUrl(null); refN.current = null
      return
    }
    refImg.current = img
    refPts.current = pts
    refN.current = normalize(pts, f)
    setRefAspect(img.naturalWidth / img.naturalHeight)
    setAlign(NO_ALIGN) // 새 사진은 원래 비율·가장 큰 크기로 시작
    setRefUrl(url)
    setStatus('')
  }

  // 3) 카메라 켜기 (버튼 클릭 직후에 카메라 권한을 요청해야 폰에서 동작)
  // 폰은 카메라 두 개를 동시에 못 켜는 경우가 많아서, 켜기 전에 기존 카메라를 먼저 끔
  async function openCamera(mode) {
    stopCamera()
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    setFacing(mode)
    setStream(stream)
    setScreen('coaching')
    // 권한을 받은 뒤에야 카메라 목록을 정확히 알 수 있음
    const devices = await navigator.mediaDevices.enumerateDevices()
    setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1)
  }

  async function startCoaching() {
    try {
      await openCamera(facing)
    } catch {
      setStatus('카메라를 켤 수 없어요. 권한을 허용했는지, https 주소로 접속했는지 확인해 주세요.')
    }
  }

  async function switchCamera() {
    const next = facing === 'user' ? 'environment' : 'user'
    try {
      await openCamera(next)
    } catch {
      setMessage('다른 카메라를 켤 수 없어요.')
      openCamera(facing).catch(() => {}) // 원래 카메라로 되돌림
    }
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop())
  }

  // 코칭 화면의 <video>가 실제로 생긴 뒤에 카메라 영상을 연결 (아이폰에서 연결 시점이 빠르면 화면이 검게 나옴)
  useEffect(() => {
    const video = videoRef.current
    if (screen !== 'coaching' || !video || !stream) return
    video.srcObject = stream
    video.play().catch((e) => setMessage('카메라 화면을 재생할 수 없어요. (' + e.name + ')'))
  }, [screen, stream])

  // 4) 실시간 코칭 루프 (자동 촬영 없음: 셔터 버튼을 눌러야 찍힘). 카메라를 바꾸면 처음부터 다시 시작
  useEffect(() => {
    if (screen !== 'coaching') return
    const mirrored = facing === 'user'
    let raf, lastTime = -1, lastRun = 0, stopped = false, aspect = 0
    const ema = {}
    const headEma = {} // 머리 각도 차이도 같은 방식으로 흔들림 줄이기
    let smoothed = null // 최근 관절 위치 (흔들림 줄이기용)

    const loop = () => {
      if (stopped) return
      raf = requestAnimationFrame(loop)
      const video = videoRef.current, canvas = canvasRef.current
      if (!video || video.readyState < 2 || !video.videoWidth) return
      const now = performance.now()
      if (video.currentTime === lastTime || now - lastRun < 66) return // 초당 약 15번
      lastTime = video.currentTime; lastRun = now

      // 카메라 화면 상자는 영상과 같은 비율이라 잘리는 곳이 없음. 영상 비율이 바뀌면(폰 회전 등) 상자도 맞춤
      const W = video.videoWidth, H = video.videoHeight
      if (Math.abs(W / H - aspect) > 0.01) { aspect = W / H; setVideoAspect(aspect) }

      const bw = canvas.clientWidth, bh = canvas.clientHeight, dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(bw * dpr) || canvas.height !== Math.round(bh * dpr)) {
        canvas.width = Math.round(bw * dpr); canvas.height = Math.round(bh * dpr)
      }
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, bw, bh)

      // 참고 사진 틀이 화면에 놓인 영역 (끌기·확대에 따라 바뀜). 관절 좌표는 모두 이 틀 기준
      const img = refImg.current, fw = img.naturalWidth, fh = img.naturalHeight
      const r = frameRect(fw / fh, W / H, alignRef.current)
      const onScreen = (p) => ({ x: (r.x + (p.x / fw) * r.w) * bw, y: (r.y + (p.y / fh) * r.h) * bh, v: p.v })

      // 참고 사진 속 인물의 관절 위치에 기준점(흰 테두리) 표시 → 사진을 옮기면 같이 움직임
      drawRefSkeleton(ctx, withMouth(refPts.current.map(onScreen)))

      let res
      try { res = models.current.video.detectForVideo(video, now) }
      catch (e) { show('포즈 분석 오류: ' + e.message, 0); return } // 폰에서 원인을 바로 볼 수 있게 화면에 표시
      const lms = res.landmarks?.[0]
      if (!lms) { smoothed = null; show('화면 안으로 들어와 주세요', 0); return }

      // 앞 카메라 화면은 거울처럼 보이므로 좌표도 뒤집음. 흔들림 줄이기는 카메라 화면 좌표(0~1)에서 먼저 하고,
      // 그다음 틀 좌표로 바꿈 → 사진 크기·위치를 바꾸는 중에도 관절점이 끌려가지 않음
      const cam = toPixels(mirrored ? mirror(lms, 1) : lms, 1, 1) // 카메라 화면 밖 관절은 안 보이는 것으로
      smoothed = smoothPoints(smoothed, cam)
      const live = toFrame(smoothed, r, fw, fh)
      const f = bodyFrame(live)
      if (!f) { show('상체가 화면에 보이도록 한 걸음 물러나 주세요', 0); return }
      const liveN = normalize(live, f)
      const ref = refN.current

      // 판정은 몸통 기준 정규화 좌표로 (거리·몸 크기 차이 무시) + 흔들림 줄이기(최근 값 가중 평균)
      const dist = compare(ref, liveN)
      const state = {}
      let ok = 0, total = 0, worst = null, worstD = 0, hidden = 0
      for (const j of TARGETS) {
        if (!(j in dist)) continue
        total++
        if (dist[j] === null) { state[j] = 'unknown'; hidden++; continue }
        ema[j] = ema[j] === undefined ? dist[j] : ema[j] * 0.6 + dist[j] * 0.4
        const t = tolOf(j) // 어깨·골반은 10%, 팔다리는 30%
        if (ema[j] < t) { state[j] = 'ok'; ok++ }
        else {
          state[j] = 'bad'
          // 허용 범위 대비 얼마나 벗어났는지로 "가장 많이 틀린 곳"을 고름 (팔다리 기준 척도로 맞춤)
          const d = (ema[j] / t) * MATCH_T
          if (d > worstD) { worstD = d; worst = j }
        }
      }

      // 머리: 목 기준 코·입 위치 비교 (숙이기·들기·돌리기·기울이기). err가 1 미만이면 맞음
      const head = compareHead(ref, liveN)
      if (head !== undefined) {
        total++
        let headState = 'unknown'
        if (head === null) hidden++
        else {
          for (const k of ['dx', 'dy', 'err']) {
            headEma[k] = headEma[k] === undefined ? head[k] : headEma[k] * 0.6 + head[k] * 0.4
          }
          if (headEma.err < 1) { headState = 'ok'; ok++ }
          else {
            headState = 'bad'
            // 팔다리 거리(MATCH_T 기준)와 같은 척도로 바꿔서 "가장 많이 틀린 곳"을 고름
            if (headEma.err * MATCH_T > worstD) { worstD = headEma.err * MATCH_T; worst = 'head' }
          }
        }
        for (const j of [...HEAD_PTS, MOUTH]) state[j] = headState
      }
      const pct = total ? Math.round((ok / total) * 100) : 0
      drawLiveSkeleton(ctx, withMouth(live.map(onScreen)), (j) => state[j], total > 0 && ok === total)
      if (total === 0) show('참고 사진에 팔다리가 잘 보이지 않아요', 0)
      else if (hidden > 0 && worst === null) show('전신이 화면에 나오도록 한 걸음 물러나 보세요', pct)
      else if (worst === 'head') show(headAdvice(headEma, mirrored), pct)
      else if (worst !== null) show(adviceFor(worst, ref, liveN, mirrored), pct)
      else show('좋아요! 셔터 버튼을 눌러 찍어 보세요', 100)
    }

    function show(text, pct) {
      setMessage(text); setScore(pct)
    }
    raf = requestAnimationFrame(loop)
    return () => { stopped = true; cancelAnimationFrame(raf) }
  }, [screen, facing])

  // 참고 사진 틀 조절: 한 손가락 = 끌어서 이동, 두 손가락 = 벌리거나 오므려 크기 조절
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = touches.current
    t.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    t.start = { pts: new Map(t.pts), align } // 손가락 수가 바뀔 때마다 기준을 새로 잡음
  }
  function onPointerMove(e) {
    const t = touches.current
    if (!t.pts.has(e.pointerId) || !t.start) return
    t.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const box = e.currentTarget.getBoundingClientRect()
    const now = [...t.pts.values()], before = [...t.start.pts.values()]
    const center = (ps) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length })
    const c1 = center(now), c0 = center(before)
    let scale = t.start.align.scale
    if (now.length >= 2 && before.length >= 2) {
      const gap = (ps) => Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)
      scale = clamp(scale * (gap(now) / gap(before)), MIN_SCALE, MAX_SCALE)
    }
    setAlign({
      scale,
      dx: clamp(t.start.align.dx + (c1.x - c0.x) / box.width, -0.5, 0.5), // 틀 가운데가 화면 밖으로 나가지 않게
      dy: clamp(t.start.align.dy + (c1.y - c0.y) / box.height, -0.5, 0.5),
    })
  }
  function onPointerUp(e) {
    const t = touches.current
    t.pts.delete(e.pointerId)
    t.start = t.pts.size ? { pts: new Map(t.pts), align: alignRef.current } : null
  }

  // 5) 촬영(셔터 버튼): 오버레이 없이 카메라 원본만, 화면에 보이던 방향 그대로
  // 카메라 전체 사진과, 참고 사진 틀 영역만큼 자른 사진을 둘 다 만들어 둠
  function capture() {
    const video = videoRef.current
    const W = video.videoWidth, H = video.videoHeight
    const full = document.createElement('canvas')
    full.width = W; full.height = H
    const ctx = full.getContext('2d')
    if (facing === 'user') { ctx.translate(W, 0); ctx.scale(-1, 1) } // 앞 카메라는 거울 방향
    ctx.drawImage(video, 0, 0)
    // 틀이 카메라 화면 밖으로 나간 부분은 찍힌 게 없으므로 화면 안쪽만 자름
    const r = frameRect(refAspect, W / H, align)
    const x0 = Math.max(0, r.x * W), y0 = Math.max(0, r.y * H)
    const x1 = Math.min(W, (r.x + r.w) * W), y1 = Math.min(H, (r.y + r.h) * H)
    const crop = document.createElement('canvas')
    crop.width = Math.max(1, Math.round(x1 - x0)); crop.height = Math.max(1, Math.round(y1 - y0))
    crop.getContext('2d').drawImage(full, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.width, crop.height)
    shots.current = { full, crop }
    selectShot(true) // 기본: 참고 사진에 맞춰 자른 사진
    setShowSettings(false)
    stopCamera()
    setScreen('captured')
  }

  // 자른 사진 / 전체 사진 중 하나를 원본으로 정함. 원본이 바뀌면 색감 보정은 처음부터 (촬영 직후엔 원본만)
  function selectShot(crop) {
    const c = crop ? shots.current.crop : shots.current.full
    originalCapture.current = { image: c.getContext('2d').getImageData(0, 0, c.width, c.height), canvas: c }
    setCropToRef(crop)
    setMatchedCapture(null)
  }

  // 6) 결과 화면: 원본은 왼쪽에 고정해서 한 번만 그림 (자르기를 켜고 끄면 다시 그림)
  useEffect(() => {
    if (screen !== 'captured' || !originalCapture.current) return
    putImage(originalRef.current, originalCapture.current.image)
  }, [screen, cropToRef])

  // '참고 사진 색감 적용' 버튼을 눌렀을 때만 색감 계산
  function applyMatch() {
    setBusy(true)
    setTimeout(() => { // 화면에 '계산 중'이 먼저 보이도록 한 박자 쉬고 계산
      const { image, canvas } = originalCapture.current
      setMatchedCapture(matchColor(image, statsOf(canvas), statsOf(refImg.current)))
      setBusy(false)
    }, 30)
  }

  // 보정 미리보기(previewCapture): 슬라이더가 바뀔 때마다 원본 + 보정 결과를 섞어 오른쪽에만 그림
  useEffect(() => {
    if (!matchedCapture) return
    putImage(previewRef.current, blendImages(originalCapture.current.image, matchedCapture, colorMatchStrength))
  }, [matchedCapture, colorMatchStrength])

  function save() {
    const c = matchedCapture ? previewRef.current : originalRef.current
    c.toBlob((b) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b); a.download = 'posemate.jpg'; a.click()
    }, 'image/jpeg', 0.92)
  }

  // ── 화면 ──
  const scoreColor = score >= 100 ? '#22c55e' : score >= 60 ? '#facc15' : '#fff'
  // 참고 사진 틀 위치 (카메라 상자 대비 %). 카메라 루프의 관절 좌표와 같은 frameRect 계산을 씀
  const fr = frameRect(refAspect, videoAspect, align)
  const frameStyle = { left: `${fr.x * 100}%`, top: `${fr.y * 100}%`, width: `${fr.w * 100}%`, height: `${fr.h * 100}%` }

  return (
    <div className="app">
      {screen === 'upload' && (
        <section className="panel">
          <h1>포즈메이트</h1>
          <p className="lead">따라 하고 싶은 사진을 올리면, 카메라 화면에 겹쳐 보여 주며 포즈를 맞추도록 안내해 드려요.</p>
          <label className="file">
            참고 사진 고르기
            <input type="file" accept="image/*" onChange={onUpload} disabled={!ready} />
          </label>
          {refUrl && <img className="preview" src={refUrl} alt="참고 사진" />}
          {status && <p className="status">{status}</p>}
          <button className="primary" disabled={!ready || !refN.current} onClick={startCoaching}>
            코칭 시작
          </button>
          <p className="hint">폰을 세워 두고 2~3m 떨어져 서 주세요.</p>
        </section>
      )}

      {screen === 'coaching' && (
        <section className="stage">
          {/* 카메라 상자 = 영상 비율 그대로(잘림 없음). 그 위의 참고 사진 틀 = 촬영 후 잘릴 영역 (끌기·두 손가락으로 조절) */}
          <div className="camera" style={{ '--va': videoAspect }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <video ref={videoRef} autoPlay playsInline muted className={facing === 'user' ? 'mirrored' : ''} />
            <div className="frame" style={frameStyle}>
              {/* 흐림·투명도는 참고 사진에만 적용 (카메라·관절점은 선명하게) */}
              <img className="ref-overlay" src={refUrl} alt="" draggable={false} style={{ opacity: refOpacity }} />
              {showGrid && <div className="grid" />}
            </div>
            <canvas ref={canvasRef} />
          </div>

          {/* 위: 안내 한 줄만 */}
          <div className="topbar">
            <b style={{ color: scoreColor }}>{score}%</b> {message || '준비 중…'}
          </div>

          {/* 설정: 평소엔 접어 두고 ⚙ 버튼을 누를 때만 펼침 */}
          {showSettings && (
            <div className="settings">
              <label>
                사진 투명도 {Math.round((1 - refOpacity) * 100)}%
                <input type="range" min="0" max="100" step="5" value={Math.round((1 - refOpacity) * 100)}
                  onChange={(e) => setRefOpacity(1 - Number(e.target.value) / 100)} />
              </label>
              <label>
                사진 크기 {Math.round(align.scale * 100)}%
                <input type="range" min={MIN_SCALE} max={MAX_SCALE} step="0.05" value={align.scale}
                  onChange={(e) => setAlign((a) => ({ ...a, scale: Number(e.target.value) }))} />
              </label>
              <p className="tip">화면을 끌면 사진이 움직이고, 두 손가락으로 크기를 바꿀 수 있어요.</p>
              <div className="row">
                <button onClick={() => setAlign(NO_ALIGN)}>원래 크기로</button>
                <button onClick={() => setShowGrid((g) => !g)}>{showGrid ? '격자 끄기' : '격자 켜기'}</button>
                {canSwitch && <button onClick={switchCamera}>{facing === 'user' ? '뒤 카메라' : '앞 카메라'}</button>}
              </div>
              <div className="legend">
                <span><i className="dot ref" />흰 점선: 참고 사진 포즈</span>
                <span><i className="dot ok" />초록색: 기준 위치에 가까움 (모두 맞으면 뼈대 전체가 초록)</span>
                <span><i className="dot bad" />빨간색: 위치를 조정해 보세요</span>
              </div>
            </div>
          )}

          {/* 아래: 설정 · 셔터 · 닫기 */}
          <div className="bottombar">
            <button className="round glass" onClick={() => setShowSettings((v) => !v)} aria-label="설정">
              {showSettings ? '✕' : '⚙'}
            </button>
            <button className="shutter" onClick={capture} aria-label="촬영" />
            <button className="round glass" onClick={() => { stopCamera(); setShowSettings(false); setScreen('upload') }} aria-label="그만하기">
              ⏏
            </button>
          </div>
        </section>
      )}

      {screen === 'captured' && (
        <section className="panel wide">
          <h2>촬영 완료</h2>
          <div className={matchedCapture ? 'compare' : 'compare single'}>
            <figure>
              <canvas ref={originalRef} className="result" />
              <figcaption>원본</figcaption>
            </figure>
            {matchedCapture && (
              <figure>
                <canvas ref={previewRef} className="result" />
                <figcaption>참고 사진 색감 {Math.round(colorMatchStrength * 100)}%</figcaption>
              </figure>
            )}
          </div>
          {!matchedCapture && (
            <button className="primary" disabled={busy} onClick={applyMatch}>
              {busy ? '색감 계산 중…' : '참고 사진 색감 적용'}
            </button>
          )}
          <label className="slider">
            보정 강도 {matchedCapture ? '' : '(색감 적용 후 사용할 수 있어요)'}
            <input type="range" min="0" max="1" step="0.05" value={colorMatchStrength}
              disabled={!matchedCapture}
              onChange={(e) => setColorMatchStrength(Number(e.target.value))} />
          </label>
          <div className="actions">
            <button onClick={() => selectShot(!cropToRef)}>
              {cropToRef ? '자르기 전 전체 사진 보기' : '참고 사진에 맞춰 자르기'}
            </button>
            {matchedCapture && <button onClick={() => setMatchedCapture(null)}>보정 전으로</button>}
            <button className="primary" onClick={save}>저장</button>
            <button onClick={startCoaching}>다시 찍기</button>
          </div>
        </section>
      )}
    </div>
  )
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function putImage(canvas, image) {
  canvas.width = image.width; canvas.height = image.height
  canvas.getContext('2d').putImageData(image, 0, 0)
}

// 얼굴은 코 + 입 가운데(턱 대신) 2개만 표시. 판정도 같은 점으로 함 (목 기준 코·입 위치, pose.js의 compareHead)
// (포즈 모델에는 턱 점이 없어서, 입 양끝 9·10번의 가운데를 33번 점으로 추가)
const MOUTH = 33
const withMouth = (ps) => [...ps, { x: (ps[9].x + ps[10].x) / 2, y: (ps[9].y + ps[10].y) / 2, v: Math.min(ps[9].v, ps[10].v) }]
const DRAWN = [0, MOUTH, ...TARGETS]
const isHead = (j) => j === 0 || j === MOUTH

// 뼈대: 팔·다리·몸통 선 + 얼굴(코–입) 선. 어깨·골반은 선을 잇기 위해 점도 그림
const SKELETON = [...BONES, [0, MOUTH]]
const COLOR = { ok: '#22c55e', bad: '#ef4444', idle: 'rgba(255,255,255,0.85)' }

// 그리기 기준: 보이는 정도(v)가 0.5 미만이어도 모델이 위치를 짐작해 주므로(가려진 다리 등) 0.1 이상이면 그려서
// 뼈대가 끊기지 않게 함. 대신 흐리게 그려 "확실하지 않음"을 표시. 판정은 여전히 0.5 이상만 (pose.js의 VIS)
const DRAW_VIS = 0.1, SURE_VIS = 0.5, WEAK_ALPHA = 0.35
const alphaOf = (...ps) => (ps.every((p) => p.v >= SURE_VIS) ? 1 : WEAK_ALPHA)

// 선 하나의 색: 판정한 끝점 중 하나라도 틀리면 빨강, 판정한 끝점이 모두 맞으면 초록.
// 어깨·골반도 판정하므로 몸통 선도 초록·빨강으로 바뀜. 판정 전(흰색)인 선은 포즈 전체가 맞을 때만 초록
function boneColor(a, b, stateOf, allOk) {
  const s = [stateOf(a), stateOf(b)].filter((x) => x === 'ok' || x === 'bad')
  if (s.includes('bad')) return COLOR.bad
  if (s.length) return COLOR.ok
  return allOk ? COLOR.ok : COLOR.idle
}

// 참고 포즈: 흰 점선 뼈대 + 속이 빈 원 (내 뼈대와 구분되도록 얇고 반투명하게)
function drawRefSkeleton(ctx, pts) {
  const seen = (j) => pts[j].v >= DRAW_VIS
  ctx.save()
  ctx.setLineDash([6, 6]); ctx.lineCap = 'round'
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  for (const [a, b] of SKELETON) {
    if (!seen(a) || !seen(b)) continue
    ctx.globalAlpha = alphaOf(pts[a], pts[b])
    ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); ctx.stroke()
  }
  ctx.setLineDash([])
  for (const j of DRAWN) { // DRAWN에 어깨·골반(TARGETS)도 들어 있음
    if (!seen(j)) continue
    ctx.globalAlpha = alphaOf(pts[j])
    ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, isHead(j) ? 5 : 9, 0, Math.PI * 2)
    ctx.lineWidth = 2.5; ctx.stroke()
  }
  ctx.restore()
}

// 내 포즈: 실선 뼈대 + 꽉 찬 점. 맞으면 초록, 조정이 필요하면 빨강, 판정 전이면 흰색
function drawLiveSkeleton(ctx, pts, stateOf, allOk) {
  const seen = (j) => pts[j].v >= DRAW_VIS
  const pointColor = (j) => COLOR[stateOf(j)] ?? (allOk ? COLOR.ok : COLOR.idle)
  ctx.save()
  ctx.lineCap = 'round'
  for (const [a, b] of SKELETON) {
    if (!seen(a) || !seen(b)) continue
    ctx.globalAlpha = alphaOf(pts[a], pts[b])
    ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y)
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke() // 밝은 배경에서도 보이게 그림자
    ctx.lineWidth = 4; ctx.strokeStyle = boneColor(a, b, stateOf, allOk); ctx.stroke()
  }
  for (const j of DRAWN) { // DRAWN에 어깨·골반(TARGETS)도 들어 있음
    if (!seen(j)) continue
    ctx.globalAlpha = alphaOf(pts[j])
    ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, isHead(j) ? 3.5 : 6, 0, Math.PI * 2)
    ctx.fillStyle = pointColor(j); ctx.fill()
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke()
  }
  ctx.restore()
}
