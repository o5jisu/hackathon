# 포즈메이트 — 작업 안내 (Claude Code용)

해커톤(주제: "우리의 일상을 AX하라")용 MVP. 참고 사진의 포즈를 카메라로 따라 하도록 관절 비교로 코칭하고, 촬영 사진에 참고 사진 색감을 입히는 React + Vite 웹앱이다.

- **기준 문서: `docs/SPEC.md`** (최신 기획안). 코드와 기획이 다르면 SPEC.md를 따른다.
- 사용자는 컴퓨터공학과 2학년, Python이 주력이고 JS/React는 익숙하지 않다. **설명은 한국어로, 용어를 풀어서 단계별로** 한다.
- 답변 마지막에 이번 작업의 핵심만 번호 붙여 짧게 요약한다.

## 실행

```bash
npm install
npm run dev   # https://localhost:5173 , 폰은 같은 와이파이에서 Network 주소
```

폰 카메라는 HTTPS에서만 켜지므로 `vite.config.js`에 basic-ssl 플러그인을 넣어 두었다.

## 코드 구조

| 파일 | 역할 |
| --- | --- |
| `src/pose.js` | MediaPipe 모델 로드, 좌표 변환(toFrame/cropRect/toPixels/mirror/bodyFrame/normalize), 관절 비교(compare), 머리 각도 비교(compareHead: 코·눈·귀로 기울이기/돌리기/숙이기, 허용 범위 HEAD_T), 안내 문장(adviceFor/headAdvice), 색감 보정(statsOf/matchColor/blendImages) |
| `src/App.jsx` | 화면 3개(upload → coaching → captured), 카메라 루프(앞·뒤 카메라 전환), 참고 사진 오버레이(투명도 조절), 셔터 촬영, 원본·보정 비교 화면 |
| `src/App.css`, `src/index.css` | 스타일 |

촬영 틀: 카메라·참고 사진·촬영 결과 모두 가운데를 9:16으로 자른다(`pose.js`의 `cropRect`/`toFrame`, CSS `object-fit: cover`). 관절 좌표는 공통 900×1600 틀 좌표를 쓴다. 참고 사진 크기·위치 조절은 사용자 요청으로 제거했다.

좌우 처리: 앞 카메라(`facing === 'user'`)만 거울 처리하고, 뒤 카메라는 뒤집지 않는다(`mirror()` 생략, `adviceFor`의 `mirrored=false`면 화면 오른쪽 = 사용자 왼쪽). 앞 카메라 화면은 거울처럼 보인다. `mirror()`가 x를 뒤집고 좌우 관절 번호를 바꿔서, 참고 사진의 j번 관절과 "화면에서 같은 쪽"의 사용자 관절을 비교한다. 안내 문구는 사용자 몸 기준 이름을 쓴다.

## SPEC.md 반영 상태

2026-10-30 기준 SPEC의 6가지 변경(셔터 촬영, 참고 사진 오버레이, 기준점 표시, 버튼으로 색감 적용, 원본·보정 나란히, 범례)을 반영했다. 음성 안내는 사용자 결정으로 제거했다(다시 넣지 말 것).

## 주의

- 모델 파일은 런타임에 CDN에서 받는다(`pose.js`의 `MODEL_URL`). 오프라인 시연 대비 시 `public/models/`에 넣고 경로 변경.
- 판정 엄격도는 `pose.js`의 `MATCH_T`(기본 0.3).
- 사진·영상은 서버로 보내지 않는다(온디바이스 처리).
