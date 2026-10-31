import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig, loadEnv } from 'vite'
import poseRecommendApi from './server/poseRecommendApi.js'

// 폰 카메라는 HTTPS에서만 켜지므로, 개발 서버를 https로 열고 같은 와이파이의 폰에서 접속할 수 있게 합니다.
// 포즈 추천 API(/api/poses/*)도 이 개발 서버 안에서 돌고, API 키는 .env.local에서 읽어 서버에서만 씁니다.
// 배포판(Netlify)은 netlify/functions/poses.mjs가 같은 API를 처리합니다.
// (키 이름에 VITE_를 붙이면 브라우저 코드에 들어가 버리니 붙이지 마세요.)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), basicSsl(), poseRecommendApi(env.ANTHROPIC_API_KEY, env.DEMO_CODE)],
    server: { host: true },
  }
})
