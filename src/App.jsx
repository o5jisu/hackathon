import { useEffect, useRef, useState } from 'react'
import {
  createLandmarkers, toPixels, toFrame, frameRect, mirror, bodyFrame, normalize, compare, adviceFor,
  TARGETS, HEAD_PTS, BONES, compareHead, headAdvice, MATCH_T, statsOf, matchColor, blendImages, getSegmenter, skinMaskOf, toAnalysisCanvas, smoothPoints,
} from './pose'
import { NO_FILM, hasFilm, applyFilm } from './film'
import { NO_ADJUST, hasAdjust, applyAdjust } from './adjust'
import { POSE_RECOMMEND_ENABLED } from './pose_recommend/config'
import PoseLibrary from './pose_recommend/PoseLibrary'
import './App.css'

const NO_ALIGN = { scale: 1, dx: 0, dy: 0 } // 참고 사진 처음 상태: 가운데에 원래 비율로 가장 크게
const MIN_SCALE = 0.3, MAX_SCALE = 2
const GOOD_PCT = 90 // 이 점수 이상이면 "거의 맞음": 찍어도 좋다고 안내 (사람이 100%를 맞추기는 어려움)
const TIP_HOLD_MS = 1500 // 안내 문장을 바꾸기 전 최소 유지 시간
const WORST_KEEP = 0.7 // 안내 중인 관절이 가장 많이 틀린 곳의 70% 이상 틀려 있으면 계속 그 관절을 안내
const ANALYSIS_MAX = 960 // 포즈 인식에 넣는 카메라 화면의 긴 변 (촬영 사진은 원래 해상도 그대로)
const PREVIEW_MAX = 1440 // 결과 화면 미리보기의 긴 변. 슬라이더는 이 크기로 빠르게 계산하고, 저장할 때만 원본 크기로 다시 계산

