/**
 * Electron 主进程（CommonJS）。
 *
 * 为什么用 .cjs 而不是 .mjs：electron 这个 npm 包的入口导出的是可执行文件路径
 * （`module.exports = executablePath`），真正的 API 是 Electron 运行时对
 * 'electron' 这个模块名做的内置拦截，只在 CJS require 下生效。
 * ESM 的具名导入 / default 导入 / createRequire 三种方式都拿不到 app、ipcMain 等成员。
 */
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, session, shell } = require('electron')

// 本应用只做文本渲染，不需要 GPU。关掉硬件加速可避免在虚拟机、远程桌面、
// 无显卡环境下 GPU 进程反复崩溃导致窗口起不来。必须在 app ready 之前调用。
app.disableHardwareAcceleration()

// 页面只访问本地内嵌服务。若机器上配置了 HTTP 代理，Chromium 会把
// http://127.0.0.1 的请求也发给代理，导致 ERR_FAILED (-2) 白屏，这里强制直连。
app.commandLine.appendSwitch('no-proxy-server')
// 容器 / CI / 受限沙箱里 Chromium 自带的沙箱往往起不来，导致渲染进程直接崩溃
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-setuid-sandbox')

let createApp = null
let mainWindow = null
let apiPort = 0

// ---------- 本机配置（存 userData，打包后依然可写） ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json')

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    return {
      apiKey: String(parsed.apiKey ?? ''),
      baseUrl: String(parsed.baseUrl ?? ''),
      model: String(parsed.model ?? 'qwen-plus'),
      // 图片相关：imageConfigs 存成 JSON 串，与前端存储层保持一致
      imageProvider: String(parsed.imageProvider ?? 'bailian'),
      imageConfigs: typeof parsed.imageConfigs === 'string' ? parsed.imageConfigs : '{}',
    }
  } catch {
    return { apiKey: '', baseUrl: '', model: 'qwen-plus', imageProvider: 'bailian', imageConfigs: '{}' }
  }
}

// 用独立的变量名注入界面里填的配置：server/app.mjs 里 STORYBOARD_UI_* 优先级最高，
// 高于 .env / .env.local 里的默认值。
// 另外注入图片缓存目录到 userData —— 安装到 Program Files 时应用目录是只读的。
function applyConfigToEnv(cfg) {
  if (cfg.apiKey) process.env.STORYBOARD_UI_KEY = cfg.apiKey
  else delete process.env.STORYBOARD_UI_KEY
  if (cfg.model) process.env.STORYBOARD_UI_MODEL = cfg.model
  else delete process.env.STORYBOARD_UI_MODEL
  if (cfg.baseUrl) process.env.STORYBOARD_UI_BASE_URL = cfg.baseUrl
  else delete process.env.STORYBOARD_UI_BASE_URL

  try {
    process.env.STORYBOARD_IMAGE_CACHE_DIR = path.join(app.getPath('userData'), 'images')
  } catch {
    /* 拿不到 userData 时回落到项目目录下的 .cache */
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
  applyConfigToEnv(cfg)
}

// ---------- 内嵌后端：用户无需安装 Node，也不用手动启服务 ----------
function findFreePort(start) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.on('error', () => resolve(findFreePort(start + 1)))
    probe.listen(start, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function startApiServer() {
  applyConfigToEnv(readConfig())
  apiPort = await findFreePort(8790)
  const server = createApp({ serveStatic: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(apiPort, '127.0.0.1', resolve)
  })
  console.log(`[electron] 内嵌服务已启动: http://127.0.0.1:${apiPort}`)
}

// ---------- IPC：设置读写 ----------
ipcMain.handle('get-settings', () => readConfig())
ipcMain.handle('save-settings', (_event, settings) => {
  const cfg = {
    apiKey: String(settings?.apiKey ?? '').trim(),
    baseUrl: String(settings?.baseUrl ?? '')
      .trim()
      .replace(/\/+$/, ''),
    model: String(settings?.model ?? 'qwen-plus').trim() || 'qwen-plus',
    imageProvider: String(settings?.imageProvider ?? 'bailian').trim() || 'bailian',
    imageConfigs: typeof settings?.imageConfigs === 'string' ? settings.imageConfigs : '{}',
  }
  writeConfig(cfg)
  return cfg
})

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: '短剧分镜生成器',
    autoHideMenuBar: true,
    backgroundColor: '#fafafa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 自检：确认内嵌服务在本进程内可达，便于区分「服务没起来」和「渲染进程起不来」
  try {
    const probe = await fetch(`http://127.0.0.1:${apiPort}/api/config`)
    console.log(`[electron] 自检：内嵌服务返回 HTTP ${probe.status}`)
  } catch (err) {
    console.error('[electron] 自检失败', err)
  }

  try {
    await mainWindow.loadURL(`http://127.0.0.1:${apiPort}`)
    console.log('[electron] 页面加载成功')
  } catch (err) {
    console.error('[electron] 页面加载失败', err)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // 双保险：显式把默认会话设为直连
    session.defaultSession.setProxy({ mode: 'direct' })

    // server/app.mjs 是 ESM，CJS 里只能动态 import
    ;({ createApp } = await import('../server/app.mjs'))

    try {
      await startApiServer()
    } catch (err) {
      console.error('[electron] 内嵌服务启动失败', err)
    }

    await createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('window-all-closed', () => app.quit())
}
