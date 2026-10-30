import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// 폰 카메라는 HTTPS에서만 켜지므로, 개발 서버를 https로 열고 같은 와이파이의 폰에서 접속할 수 있게 합니다.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: { host: true },
})
