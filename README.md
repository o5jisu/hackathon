# 포즈메이트 (해커톤 MVP)

참고 사진을 카메라 화면에 반투명하게 겹치고 관절 비교로 포즈를 코칭하며, 셔터로 촬영한 사진에 버튼을 누르면 참고 사진 색감을 입혀 주는 웹앱입니다.

> 📄 **기획안 전문은 [docs/SPEC.md](docs/SPEC.md)** 에 있습니다.

## 실행 (VS Code)

1. Node.js 18 이상 설치 (https://nodejs.org)
2. VS Code에서 이 폴더 열기 → 터미널(`Ctrl + ``)에서:
   ```bash
   npm install
   npm run dev
   ```
3. PC 브라우저: 터미널에 나온 `https://localhost:5173` 접속
4. 폰: PC와 **같은 와이파이**에서 터미널의 `Network: https://192.168.x.x:5173` 주소 접속
   - "안전하지 않음" 경고가 뜨면 **고급 → 계속 진행** (개발용 인증서라 정상)

## 파일 구조

| 파일 | 역할 |
| --- | --- |
| `src/pose.js` | 모델 로드, 좌표 정규화, 관절 비교, 안내 문장, 색감 보정 (순수 로직) |
| `src/App.jsx` | 화면 3개(업로드 → 코칭 → 결과), 카메라 루프, 참고 사진 오버레이, 셔터 촬영, 원본·보정 비교 |
| `src/App.css` | 스타일 |
| `vite.config.js` | 폰 카메라용 HTTPS 개발 서버 설정 |

## 조정할 값

- `pose.js`의 `MATCH_T` (기본 0.3): 팔다리 판정 허용 범위, 작을수록 엄격
- `pose.js`의 `HEAD_T` (기본 0.12): 목 기준 코·입 위치 허용 범위, `TORSO_T` (기본 0.1): 어깨·골반 허용 범위. 작을수록 엄격

## 오프라인 시연 대비

모델 파일 두 개(카메라용 `pose_landmarker_full.task`, 참고 사진용 `pose_landmarker_heavy.task`)를 미리 받아 `public/models/`에 넣고, `pose.js`의 `MODEL_URL`·`HEAVY_MODEL_URL`을 `'/models/파일이름'`으로 바꾸세요.
