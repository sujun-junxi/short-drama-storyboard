import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.local.storyboard',
  appName: '短剧分镜生成器',
  webDir: 'dist',
  // 用 https scheme，避免 WebView 把直连模型服务的请求当混合内容拦截
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Preferences: {},
  },
}

export default config
