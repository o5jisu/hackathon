import { useEffect, useRef, useState } from 'react'
import {
  createLandmarkers, toPixels, toFrame, frameRect, mirror, bodyFrame, normalize, compare, adviceFor,
  TARGETS, HEAD_PTS, BONES, compareHead, headAdvice, MATCH_T, REF_VIS, statsOf, matchColor, blendImages, getSegmenter, skinMaskOf, toAnalysisCanvas, smoothPoints,
} from './pose'
import { NO_FILM, hasFilm, applyFilm } from './film'
import { NO_ADJUST, hasAdjust, applyAdjust } from './adjust'
import { POSE_RECOMMEND_ENABLED } from './pose_recommend/config'
import PoseLibrary from './pose_recommend/PoseLibrary'
import Home from './screens/Home'
import Reference from './screens/Reference'
import TabBar from './screens/TabBar'
import { listPoses } from './pose_recommend'
import './App.css'

const NO_ALIGN = { scale: 1, dx: 0, dy: 0 } // 참고 사진 처음 상태: 가운데에 원래 비율로 가장 크게
const MIN_SCALE = 0.3, MAX_SCALE = 2
const GOOD_PCT = 90 // 이 점수 이상이면 "거의 맞음": 찍어도 좋다고 안내 (사람이 100%를 맞추기는 어려움)
const TIP_HOLD_MS = 1500 // 안내 문장을 바꾸기 전 최소 유지 시간
const WORST_KEEP = 0.7 // 안내 중인 관절이 가장 많이 틀린 곳의 70% 이상 틀려 있으면 계속 그 관절을 안내
const ANALYSIS_MAX = 960 // 포즈 인식에 넣는 카메라 화면의 긴 변 (촬영 사진은 원래 해상도 그대로)
const SMALL_BACKGROUND = 0.25 // 배경이 사진의 25%보다 적으면 "바뀌는 곳이 적어요" 안내
const SIMILAR_COLOR = 6 // 두 사진의 Lab 평균 색 차이가 이보다 작으면 "원래 비슷해요" 안내
const PREVIEW_MAX = 1440 // 결과 화면 미리보기의 긴 변. 슬라이더는 이 크기로 빠르게 계산하고, 저장할 때만 원본 크기로 다시 계산

