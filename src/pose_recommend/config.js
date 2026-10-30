// 포즈 추천 기능 켜기/끄기. false면 업로드 화면의 "포즈 라이브러리" 버튼이 사라지고 기존 앱과 똑같이 동작합니다.
export const POSE_RECOMMEND_ENABLED = true

export const IMAGE_MAX_SIDE = 1024 // AI로 보내기 전 사진 긴 변 (PRD F1)
export const MIN_SCORE = 40 // 이 점수 미만 추천은 "맞는 포즈 없음"으로 처리 (PRD F4)
export const MAX_PICKS = 3
export const RECOMMEND_TIMEOUT_MS = 10_000 // 넘으면 다시 시도 안내 (PRD F3)
export const ANALYZE_TIMEOUT_MS = 15_000
export const RECOMMENDED_COUNT = 20 // "20장 이상 등록 권장" 안내 기준 (PRD F2)
