import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const API_PORT = Number(process.env.PORT ?? 8787)

export default defineConfig(() => {
  // 刻意**不把 .env 里的 API Key 注入前端**：那是构建期文本替换，Key 会被写进
  // dist/assets/*.js，一旦安装包或构建产物流出去就泄露了。需要预置默认值请走服务端读 .env。
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      // 必须显式监听所有地址：默认只绑 IPv6 的 [::1]，浏览器走 127.0.0.1 会连不上
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${API_PORT}`,
          changeOrigin: true,
        },
      },
    },
  }
})
