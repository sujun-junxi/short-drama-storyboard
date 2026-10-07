import { Capacitor } from '@capacitor/core'

export type PlatformKind = 'web' | 'desktop' | 'native'

/**
 * 桌面端 config.json 的形状。图片配置的 key 用 JSON 串存。
 */
export interface StoredConfig {
  apiKey: string
  baseUrl: string
  model: string
  imageProvider: string
  imageConfigs: string
}

export interface ElectronBridge {
  getSettings: () => Promise<StoredConfig>
  saveSettings: (s: StoredConfig) => Promise<void>
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge
  }
}

function detect(): PlatformKind {
  if (typeof window === 'undefined') return 'web'
  try {
    if (Capacitor.isNativePlatform()) return 'native'
  } catch {
    /* Capacitor 未初始化时按 Web 处理 */
  }
  if (navigator.userAgent.includes('Electron')) return 'desktop'
  return 'web'
}

export const PLATFORM: PlatformKind = detect()

/** APK / 原生壳：请求必须由原生层发出，以绕过 WebView 的 CORS 限制 */
export const IS_NATIVE = PLATFORM === 'native'
/** Electron 桌面端：本地 Express 后端已在主进程内运行 */
export const IS_DESKTOP = PLATFORM === 'desktop'

export const PLATFORM_LABEL: Record<PlatformKind, string> = {
  web: '网页版',
  desktop: '桌面版',
  native: '手机版',
}
