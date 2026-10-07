#!/usr/bin/env node
/**
 * 构建 Android APK。
 *
 * 为什么不用 `cap sync && cd android && ./gradlew` 这种 npm script 链：
 * 1. Capacitor 的 sync 会清理 capacitor-cordova-android-plugins 目录，
 *    该操作可能因批量删除保护而失败并返回退出码 1，把 `&&` 链直接切断，
 *    导致 Gradle 根本没跑、APK 悄悄停留在旧版本。本项目没有 Cordova 插件，
 *    只需同步 web 资源，因此这里用 cap copy（不触发插件清理）。
 * 2. `./gradlew` 是 shell 脚本，在 cmd 下不可用；`gradlew` 在 Git Bash 下
 *    又需要显式相对路径。这里统一交给 Node 按平台挑选 gradlew.bat / gradlew。
 * 3. JDK 与 Android SDK 的路径做多候选探测，避免硬编码某一台机器。
 *
 * 用法：node scripts/build-apk.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const ANDROID_DIR = path.join(ROOT, 'android')

const isWin = process.platform === 'win32'

/**
 * setup-android.ps1 的默认安装位置。
 * 跟着当前用户的主目录走，换机器不用改脚本；要固定位置就设 JAVA_HOME / ANDROID_SDK_ROOT。
 */
const androidBuildRoot = () => path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.android-build')

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

function log(step, msg) {
  console.log(`[${step}] ${msg}`)
}

function fail(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

/** 展开形如 C:/x/jdk/* 的候选，取第一个含 bin/java(.exe) 的目录 */
function resolveJavaHome() {
  const explicit = [process.env.JAVA_HOME, path.join(androidBuildRoot(), 'jdk21')].filter(Boolean)
  const javas = isWin ? ['bin\\java.exe'] : ['bin/java']

  for (const base of explicit) {
    for (const rel of javas) {
      if (exists(path.join(base, rel))) return base
    }
    // JAVA_HOME 指向父目录时，向下找一层（jdk-21.0.x）
    if (exists(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const candidate = path.join(base, entry.name)
        for (const rel of javas) {
          if (exists(path.join(candidate, rel))) return candidate
        }
      }
    }
  }
  return null
}

function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    path.join(androidBuildRoot(), 'android-sdk'),
  ].filter(Boolean)
  return candidates.find((p) => exists(path.join(p, 'platform-tools'))) ?? null
}

// ---------- 1. 环境检查 ----------
log('1/4', '检查构建环境')
const javaHome = resolveJavaHome()
if (!javaHome) fail('未找到 JDK。请设置 JAVA_HOME，或先运行 scripts/setup-android.ps1')
const sdkRoot = resolveAndroidSdk()
if (!sdkRoot) fail('未找到 Android SDK。请设置 ANDROID_SDK_ROOT，或先运行 scripts/setup-android.ps1')

const javaExe = path.join(javaHome, isWin ? 'bin/java.exe' : 'bin/java')
if (!exists(javaExe)) fail(`JDK 目录里没有 java 可执行文件：${javaExe}`)

// 自检失败不阻断：某些受限环境不允许直接 spawn java.exe（返回 EBUSY），
// 但 Gradle 通过 wrapper 间接调用是正常的，最终由 Gradle 判定。
const javaProbe = spawnSync(javaExe, ['-version'], { encoding: 'utf8' })
const javaLine =
  javaProbe.status === 0
    ? String(javaProbe.stderr || '').split('\n')[0].trim()
    : `自检未通过（${javaProbe.error?.code ?? `exit ${javaProbe.status}`}），交由 Gradle 验证`

console.log(`    JDK         = ${javaHome}`)
console.log(`    Java        = ${javaLine}`)
console.log(`    Android SDK = ${sdkRoot}`)

if (!exists(ANDROID_DIR)) {
  fail('android/ 目录不存在。请先运行：npx cap add android')
}

const gradle = path.join(ANDROID_DIR, isWin ? 'gradlew.bat' : 'gradlew')
if (!exists(gradle)) fail(`未找到 Gradle wrapper：${gradle}`)

// ---------- 2. 构建前端 ----------
log('2/4', '构建前端资源')
const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: isWin })
if (build.status !== 0) fail('前端构建失败')

// ---------- 3. 同步到 Android 工程 ----------
// Capacitor 的 native 工程有几个由 CLI 生成的 gradle 文件（例如
// capacitor-cordova-android-plugins/cordova.variables.gradle），
// app/capacitor.build.gradle 会 apply 它们。这些文件缺失时 Gradle 直接报错，
// 而 `cap copy` 并不生成它们（只有 `cap sync` 的 update 步骤会）。
// 所以这里先检查；缺失就跑一次完整的 sync 自愈，否则用更轻的 copy。
const generatedFiles = [
  path.join(ANDROID_DIR, 'capacitor-cordova-android-plugins', 'cordova.variables.gradle'),
  path.join(ANDROID_DIR, 'capacitor-cordova-android-plugins', 'build.gradle'),
]
const missing = generatedFiles.filter((p) => !exists(p))

if (missing.length > 0) {
  log('3/4', `原生工程缺少 ${missing.length} 个生成文件，执行 cap sync 补全`)
  const sync = spawnSync('npx', ['cap', 'sync', 'android'], { cwd: ROOT, stdio: 'inherit', shell: isWin })
  if (sync.status !== 0) fail('cap sync 失败（原生工程生成文件缺失，Gradle 无法构建）')
} else {
  log('3/4', '同步 web 资源到 Android 工程')
  const copy = spawnSync('npx', ['cap', 'copy', 'android'], { cwd: ROOT, stdio: 'inherit', shell: isWin })
  if (copy.status !== 0) fail('cap copy 失败（web 资源未同步）')
}

// ---------- 4. 构建 APK ----------
log('4/4', '执行 Gradle 构建')
// Gradle 不读取 http_proxy 环境变量，这里把它显式转成 JVM 参数传进去
const proxyArgs = []
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY
if (proxy) {
  try {
    const { hostname, port } = new URL(proxy)
    proxyArgs.push(
      `-Dhttps.proxyHost=${hostname}`,
      `-Dhttps.proxyPort=${port}`,
      `-Dhttp.proxyHost=${hostname}`,
      `-Dhttp.proxyPort=${port}`,
    )
  } catch {
    /* 代理地址不合法时忽略 */
  }
}

const gradleResult = spawnSync(
  gradle,
  ['assembleDebug', '--no-daemon', `-Dorg.gradle.java.home=${javaHome}`, ...proxyArgs],
  {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env, JAVA_HOME: javaHome, ANDROID_SDK_ROOT: sdkRoot, ANDROID_HOME: sdkRoot },
  },
)
if (gradleResult.status !== 0) fail('Gradle 构建失败')

// ---------- 结果 ----------
const apk = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
if (!exists(apk)) fail('构建流程结束但未找到 APK 产物')

const sizeMb = (fs.statSync(apk).size / 1024 / 1024).toFixed(1)
console.log('\n===== 完成 =====')
console.log(`APK: ${apk}`)
console.log(`大小: ${sizeMb} MB`)
