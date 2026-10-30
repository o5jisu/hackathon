import { useEffect, useRef, useState } from 'react'
import {
  createLandmarkers, toFrame, cropRect, FRAME_W, mirror, bodyFrame, normalize, compare, adviceFor,
  TARGETS, HEAD_PTS, compareHead, headAdvice, MATCH_T, statsOf, matchColor, blendImages, toAnalysisCanvas, smoothPoints,
} from './pose'
import './App.css'

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
  const [refOpacity, setRefOpacity] = useState(0.35) // 참고 사진 불투명도 (화면엔 투명도 = 1 - 이 값으로 표시)

  const models = useRef(null)
  const refImg = useRef(null)
  const refPts = useRef(null) // 참고 포즈 (9:16 틀 좌표) → 화면에 기준점 그릴 때
  const refN = useRef(null) // 참고 포즈 (몸통 기준 상대 좌표) → 판정할 때
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const originalRef = useRef(null) // 원본 캔버스 (왼쪽, 고정)
  const previewRef = useRef(null) // 보정 미리보기 캔버스 (오른쪽, 슬라이더로 바뀜)
  const originalCapture = useRef(null) // { image: ImageData, canvas } 편집 중 바꾸지 않는 원본

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
    // 사진 전체로 분석한 뒤, 카메라와 같은 9:16 틀(가운데 자르기) 좌표로 바꿈
    const pts = lms && toFrame(lms, img.naturalWidth, img.naturalHeight)
    const f = pts && bodyFrame(pts)
    if (!f) {
      setStatus(lms
        ? '9:16로 자르면 어깨나 골반이 잘려요. 사람이 가운데에 있는 사진을 골라 주세요.'
        : '사람의 어깨와 골반이 잘 보이는 사진을 골라 주세요.')
      setRefUrl(null); refN.current = null
      return
    }
    refImg.current = img
    refPts.current = pts
    refN.current = normalize(pts, f)
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
    setScreen('coaching')
    requestAnimationFrame(() => {
      videoRef.current.srcObject = stream
      videoRef.current.play()
    })
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
    const s = videoRef.current?.srcObject
    s?.getTracks().forEach((t) => t.stop())
  }

  // 4) 실시간 코칭 루프 (자동 촬영 없음: 셔터 버튼을 눌러야 찍힘). 카메라를 바꾸면 처음부터 다시 시작
  useEffect(() => {
    if (screen !== 'coaching') return
    const mirrored = facing === 'user'
    let raf, lastTime = -1, lastRun = 0, stopped = false
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

      // 캔버스를 9:16 틀 크기에 맞춤. 카메라·참고 사진 모두 이 틀에 꽉 차므로 배율 하나로 화면 좌표가 됨
      const bw = canvas.clientWidth, bh = canvas.clientHeight, dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(bw * dpr) || canvas.height !== Math.round(bh * dpr)) {
        canvas.width = Math.round(bw * dpr); canvas.height = Math.round(bh * dpr)
      }
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, bw, bh)
      const W = video.videoWidth, H = video.videoHeight
      const k = bw / FRAME_W
      const onScreen = (p) => ({ x: p.x * k, y: p.y * k, v: p.v })

      // 참고 사진 속 인물의 관절 위치에 기준점(흰 테두리) 표시
      drawRefPoints(ctx, refPts.current.map(onScreen))

      const res = models.current.video.detectForVideo(video, now)
      const lms = res.landmarks?.[0]
      if (!lms) { smoothed = null; show('화면 안으로 들어와 주세요', 0); return }

      smoothed = smoothPoints(smoothed, toFrame(lms, W, H))
      const live = mirrored ? mirror(smoothed, FRAME_W) : smoothed // 앞 카메라 화면은 거울처럼 보이므로 좌표도 뒤집음
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
        if (ema[j] < MATCH_T) { state[j] = 'ok'; ok++ }
        else { state[j] = 'bad'; if (ema[j] > worstD) { worstD = ema[j]; worst = j } }
      }

      // 머리 각도 (기울이기·돌리기·숙이기). 값은 허용 범위 대비 비율이라 1 미만이면 맞음
      const head = compareHead(refPts.current, live)
      let headAxis = null
      if (head !== undefined) {
        total++
        let headState = 'unknown'
        if (head === null) hidden++
        else {
          let err = 0
          for (const k of ['roll', 'yaw', 'pitch']) {
            headEma[k] = headEma[k] === undefined ? head[k] : headEma[k] * 0.6 + head[k] * 0.4
            if (Math.abs(headEma[k]) > err) { err = Math.abs(headEma[k]); headAxis = k }
          }
          if (err < 1) { headState = 'ok'; ok++ }
          else {
            headState = 'bad'
            // 팔다리 거리(MATCH_T 기준)와 같은 척도로 바꿔서 "가장 많이 틀린 곳"을 고름
            if (err * MATCH_T > worstD) { worstD = err * MATCH_T; worst = 'head' }
          }
        }
        for (const j of HEAD_PTS) state[j] = headState
      }
      const colorOf = (j) =>
        state[j] === 'ok' ? '#22c55e' : state[j] === 'bad' ? '#ef4444' : 'rgba(200,200,200,0.6)'
      drawLivePoints(ctx, live.map(onScreen), colorOf)

      const pct = total ? Math.round((ok / total) * 100) : 0
      if (total === 0) show('참고 사진에 팔다리가 잘 보이지 않아요', 0)
      else if (hidden > 0 && worst === null) show('전신이 나오도록 한 걸음 물러나 보세요', pct)
      else if (worst === 'head') show(headAdvice(headAxis, headEma[headAxis], mirrored), pct)
      else if (worst !== null) show(adviceFor(worst, ref, liveN, mirrored), pct)
      else show('좋아요! 셔터 버튼을 눌러 찍어 보세요', 100)
    }

    function show(text, pct) {
      setMessage(text); setScore(pct)
    }
    raf = requestAnimationFrame(loop)
    return () => { stopped = true; cancelAnimationFrame(raf) }
  }, [screen, facing])

  // 5) 촬영(셔터 버튼): 오버레이 없이 카메라 원본만, 화면에 보이던 9:16 틀·방향 그대로 저장
  function capture() {
    const video = videoRef.current
    const r = cropRect(video.videoWidth, video.videoHeight)
    const c = document.createElement('canvas')
    c.width = Math.round(r.w); c.height = Math.round(r.h)
    const ctx = c.getContext('2d')
    if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1) } // 앞 카메라는 거울 방향
    ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height)
    originalCapture.current = { image: ctx.getImageData(0, 0, c.width, c.height), canvas: c }
    setMatchedCapture(null) // 촬영 직후엔 원본만 (색감 분석 안 함)
    stopCamera()
    setScreen('captured')
  }

  // 6) 결과 화면: 원본은 왼쪽에 고정해서 한 번만 그림
  useEffect(() => {
    if (screen !== 'captured' || !originalCapture.current) return
    putImage(originalRef.current, originalCapture.current.image)
  }, [screen])

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
  const borderColor = score >= 100 ? '#22c55e' : score >= 60 ? '#eab308' : '#ef4444'

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
        <section className="stage" style={{ borderColor }}>
          {/* 9:16 촬영 틀: 카메라·참고 사진 모두 이 틀에 꽉 채움(가운데 자르기) → 끝과 끝이 일치 */}
          <div className="camera">
            <video ref={videoRef} playsInline muted className={facing === 'user' ? 'mirrored' : ''} />
            {/* 흐림·투명도는 참고 사진에만 적용 (카메라·관절점은 선명하게) */}
            <img className="ref-overlay" src={refUrl} alt="" style={{ opacity: refOpacity }} />
            {showGrid && <div className="grid" />}
            <canvas ref={canvasRef} />
          </div>
          <div className="score">{score}%</div>
          <div className="legend">
            <span><i className="dot ref" />참고 사진 기준 위치</span>
            <span><i className="dot ok" />초록색: 기준 위치에 가까움</span>
            <span><i className="dot bad" />빨간색: 위치를 조정해 보세요</span>
          </div>
          <div className="message">{message || '준비 중…'}</div>
          <div className="controls">
            <div className="sliders">
              <label className="size">
                사진 투명도 {Math.round((1 - refOpacity) * 100)}%
                <input type="range" min="0" max="100" step="5" value={Math.round((1 - refOpacity) * 100)}
                  onChange={(e) => setRefOpacity(1 - Number(e.target.value) / 100)} />
              </label>
            </div>
            <div className="actions">
              <button onClick={() => setShowGrid((g) => !g)}>{showGrid ? '격자 끄기' : '격자 켜기'}</button>
              {canSwitch && <button onClick={switchCamera}>{facing === 'user' ? '뒤 카메라' : '앞 카메라'}</button>}
              <button className="shutter" onClick={capture} aria-label="촬영" />
              <button onClick={() => { stopCamera(); setScreen('upload') }}>그만하기</button>
            </div>
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
            {matchedCapture && <button onClick={() => setMatchedCapture(null)}>보정 전으로</button>}
            <button className="primary" onClick={save}>저장</button>
            <button onClick={startCoaching}>다시 찍기</button>
          </div>
        </section>
      )}
    </div>
  )
}

function putImage(canvas, image) {
  canvas.width = image.width; canvas.height = image.height
  canvas.getContext('2d').putImageData(image, 0, 0)
}

// 화면에 그릴 점: 얼굴(코·눈·귀)은 서로 가까워서 작게
const DRAWN = [...HEAD_PTS, ...TARGETS]
const isHead = (j) => HEAD_PTS.includes(j)

// 기준점: 흰 테두리 동그라미 (중립색)
function drawRefPoints(ctx, pts) {
  for (const j of DRAWN) {
    if (pts[j].v < 0.5) continue
    ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, isHead(j) ? 6 : 11, 0, Math.PI * 2)
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke()
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke()
  }
}

// 내 관절점: 초록(맞음) / 빨강(조정 필요) / 회색(판단 보류). 기준점 안에 쏙 들어가는 크기
function drawLivePoints(ctx, pts, colorOf) {
  for (const j of DRAWN) {
    if (pts[j].v < 0.5) continue
    ctx.beginPath(); ctx.arc(pts[j].x, pts[j].y, isHead(j) ? 3.5 : 7, 0, Math.PI * 2)
    ctx.fillStyle = colorOf(j); ctx.fill()
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke()
  }
}