export default function App() {
  const [screen, setScreen] = useState('upload') // upload | coaching | captured | library(포즈 라이브러리)
  const [status, setStatus] = useState('AI 모델을 불러오는 중…')
  const [ready, setReady] = useState(false)
  const [refUrl, setRefUrl] = useState(null)
  const [message, setMessage] = useState('')
  const [score, setScore] = useState(0)
  const [matchedCapture, setMatchedCapture] = useState(null) // 색감 적용 버튼을 누른 뒤 계산한 결과
  const [colorMatchStrength, setColorMatchStrength] = useState(0.7)
  const [adjust, setAdjust] = useState(NO_ADJUST) // 직접 조정 (노출·밝기·대비·하이라이트·그림자·채도, 각 -1~1)
  const [keepOriginal, setKeepOriginal] = useState(false) // 저장할 사진: true면 원본, false면 보정본(보정이 있을 때)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false) // 원래 해상도로 보정을 다시 계산해 저장하는 중
  const [film, setFilm] = useState(NO_FILM) // 필름 질감 효과 (그레인·소프트 포커스·비네팅·따뜻함, 각 0~1)
  const [facing, setFacing] = useState('user') // 'user' = 앞 카메라(거울 화면), 'environment' = 뒤 카메라
  const [canSwitch, setCanSwitch] = useState(false) // 카메라가 2개 이상일 때만 전환 버튼 표시
  const [showGrid, setShowGrid] = useState(true) // 3×3 구도 격자 (촬영 사진에는 안 들어감)
  const [showSettings, setShowSettings] = useState(false) // 촬영에 방해되지 않게 설정은 접어 둠
  const [refOpacity, setRefOpacity] = useState(0.35) // 참고 사진 불투명도 (화면엔 투명도 = 1 - 이 값으로 표시)
  const [refAspect, setRefAspect] = useState(1) // 참고 사진 가로/세로 비율 = 촬영 틀 비율
  const [videoAspect, setVideoAspect] = useState(9 / 16) // 카메라 영상 가로/세로 비율 (영상이 오면 실제 값으로 바뀜)
  const [align, setAlign] = useState(NO_ALIGN) // 참고 사진 틀 크기·위치 (끌기·두 손가락으로 조절)
  const [cropToRef, setCropToRef] = useState(true) // 촬영 사진을 참고 사진 틀에 맞춰 자를지
  const [upperBody, setUpperBody] = useState(false) // 상반신 사진이면 업로드 화면에 안내
  const [stream, setStream] = useState(null) // 켜져 있는 카메라 영상

  const models = useRef(null)
  const refImg = useRef(null)
  const refPts = useRef(null) // 참고 포즈 (참고 사진 픽셀 좌표 = 틀 좌표) → 화면에 기준점 그릴 때
  const refN = useRef(null) // 참고 포즈 (몸통 기준 상대 좌표) → 판정할 때
  const refMode = useRef('full') // 참고 사진이 전신('full')인지 상반신('upper')인지. 카메라도 같은 방식으로 맞춤
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

  // 2) 참고 사진 업로드 → 포즈 분석 (포즈 라이브러리에서 고른 사진도 같은 함수로 들어옴)
  function onUpload(e) {
    const file = e.target.files?.[0]
    if (file) loadReference(file)
  }

  async function loadReference(file) {
    if (!models.current) return setStatus('AI 모델을 아직 불러오는 중이에요. 잠시 후 다시 골라 주세요.')
    if (refUrl) URL.revokeObjectURL(refUrl)
    setStatus('참고 사진의 포즈를 분석하는 중…')
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    await img.decode()
    const res = models.current.image.detect(toAnalysisCanvas(img))
    const lms = res.landmarks?.[0]
    const pts = lms && toPixels(lms, img.naturalWidth, img.naturalHeight)
    const f = pts && bodyFrame(pts) // 골반이 안 보이면 상반신 모드로
    if (!f) {
      setStatus('사람의 두 어깨가 잘 보이는 사진을 골라 주세요.')
      setRefUrl(null); refN.current = null
      return
    }
    refImg.current = img
    refPts.current = pts
    refN.current = normalize(pts, f)
    refMode.current = f.mode
    setUpperBody(f.mode === 'upper')
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
      // 사진 화질을 위해 카메라가 낼 수 있는 가장 큰 해상도에 가깝게 요청 (ideal이라 못 내면 가능한 값으로 켜짐)
      video: { facingMode: mode, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } },
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
    let small = null // 포즈 인식용으로 작게 줄인 카메라 화면 (고해상도 영상을 그대로 넣으면 폰에서 느려짐)
    let lastWorst = null // 지금 안내 중인 관절 (비슷하게 틀린 관절끼리 안내가 번갈아 바뀌지 않게)
    let shownText = null, shownAt = 0 // 화면에 띄운 안내와 띄운 시각 (최소 TIP_HOLD_MS 동안 유지)

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

      // 인식은 긴 변 ANALYSIS_MAX의 사본으로 (좌표는 0~1 비율이라 크기가 달라도 그대로 씀)
      let source = video
      const k = ANALYSIS_MAX / Math.max(W, H)
      if (k < 1) {
        small ??= document.createElement('canvas')
        const sw = Math.round(W * k), sh = Math.round(H * k)
        if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh }
        small.getContext('2d').drawImage(video, 0, 0, sw, sh)
        source = small
      }
      let res
      try { res = models.current.video.detectForVideo(source, now) }
      catch (e) { show('포즈 분석 오류: ' + e.message, 0); return } // 폰에서 원인을 바로 볼 수 있게 화면에 표시
      const lms = res.landmarks?.[0]
      if (!lms) { smoothed = null; show('화면 안으로 들어와 주세요', 0); return }

      // 앞 카메라 화면은 거울처럼 보이므로 좌표도 뒤집음. 흔들림 줄이기는 카메라 화면 좌표(0~1)에서 먼저 하고,
      // 그다음 틀 좌표로 바꿈 → 사진 크기·위치를 바꾸는 중에도 관절점이 끌려가지 않음
      const cam = toPixels(mirrored ? mirror(lms, 1) : lms, 1, 1) // 카메라 화면 밖 관절은 안 보이는 것으로
      smoothed = smoothPoints(smoothed, cam)
      const live = toFrame(smoothed, r, fw, fh)
      const f = bodyFrame(live, refMode.current) // 참고 사진과 같은 방식(전신/상반신)으로
      if (!f) {
        show(refMode.current === 'upper' ? '두 어깨가 화면에 보이도록 서 주세요' : '상체가 화면에 보이도록 한 걸음 물러나 주세요', 0)
        return
      }
      const liveN = normalize(live, f)
      const ref = refN.current

      // 판정은 몸통 기준 정규화 좌표로 (거리·몸 크기 차이 무시) + 흔들림 줄이기(최근 값 가중 평균)
      const dist = compare(ref, liveN)
      const state = {}
      // hidden = 판단 보류(안 보이는 관절), outside = 그중 카메라 화면 밖으로 나간 관절 (v가 0)
      let ok = 0, total = 0, worst = null, worstD = 0, hidden = 0, outside = 0
      const badD = {} // 틀린 항목별 벗어난 정도
      for (const j of TARGETS) {
        if (!(j in dist)) continue
        total++
        if (dist[j] === null) { state[j] = 'unknown'; hidden++; if (live[j].v === 0) outside++; continue }
        // dist는 허용 범위 대비 비율 (팔다리: 뼈 각도 30°, 몸통: 위치 15%). 1 미만이면 맞음
        ema[j] = ema[j] === undefined ? dist[j] : ema[j] * 0.6 + dist[j] * 0.4
        if (ema[j] < 1) { state[j] = 'ok'; ok++ }
        else {
          state[j] = 'bad'
          // 허용 범위 대비 얼마나 벗어났는지로 "가장 많이 틀린 곳"을 고름 (머리와 같은 척도로 맞춤)
          const d = ema[j] * MATCH_T
          badD[j] = d
          if (d > worstD) { worstD = d; worst = j }
        }
      }

      // 머리: 목 기준 코·입 위치 비교 (숙이기·들기·돌리기·기울이기). err가 1 미만이면 맞음
      const head = compareHead(ref, liveN)
      if (head !== undefined) {
        total++
        let headState = 'unknown'
        if (head === null) { hidden++; if (live[0].v === 0) outside++ }
        else {
          for (const k of ['dx', 'dy', 'err']) {
            headEma[k] = headEma[k] === undefined ? head[k] : headEma[k] * 0.6 + head[k] * 0.4
          }
          if (headEma.err < 1) { headState = 'ok'; ok++ }
          else {
            headState = 'bad'
            // 팔다리 거리(MATCH_T 기준)와 같은 척도로 바꿔서 "가장 많이 틀린 곳"을 고름
            badD.head = headEma.err * MATCH_T
            if (badD.head > worstD) { worstD = badD.head; worst = 'head' }
          }
        }
        for (const j of [...HEAD_PTS, MOUTH]) state[j] = headState
      }
      // 안내 중인 관절이 아직 틀렸고 가장 많이 틀린 곳과 차이가 크지 않으면 그대로 안내 (번갈아 바뀌는 것 방지)
      if (lastWorst !== null && badD[lastWorst] !== undefined && badD[lastWorst] >= worstD * WORST_KEEP) worst = lastWorst
      lastWorst = worst
      // 점수는 실제로 판정한 항목(맞음+틀림)만으로 계산. 가려져서 판단 못 한 관절 때문에 100%가 막히지 않게
      const judged = total - hidden
      const pct = judged ? Math.round((ok / judged) * 100) : 0
      drawLiveSkeleton(ctx, withMouth(live.map(onScreen)), (j) => state[j], judged > 0 && pct >= GOOD_PCT)
      // 다음에 고칠 한 가지: 가장 많이 틀린 곳 → 없으면 화면 밖으로 나간 관절 안내 (가려진 관절은 그냥 넘어감)
      const tip = worst === 'head' ? headAdvice(headEma, mirrored)
        : worst !== null ? adviceFor(worst, ref, liveN, mirrored)
        : outside > 0 ? '전신이 화면에 나오도록 한 걸음 물러나 보세요' : null
      if (total === 0) show('참고 사진에 팔다리가 잘 보이지 않아요', 0)
      else if (judged === 0) show('관절이 잘 보이도록 카메라 앞에 서 주세요', 0)
      else if (!tip) show('좋아요! 셔터 버튼을 눌러 찍어 보세요', 100)
      else if (pct >= GOOD_PCT) show(`거의 맞았어요! ${tip}`, pct)
      else show(tip, pct)
    }

    // 점수는 매번 바꾸고, 안내 문장은 한 번 띄우면 최소 TIP_HOLD_MS 동안 유지 (멀리서 읽을 시간을 줌)
    function show(text, pct) {
      setScore(pct)
      const t = performance.now()
      if (text === shownText || t - shownAt < TIP_HOLD_MS) return
      shownText = text; shownAt = t
      setMessage(text)
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
    resetEdits() // 새 사진에는 이전 사진의 보정(색감·직접 조정·필름)을 남기지 않음
    selectShot(true) // 기본: 참고 사진에 맞춰 자른 사진
    setShowSettings(false)
    stopCamera()
    setScreen('captured')
  }

  // 자른 사진 / 전체 사진 중 하나를 원본으로 정함. 원본이 바뀌면 색감 보정은 처음부터 (촬영 직후엔 원본만)
  // canvas = 원래 해상도(저장용), preview = 긴 변 PREVIEW_MAX로 줄인 사본(화면·슬라이더용)
  function selectShot(crop) {
    const c = crop ? shots.current.crop : shots.current.full
    const k = Math.min(1, PREVIEW_MAX / Math.max(c.width, c.height))
    const pv = document.createElement('canvas')
    pv.width = Math.max(1, Math.round(c.width * k)); pv.height = Math.max(1, Math.round(c.height * k))
    const pctx = pv.getContext('2d')
    pctx.drawImage(c, 0, 0, pv.width, pv.height)
    originalCapture.current = { canvas: c, preview: pctx.getImageData(0, 0, pv.width, pv.height) }
    setCropToRef(crop)
    setMatchedCapture(null)
  }

  // 6) 결과 화면: 원본은 왼쪽에 고정해서 한 번만 그림 (자르기를 켜고 끄면 다시 그림)
  useEffect(() => {
    if (screen !== 'captured' || !originalCapture.current) return
    putImage(originalRef.current, originalCapture.current.preview)
  }, [screen, cropToRef])

  // '참고 사진 색감 적용' 버튼을 눌렀을 때만 색감 계산 (기본 방식: Lab Reinhard)
  // 사람 전체(얼굴·피부·머리카락·옷)를 찾아 색 통계에서 빼고 보정도 0% → 배경만 참고 사진 분위기로 (분리 모델은 처음 누를 때만 받음)
  async function applyMatch() {
    setBusy(true)
    await new Promise((r) => setTimeout(r, 30)) // 화면에 '계산 중'이 먼저 보이도록 한 박자 쉬고 계산
    const { preview, canvas } = originalCapture.current
    const seg = await getSegmenter() // 못 받으면 null → 보호 없이 보정
    let shotMask = null, refMask = null
    try { shotMask = skinMaskOf(seg, canvas); refMask = skinMaskOf(seg, refImg.current) } catch { /* 보호 없이 진행 */ }
    // 색 통계·보호 지도는 사진 크기와 무관(비율로 읽음) → 저장할 때 원본 크기에도 같은 값으로 다시 적용
    const src = statsOf(canvas, shotMask), ref = statsOf(refImg.current, refMask)
    setMatchedCapture({ src, ref, mask: shotMask, preview: matchColor(preview, src, ref, shotMask) })
    setKeepOriginal(false)
    setBusy(false)
  }

  // 모든 보정(색감·직접 조정·필름)을 지우고 원본으로
  function resetEdits() {
    setMatchedCapture(null); setColorMatchStrength(0.7); setAdjust(NO_ADJUST); setFilm(NO_FILM); setKeepOriginal(false)
  }

  // 보정 미리보기(previewCapture): 슬라이더가 바뀔 때마다 원본에서 새로 만들어 오른쪽에만 그림
  // 원본 → 참고 사진 색감(강도만큼) → 직접 조정 → 필름 효과. 원본은 그대로 둠
  const hasEdits = matchedCapture !== null || hasAdjust(adjust) || hasFilm(film)
  const savingEdited = hasEdits && !keepOriginal
  useEffect(() => {
    if (!hasEdits || !previewRef.current) return
    putImage(previewRef.current, renderEdits(originalCapture.current.preview, matchedCapture?.preview, colorMatchStrength, adjust, film))
  }, [hasEdits, matchedCapture, colorMatchStrength, adjust, film, cropToRef])

  // 저장: 미리보기가 아니라 원래 해상도 사진에 같은 보정을 다시 적용해서 내보냄 (큰 사진은 몇 초 걸릴 수 있음)
  async function save() {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 30)) // '저장 준비 중'이 먼저 보이도록
    try {
      const { canvas } = originalCapture.current
      let out = canvas
      if (savingEdited) {
        const full = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
        const m = matchedCapture
        out = document.createElement('canvas')
        putImage(out, renderEdits(full, m && matchColor(full, m.src, m.ref, m.mask), colorMatchStrength, adjust, film))
      }
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.92))
      if (!blob) throw new Error('사진을 만들지 못했어요.')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = fileName(); a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch (e) {
      alert('저장하지 못했어요. 사진이 너무 크면 메모리가 부족할 수 있어요. (' + e.message + ')')
    } finally {
      setSaving(false)
    }
  }

  // ── 화면 ──
  const scoreColor = score >= GOOD_PCT ? '#22c55e' : score >= 60 ? '#facc15' : '#fff'
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
          {refUrl && upperBody && <p className="hint">상반신 사진이라 어깨·팔·얼굴만 비교해요.</p>}
          {status && <p className="status">{status}</p>}
          <button className="primary" disabled={!ready || !refN.current} onClick={startCoaching}>
            코칭 시작
          </button>
          <p className="hint">폰을 세워 두고 2~3m 떨어져 서 주세요.</p>
          {POSE_RECOMMEND_ENABLED && (
            <button onClick={() => setScreen('library')}>📚 포즈 라이브러리 · 배경에 맞는 포즈 추천</button>
          )}
        </section>
      )}

      {/* 포즈 추천 기능 (src/pose_recommend). 고른 포즈 사진은 참고 사진으로 불러와 기존 오버레이·판정을 그대로 씀 */}
      {POSE_RECOMMEND_ENABLED && screen === 'library' && (
        <PoseLibrary
          detect={(canvas) => models.current?.image.detect(canvas).landmarks?.[0]?.map((l) => [l.x, l.y]) ?? null}
          onBack={() => setScreen('upload')}
          onUsePose={(pose) => {
            setScreen('upload')
            loadReference(pose.image).catch(() => setStatus('포즈 사진을 불러오지 못했어요.'))
          }}
        />
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

          {/* 왼쪽 위: 나가기 */}
          <button className="round glass back" onClick={() => { stopCamera(); setShowSettings(false); setScreen('upload') }} aria-label="나가기">
            ←
          </button>

          {/* 위: 점수 + 안내 (최대 2줄) */}
          <div className="topbar">
            <b style={{ color: scoreColor }}>{score}%</b>
            <span>{message || '준비 중…'}</span>
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
              </div>
              <div className="legend">
                <span><i className="dot ref" />흰 점선: 참고 사진 포즈</span>
                <span><i className="dot ok" />초록색: 기준 위치에 가까움 (90% 이상 맞으면 나머지 뼈대도 초록)</span>
                <span><i className="dot bad" />빨간색: 위치를 조정해 보세요</span>
              </div>
            </div>
          )}

          {/* 아래: 설정 · 셔터, 오른쪽 구석에 카메라 전환 */}
          <div className="bottombar">
            <button className="round glass" onClick={() => setShowSettings((v) => !v)} aria-label="설정">
              {showSettings ? '✕' : '⚙'}
            </button>
            <button className="shutter" onClick={capture} aria-label="촬영" />
            {canSwitch && (
              <button className="round glass flip" onClick={switchCamera}
                aria-label={facing === 'user' ? '뒤 카메라로 전환' : '앞 카메라로 전환'}>
                ⟲
              </button>
            )}
          </div>
        </section>
      )}

      {screen === 'captured' && (
        <section className="panel wide">
          <h2>촬영 완료</h2>
          {/* 원본(왼쪽 고정) · 보정본(오른쪽). 누르면 저장할 사진으로 선택 */}
          <div className={hasEdits ? 'compare' : 'compare single'}>
            <figure className={!savingEdited ? 'picked' : ''} onClick={() => setKeepOriginal(true)}>
              <canvas ref={originalRef} className="result" />
              <figcaption>원본 {!savingEdited && '✓'}</figcaption>
            </figure>
            {hasEdits && (
              <figure className={savingEdited ? 'picked' : ''} onClick={() => setKeepOriginal(false)}>
                <canvas ref={previewRef} className="result" />
                <figcaption>
                  보정본 {savingEdited && '✓'}
                  <small>
                    {[matchedCapture && `색감 ${Math.round(colorMatchStrength * 100)}%`, hasAdjust(adjust) && '직접 조정', hasFilm(film) && '필름 효과']
                      .filter(Boolean).join(' + ')}
                  </small>
                </figcaption>
              </figure>
            )}
          </div>
          {hasEdits && (
            <div className="methods" role="radiogroup" aria-label="저장할 사진">
              <button role="radio" aria-checked={!savingEdited} className={!savingEdited ? 'on' : ''} onClick={() => setKeepOriginal(true)}>원본으로 저장</button>
              <button role="radio" aria-checked={savingEdited} className={savingEdited ? 'on' : ''} onClick={() => setKeepOriginal(false)}>보정본으로 저장</button>
            </div>
          )}

          {/* 참고 사진 색감: 사람(얼굴·피부·머리카락·옷)은 그대로, 배경만 */}
          <fieldset className="film">
            <legend>참고 사진 색감</legend>
            <p className="hint left">얼굴·피부·머리카락·옷은 원래 색 그대로 두고 배경 분위기만 바꿔요.</p>
            {!matchedCapture ? (
              <button className="primary" disabled={busy} onClick={applyMatch}>
                {busy ? '색감 계산 중…' : '참고 사진 색감 적용'}
              </button>
            ) : (
              <>
                <label className="slider">
                  강도 {Math.round(colorMatchStrength * 100)}%
                  <input type="range" min="0" max="1" step="0.05" value={colorMatchStrength}
                    onChange={(e) => setColorMatchStrength(Number(e.target.value))} />
                </label>
                <button onClick={() => setMatchedCapture(null)}>색감 끄기</button>
              </>
            )}
          </fieldset>

          {/* 직접 조정: 카메라·사진 앱처럼 (-100 ~ +100) */}
          <fieldset className="film">
            <legend>직접 조정</legend>
            {[
              ['exposure', '노출'], ['brightness', '밝기'], ['contrast', '대비'],
              ['highlights', '하이라이트'], ['shadows', '그림자'], ['saturation', '채도'],
            ].map(([key, label]) => (
              <label key={key} className="slider">
                {label} {adjust[key] > 0 ? '+' : ''}{Math.round(adjust[key] * 100)}
                <input type="range" min="-1" max="1" step="0.05" value={adjust[key]}
                  onChange={(e) => { setAdjust((a) => ({ ...a, [key]: Number(e.target.value) })); setKeepOriginal(false) }} />
              </label>
            ))}
            {hasAdjust(adjust) && <button onClick={() => setAdjust(NO_ADJUST)}>조정 초기화</button>}
          </fieldset>
          {/* 필름 질감: 보정 사진(오른쪽)에만 적용, 색감 적용 없이도 쓸 수 있음 */}
          <fieldset className="film">
            <legend>필름 효과</legend>
            {[
              ['grain', '그레인 (필름 알갱이)'],
              ['soft', '소프트 포커스 (부드럽게)'],
              ['vignette', '비네팅 (가장자리 어둡게)'],
              ['warmth', '따뜻함 (플래시 느낌)'],
            ].map(([key, label]) => (
              <label key={key} className="slider">
                {label} {Math.round(film[key] * 100)}%
                <input type="range" min="0" max="1" step="0.05" value={film[key]}
                  onChange={(e) => { setFilm((f) => ({ ...f, [key]: Number(e.target.value) })); setKeepOriginal(false) }} />
              </label>
            ))}
            {hasFilm(film) && <button onClick={() => setFilm(NO_FILM)}>필름 효과 끄기</button>}
          </fieldset>
          <div className="actions">
            <button onClick={() => selectShot(!cropToRef)}>
              {cropToRef ? '자르기 전 전체 사진 보기' : '참고 사진에 맞춰 자르기'}
            </button>
            {hasEdits && <button onClick={resetEdits}>원본으로 되돌리기</button>}
            <button className="primary" disabled={saving} onClick={save}>{saving ? '저장 준비 중…' : '저장'}</button>
            <button onClick={startCoaching}>다시 찍기</button>
          </div>
        </section>
      )}
    </div>
  )
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// 보정 순서: 원본 → 참고 사진 색감(강도 s만큼) → 직접 조정 → 필름 효과. 원본(image)은 바꾸지 않음
// matched = image와 같은 크기의 100% 색감 결과 (없으면 색감 생략). 미리보기와 저장(원래 해상도)에 같이 씀
function renderEdits(image, matched, s, adjust, film) {
  let img = image
  if (matched) img = blendImages(img, matched, s)
  if (hasAdjust(adjust)) img = applyAdjust(img, adjust)
  if (hasFilm(film)) img = applyFilm(img, film)
  return img
}

// 저장 파일 이름: Motif_2026-10-31_143205.jpg (여러 번 저장해도 이름이 겹치지 않게 날짜·시각)
function fileName() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0')
  return `Motif_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`
}

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
// 어깨·골반도 판정하므로 몸통 선도 초록·빨강으로 바뀜. 판정 전(흰색)인 선은 점수가 GOOD_PCT(90%) 이상일 때 초록
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