export default function App() {
  // 화면: home(01) → reference(02 참고 사진 확인) → coaching(03) → captured(06 편집). library = 포즈 라이브러리
  const [screen, setScreen] = useState('home')
  const [ready, setReady] = useState(false) // 포즈 인식 모델 준비 완료
  const [modelError, setModelError] = useState('') // 모델 받기 실패 (로딩 중 표시와 다른 모양으로 보여 줌)
  const [analyzing, setAnalyzing] = useState(false) // 참고 사진 포즈를 읽는 중
  const [error, setError] = useState('') // 지금 화면에 보여 줄 오류 문장 (사진 인식 실패, 카메라 실패 등)
  const [refUrl, setRefUrl] = useState(null)
  const [refInfo, setRefInfo] = useState({ mode: 'full', count: 0 }) // 전신/상반신, 비교할 관절 수
  const [message, setMessage] = useState('')
  const [tipPart, setTipPart] = useState(null) // 안내 중인 몸 부위 { kind, side } → 몸 그림에 표시
  const [score, setScore] = useState(0)
  const [moveMode, setMoveMode] = useState(false) // 참고 사진 틀 옮기기 모드 (평소엔 잠가서 실수로 안 움직이게)
  const [matchedCapture, setMatchedCapture] = useState(null) // 색감 적용 버튼을 누른 뒤 계산한 결과
  const [colorMatchStrength, setColorMatchStrength] = useState(0.7)
  const [adjust, setAdjust] = useState(NO_ADJUST) // 직접 조정 (노출·밝기·대비·하이라이트·그림자·채도, 각 -1~1)
  const [view, setView] = useState('edited') // 편집 화면에 보여 줄 사진: ref(참고 사진) | original | edited
  const [holding, setHolding] = useState(false) // 사진을 누르고 있는 동안 원본 보기
  const [tab, setTab] = useState('color') // 편집 탭: color | adjust | film
  const [adjustKey, setAdjustKey] = useState('exposure') // 조정 탭에서 고른 항목
  const [filmKey, setFilmKey] = useState('grain') // 필름 탭에서 고른 항목
  const [matchNote, setMatchNote] = useState('') // 색감 적용 결과 안내 (변화가 작은 이유, 오류)
  const [homePhotos, setHomePhotos] = useState([]) // 첫 화면 폴라로이드에 보여 줄 라이브러리 사진 (최근 3장)
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
  const originalCapture = useRef(null) // { canvas, preview } 편집 중 바꾸지 않는 원본 (full 또는 crop)

  // 1) 앱 시작 시 AI 모델 로드
  useEffect(() => {
    createLandmarkers()
      .then((m) => { models.current = m; setReady(true) })
      .catch((e) => setModelError(e.message))
  }, [])

  // 첫 화면에 올 때마다 라이브러리의 최근 사진 3장을 폴라로이드용으로 불러옴 (실패하면 빈 액자)
  useEffect(() => {
    if (screen !== 'home' || !POSE_RECOMMEND_ENABLED) return
    let urls = [], alive = true
    listPoses().then((ps) => {
      if (!alive) return
      urls = ps.slice(-3).reverse().map((p) => URL.createObjectURL(p.image))
      setHomePhotos(urls)
    }).catch(() => {})
    return () => { alive = false; urls.forEach((u) => URL.revokeObjectURL(u)) }
  }, [screen])

  // 2) 참고 사진 → 포즈 분석 → 성공하면 02 참고 사진 확인 화면으로 (포즈 라이브러리에서 고른 사진도 같은 함수로 들어옴)
  // 실패하면 이전 참고 사진은 그대로 두고 지금 화면에 이유를 보여 줌
  async function loadReference(file) {
    if (!models.current) return setError('포즈 인식 모델을 아직 준비하는 중이에요. 잠시 후 다시 골라 주세요.')
    setError('')
    setAnalyzing(true)
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      const res = models.current.image.detect(toAnalysisCanvas(img))
      const lms = res.landmarks?.[0]
      const pts = lms && toPixels(lms, img.naturalWidth, img.naturalHeight)
      const f = pts && bodyFrame(pts) // 골반이 안 보이면 상반신 모드로
      if (!f) {
        URL.revokeObjectURL(url)
        setError(lms
          ? '두 어깨가 잘 보이지 않아요. 상반신이나 전신이 정면에 가깝게 나온 사진을 골라 주세요.'
          : '사진에서 사람을 찾지 못했어요. 한 사람이 크게 나온 사진을 골라 주세요.')
        return
      }
      if (refUrl) URL.revokeObjectURL(refUrl)
      refImg.current = img
      refPts.current = pts
      refN.current = normalize(pts, f)
      refMode.current = f.mode
      // 판정에 실제로 쓰는 관절 수 (compare·compareHead와 같은 기준: 참고 사진에서 REF_VIS 이상 보이는 곳)
      const count = [...TARGETS, 0].filter((j) => pts[j].v >= REF_VIS && (f.mode === 'full' || j < 23)).length
      setRefInfo({ mode: f.mode, count })
      setRefAspect(img.naturalWidth / img.naturalHeight)
      setAlign(NO_ALIGN) // 새 사진은 원래 비율·가장 큰 크기로 시작
      setRefUrl(url)
      setScreen('reference')
    } catch {
      URL.revokeObjectURL(url)
      setError('사진을 열 수 없어요. 다른 사진(JPG·PNG)을 골라 주세요.')
    } finally {
      setAnalyzing(false)
    }
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
    setError('')
    setMoveMode(false)
    try {
      await openCamera(facing)
    } catch {
      setError('카메라를 켤 수 없어요. 카메라 권한을 허용했는지, https 주소로 접속했는지 확인해 주세요.')
      setScreen('reference')
    }
  }

  // 코칭을 끝내고 참고 사진 확인 화면으로
  function leaveCoaching() {
    stopCamera(); setShowSettings(false); setMoveMode(false); setScreen('reference')
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
      // 몸 그림에 표시할 부위. 왼쪽/오른쪽은 "화면에서 보이는 쪽" (몸 기준 이름은 안내 문장에 있음)
      const part = worst === 'head' ? { kind: 'head' }
        : worst !== null ? { kind: PART_KIND[worst], side: liveN[worst].x < 0 ? 'l' : 'r' } : null
      if (total === 0) show('참고 사진에 팔다리가 잘 보이지 않아요', 0)
      else if (judged === 0) show('관절이 잘 보이도록 카메라 앞에 서 주세요', 0)
      else if (!tip) show('좋아요! 셔터 버튼을 눌러 찍어 보세요', 100)
      else if (pct >= GOOD_PCT) show(`거의 맞았어요! ${tip}`, pct, part)
      else show(tip, pct, part)
    }

    // 점수는 매번 바꾸고, 안내 문장은 한 번 띄우면 최소 TIP_HOLD_MS 동안 유지 (멀리서 읽을 시간을 줌)
    function show(text, pct, part = null) {
      setScore(pct)
      const t = performance.now()
      if (text === shownText || t - shownAt < TIP_HOLD_MS) return
      shownText = text; shownAt = t
      setMessage(text); setTipPart(part)
    }
    raf = requestAnimationFrame(loop)
    return () => { stopped = true; cancelAnimationFrame(raf) }
  }, [screen, facing])

  // 참고 사진 틀 조절 (위치 조정 모드에서만): 한 손가락 = 끌어서 이동, 두 손가락 = 벌리거나 오므려 크기 조절
  function onPointerDown(e) {
    if (!moveMode) return
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
    setShowSettings(false); setMoveMode(false)
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
    originalCapture.current = { canvas: c, preview: pctx.getImageData(0, 0, pv.width, pv.height), crop }
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
  // 결과 아래에 이유를 알려 줌: 사람이 사진 대부분이거나 두 사진 색감이 비슷하면 변화가 작아서 "안 된 것"처럼 보이기 때문
  async function applyMatch() {
    setBusy(true); setMatchNote('')
    await new Promise((r) => setTimeout(r, 30)) // 화면에 '계산 중'이 먼저 보이도록 한 박자 쉬고 계산
    try {
      const { preview, canvas, crop } = originalCapture.current
      const seg = await getSegmenter() // 못 받으면 null → 보호 없이 보정
      let shotMask = null, refMask = null
      try { shotMask = skinMaskOf(seg, canvas); refMask = skinMaskOf(seg, refImg.current) } catch { /* 보호 없이 진행 */ }
      // 색 통계·보호 지도는 사진 크기와 무관(비율로 읽음) → 저장할 때 원본 크기에도 같은 값으로 다시 적용
      const src = statsOf(canvas, shotMask), ref = statsOf(refImg.current, refMask)
      setMatchedCapture({ src, ref, mask: shotMask, preview: matchColor(preview, src, ref, shotMask) })
      setView('edited')
      const background = shotMask ? 1 - shotMask.person.reduce((s, v) => s + v, 0) / shotMask.person.length : 1
      const colorGap = Math.hypot(...src.mean.map((m, c) => m - ref.mean[c])) // Lab 평균 색 차이
      setMatchNote(background < SMALL_BACKGROUND
        ? `사진의 ${Math.round((1 - background) * 100)}%가 사람이라 변화가 은은해요. 피부·머리색이 어색해지지 않게 사람에는 약하게만 입히거든요.${crop ? ' "전체 사진"으로 보면 더 잘 보여요.' : ''}`
        : colorGap < SIMILAR_COLOR ? '참고 사진과 색감이 원래 비슷해서 변화가 작아요.' : '')
    } catch (e) {
      setMatchNote('색감을 적용하지 못했어요. 다시 눌러 주세요. (' + e.message + ')')
    } finally {
      setBusy(false)
    }
  }

  // 전체 사진 ↔ 틀에 맞춤: 원본이 바뀌므로 색감을 켜 둔 상태였다면 새 원본에 다시 적용
  function toggleCrop() {
    const hadColor = matchedCapture !== null
    selectShot(!cropToRef)
    if (hadColor) applyMatch()
  }

  // 모든 보정(색감·직접 조정·필름)을 지우고 원본으로
  function resetEdits() {
    setMatchedCapture(null); setMatchNote(''); setColorMatchStrength(0.7); setAdjust(NO_ADJUST); setFilm(NO_FILM); setView('edited')
  }

  // 보정 미리보기: 슬라이더가 바뀔 때마다 원본(미리보기 크기)에서 새로 만들어 그림
  // 원본 → 참고 사진 색감(강도만큼) → 직접 조정 → 필름 효과. 원본은 그대로 둠
  const hasEdits = matchedCapture !== null || hasAdjust(adjust) || hasFilm(film)
  useEffect(() => {
    if (!hasEdits || !previewRef.current) return
    putImage(previewRef.current, renderEdits(originalCapture.current.preview, matchedCapture?.preview, colorMatchStrength, adjust, film))
  }, [hasEdits, matchedCapture, colorMatchStrength, adjust, film, cropToRef])

  // 저장: 미리보기가 아니라 원래 해상도 사진에 같은 보정을 다시 적용해서 내보냄 (큰 사진은 몇 초 걸릴 수 있음)
  // edited = true면 보정본, false면 원본을 저장
  async function save(edited) {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 30)) // '저장 준비 중'이 먼저 보이도록
    try {
      const { canvas } = originalCapture.current
      let out = canvas
      if (edited) {
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
  const good = score >= GOOD_PCT
  // 참고 사진 틀 위치 (카메라 상자 대비 %). 카메라 루프의 관절 좌표와 같은 frameRect 계산을 씀
  const fr = frameRect(refAspect, videoAspect, align)
  const frameStyle = { left: `${fr.x * 100}%`, top: `${fr.y * 100}%`, width: `${fr.w * 100}%`, height: `${fr.h * 100}%` }
  // 편집 화면에 실제로 보이는 사진: 누르고 있으면 원본, 보정이 없으면 '보정'도 원본
  const shown = holding ? 'original' : view === 'edited' && !hasEdits ? 'original' : view
  const saveEdited = hasEdits && view !== 'original' // 원본을 보고 있으면 원본을 저장
  const goHome = () => { setError(''); setScreen('home') }
  const tabbed = screen === 'home' || screen === 'library' // 아래 탭 바가 보이는 화면

  return (
    <div className={`app${tabbed ? ' with-tabbar' : ''}`}>
      {screen === 'home' && (
        <Home ready={ready} modelError={modelError} analyzing={analyzing} error={error}
          onPick={loadReference} photos={homePhotos} />
      )}

      {/* 포즈 추천 기능 (src/pose_recommend). 고른 포즈 사진은 참고 사진으로 불러와 기존 오버레이·판정을 그대로 씀 */}
      {POSE_RECOMMEND_ENABLED && screen === 'library' && (
        <PoseLibrary
          detect={(canvas) => models.current?.image.detect(canvas).landmarks?.[0]?.map((l) => [l.x, l.y]) ?? null}
          onBack={goHome}
          onUsePose={(pose) => {
            setScreen('home') // 인식에 실패하면 첫 화면에서 이유를 보여 줌, 성공하면 참고 사진 확인 화면으로
            loadReference(pose.image)
          }}
        />
      )}

      {screen === 'reference' && refPts.current && (
        <Reference url={refUrl} size={{ w: refImg.current.naturalWidth, h: refImg.current.naturalHeight }}
          pts={refPts.current} info={refInfo} analyzing={analyzing} error={error}
          onChange={loadReference} onStart={startCoaching} onBack={goHome} />
      )}

      {tabbed && (
        <TabBar active={screen === 'library' ? 'library' : 'shoot'} showLibrary={POSE_RECOMMEND_ENABLED}
          onSelect={(k) => { setError(''); setScreen(k === 'library' ? 'library' : 'home') }} />
      )}

      {screen === 'coaching' && (
        <section className="stage">
          {/* 카메라 상자 = 영상 비율 그대로(잘림 없음). 그 위의 참고 사진 틀 = 촬영 후 잘릴 영역 (위치 조정 모드에서만 끌기·두 손가락) */}
          <div className={`camera${moveMode ? ' moving' : ''}`} style={{ '--va': videoAspect }}
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

          <button className="round glass back" onClick={leaveCoaching} aria-label="나가기">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button className="round glass gear" onClick={() => setShowSettings((v) => !v)} aria-label={showSettings ? '설정 닫기' : '설정'} aria-expanded={showSettings}>
            {showSettings
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>}
          </button>

          {/* 위: 멀리서도 보이는 큰 점수 + 진행 막대(90% 지점 표시) */}
          <div className="hud" role="status" aria-label={`포즈 일치도 ${score}%`}>
            <div className="score" style={{ color: good ? 'var(--ok)' : '#fff' }}><b>{score}</b><span>%</span></div>
            <div className="meter">
              <i style={{ width: `${score}%`, background: good ? 'var(--ok)' : 'var(--fix)' }} />
              <span className="goal" style={{ left: `${GOOD_PCT}%` }} />
            </div>
          </div>

          {moveMode ? (
            <div className="tip move" role="status">
              <p>사진을 끌어 옮기고, 두 손가락으로 크기를 바꿔요</p>
              <button className="pill" onClick={() => setMoveMode(false)}>완료</button>
            </div>
          ) : (
            <div className="tip" aria-live="polite">
              <BodyHint part={tipPart} good={good} />
              <p>{message || '준비 중…'}</p>
            </div>
          )}

          {/* 설정: 평소엔 접어 두고 ⚙를 누를 때만 펼침 */}
          {showSettings && (
            <div className="settings">
              <label>
                참고 사진 투명도 {Math.round((1 - refOpacity) * 100)}%
                <input type="range" min="0" max="100" step="5" value={Math.round((1 - refOpacity) * 100)}
                  onChange={(e) => setRefOpacity(1 - Number(e.target.value) / 100)} />
              </label>
              <label>
                참고 사진 크기 {Math.round(align.scale * 100)}%
                <input type="range" min={MIN_SCALE} max={MAX_SCALE} step="0.05" value={align.scale}
                  onChange={(e) => setAlign((a) => ({ ...a, scale: Number(e.target.value) }))} />
              </label>
              <div className="row">
                <button onClick={() => { setMoveMode(true); setShowSettings(false) }}>위치 조정</button>
                <button onClick={() => setAlign(NO_ALIGN)}>원래 크기로</button>
                <button onClick={() => setShowGrid((g) => !g)}>{showGrid ? '격자 끄기' : '격자 켜기'}</button>
              </div>
            </div>
          )}

          {/* 아래: 범례(항상) · 셔터(가운데) · 카메라 전환(오른쪽) */}
          <div className="bottombar">
            <div className="legend">
              <span><i className="dot ref" />참고 포즈</span>
              <span><i className="dot ok" />맞음</span>
              <span><i className="dot fix" />고칠 곳</span>
            </div>
            <div className="controls">
              <span />
              <button className="shutter" onClick={capture} aria-label="촬영" />
              {canSwitch ? (
                <button className="round glass flip" onClick={switchCamera}
                  aria-label={facing === 'user' ? '뒤 카메라로 전환' : '앞 카메라로 전환'}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2" /><path d="M20 4v4h-4M4 20v-4h4" /></svg>
                </button>
              ) : <span />}
            </div>
          </div>
        </section>
      )}

      {screen === 'captured' && (
        <section className="page edit">
          <header className="bar-head">
            <button className="icon-btn" onClick={startCoaching} aria-label="다시 찍기">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <h1>다듬기</h1>
            <button className="text-btn" disabled={!hasEdits} onClick={resetEdits}>되돌리기</button>
          </header>

          {/* 사진은 위에 고정하고 남는 높이를 다 씀(좌우 끝까지). 누르고 있으면 원본 */}
          <div className="photo" onPointerDown={() => setHolding(true)} onPointerUp={() => setHolding(false)}
            onPointerLeave={() => setHolding(false)} onPointerCancel={() => setHolding(false)}
            onContextMenu={(e) => e.preventDefault()}>
            <canvas ref={originalRef} hidden={shown !== 'original'} />
            <canvas ref={previewRef} hidden={shown !== 'edited'} />
            {shown === 'ref' && <img src={refUrl} alt="참고 사진" draggable={false} />}
            {hasEdits && !holding && <span className="hold-chip">길게 누르면 원본</span>}
          </div>

          {/* 사진 바로 아래 한 줄: 비교 보기 · 자르기 (사진을 가리지 않게 밖으로 뺌) */}
          <div className="photo-bar">
            <div className="compare-toggle" role="radiogroup" aria-label="비교 보기">
              {[['ref', '레퍼런스'], ['original', '원본'], ['edited', '보정']].map(([k, label]) => (
                <button key={k} role="radio" aria-checked={view === k} className={view === k ? 'on' : ''}
                  onClick={() => setView(k)}>{label}</button>
              ))}
            </div>
            <button className="text-btn" disabled={busy} onClick={toggleCrop}>{cropToRef ? '전체 사진' : '틀에 맞춤'}</button>
          </div>

          <div className="tabs" role="tablist" aria-label="편집 도구">
            {[['color', '색감'], ['adjust', '조정'], ['film', '필름']].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
                {k === 'color' && matchedCapture && <i className="mark" aria-label="적용됨" />}
                {k === 'adjust' && hasAdjust(adjust) && <i className="mark" aria-label="적용됨" />}
                {k === 'film' && hasFilm(film) && <i className="mark" aria-label="적용됨" />}
              </button>
            ))}
          </div>

          <div className="tool" role="tabpanel">
            {tab === 'color' && (!matchedCapture ? (
              <div className="tool-row">
                <p className="hint left">참고 사진 분위기를 입혀요. 얼굴·피부는 자연스럽게 약하게만.</p>
                <button className="btn primary small" disabled={busy} onClick={applyMatch}>
                  {busy ? '계산 중…' : '색감 적용'}
                </button>
              </div>
            ) : (
              <ToolSlider label="색감 강도" value={`${Math.round(colorMatchStrength * 100)}%`}
                min="0" max="1" current={colorMatchStrength} onChange={setColorMatchStrength}
                resetLabel="끄기" onReset={() => { setMatchedCapture(null); setMatchNote('') }} />
            ))}
            {tab === 'color' && matchNote && <p className="hint left match-note" role="status">{matchNote}</p>}

            {tab === 'adjust' && (
              <>
                <div className="chips">
                  {ADJUST_ITEMS.map(([k, label]) => (
                    <button key={k} aria-pressed={adjustKey === k} className={adjustKey === k ? 'on' : ''} onClick={() => setAdjustKey(k)}>
                      {label}{adjust[k] !== 0 && ` ${adjust[k] > 0 ? '+' : ''}${Math.round(adjust[k] * 100)}`}
                    </button>
                  ))}
                </div>
                <ToolSlider label={ADJUST_ITEMS.find(([k]) => k === adjustKey)[1]}
                  value={`${adjust[adjustKey] > 0 ? '+' : ''}${Math.round(adjust[adjustKey] * 100)}`}
                  min="-1" max="1" current={adjust[adjustKey]} onChange={(v) => setAdjust((a) => ({ ...a, [adjustKey]: v }))}
                  resetLabel="초기화" onReset={hasAdjust(adjust) ? () => setAdjust(NO_ADJUST) : null} />
              </>
            )}

            {tab === 'film' && (
              <>
                <div className="chips">
                  {FILM_ITEMS.map(([k, label]) => (
                    <button key={k} aria-pressed={filmKey === k} className={filmKey === k ? 'on' : ''} onClick={() => setFilmKey(k)}>
                      {label}{film[k] > 0 && ` ${Math.round(film[k] * 100)}`}
                    </button>
                  ))}
                </div>
                <ToolSlider label={FILM_ITEMS.find(([k]) => k === filmKey)[2]} value={`${Math.round(film[filmKey] * 100)}%`}
                  min="0" max="1" current={film[filmKey]} onChange={(v) => setFilm((f) => ({ ...f, [filmKey]: v }))}
                  resetLabel="끄기" onReset={hasFilm(film) ? () => setFilm(NO_FILM) : null} />
              </>
            )}
          </div>

          {/* 저장: 비교 보기에서 '원본'을 보고 있으면 원본, 아니면 보정본(보정이 있을 때) */}
          <div className="dock">
            <div className="dock-row">
              <button className="btn ghost" onClick={goHome}>새 포즈</button>
              <button className="btn primary" disabled={saving} onClick={() => save(saveEdited)}>
                {saving ? '저장 준비 중…' : saveEdited ? '보정본 저장' : '원본 저장'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

// 편집 도구 항목 (값의 범위·계산은 adjust.js, film.js)
const ADJUST_ITEMS = [
  ['exposure', '노출'], ['brightness', '밝기'], ['contrast', '대비'],
  ['highlights', '하이라이트'], ['shadows', '그림자'], ['saturation', '채도'],
]
const FILM_ITEMS = [ // [키, 칩 이름, 슬라이더 설명]
  ['grain', '그레인', '그레인 (필름 알갱이)'],
  ['soft', '소프트', '소프트 포커스 (부드럽게)'],
  ['vignette', '비네팅', '비네팅 (가장자리 어둡게)'],
  ['warmth', '따뜻함', '따뜻함 (플래시 느낌)'],
]

// 편집 슬라이더 한 줄: 위에 이름 · 값 · (초기화/끄기), 아래에 슬라이더. 세로 공간을 아껴 사진을 크게 보이게
function ToolSlider({ label, value, min, max, current, onChange, resetLabel, onReset }) {
  return (
    <div className="slider">
      <span>
        <span>{label} <b>{value}</b></span>
        {onReset && <button className="text-btn" onClick={onReset}>{resetLabel}</button>}
      </span>
      <input type="range" min={min} max={max} step="0.05" value={current} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

// 안내 중인 관절 → 몸 그림의 부위
const PART_KIND = {
  11: 'shoulder', 12: 'shoulder', 23: 'hip', 24: 'hip',
  13: 'arm', 14: 'arm', 15: 'arm', 16: 'arm', 25: 'leg', 26: 'leg', 27: 'leg', 28: 'leg',
}

// 멀리서도 "어디를 고칠지" 알 수 있게 작은 몸 그림에 그 부위만 오렌지로 표시 (화면에 보이는 쪽 기준)
function BodyHint({ part, good }) {
  const base = good ? 'var(--ok)' : '#fff'
  const hot = (kind, side) => part && part.kind === kind && (side === undefined || part.side === side)
  const stroke = (kind, side) => (hot(kind, side) ? 'var(--fix)' : base)
  const width = (kind, side) => (hot(kind, side) ? 4.5 : 2.5)
  return (
    <svg className="body-hint" width="40" height="58" viewBox="0 0 40 58" fill="none" strokeLinecap="round" aria-hidden="true">
      <circle cx="20" cy="7" r="5" stroke={stroke('head')} strokeWidth={width('head') - 0.5} />
      <path d="M20 13 V33" stroke={base} strokeWidth="2.5" />
      <path d="M20 17 L9 29" stroke={stroke('arm', 'l')} strokeWidth={width('arm', 'l')} />
      <path d="M20 17 L31 29" stroke={stroke('arm', 'r')} strokeWidth={width('arm', 'r')} />
      <path d="M20 33 L13 54" stroke={stroke('leg', 'l')} strokeWidth={width('leg', 'l')} />
      <path d="M20 33 L27 54" stroke={stroke('leg', 'r')} strokeWidth={width('leg', 'r')} />
      {hot('shoulder') && <circle cx={part.side === 'l' ? 14 : 26} cy="17" r="3.5" fill="var(--fix)" />}
      {hot('hip') && <circle cx={part.side === 'l' ? 16 : 24} cy="33" r="3.5" fill="var(--fix)" />}
    </svg>
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
const COLOR = { ok: '#6EE7A8', bad: '#F07A2A', idle: 'rgba(255,255,255,0.85)' } // 맞음 초록 · 고칠 곳 오렌지 (밝기 차이가 커서 색약도 구분 쉬움)

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
