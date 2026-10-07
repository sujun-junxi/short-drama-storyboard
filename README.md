# 短剧分镜生成器

输入短剧主题、剧本与风格偏好，调用**任意 OpenAI 兼容的文本大模型**（百炼 / OpenAI / DeepSeek / Kimi / 智谱 / 硅基流动 / 火山方舟 / 本地 Ollama…），一键生成 **5 条可直接开拍的分镜脚本**，每条包含镜头编号、画面描述、人物动作、台词/旁白、镜头类型、画面提示词。

分镜定稿后还能**一键配图**：先生成一份「统一视觉设定」锁住角色、场景与画风，再据此产出角色 / 场景参考图，最后带着它们逐条出图 —— 整组画面的角色、空间关系与色调能保持统一。

同一套 React 代码可以跑成三种形态：**网页 / Windows 桌面应用 / Android APK**。

---

## 快速开始（网页版）

```bash
npm install
npm run dev          # 前端 5173 + 后端 8787
```

打开页面，点右上角**设置**，填三项即可开始：

| 项 | 说明 |
| --- | --- |
| 模型服务商 | 从预设里选（自动带出接口地址），或选「自定义」自己填 |
| 接口地址 | OpenAI 兼容根路径，如 `https://api.deepseek.com/v1` |
| API Key | 从对应厂商控制台获取；设置页会给直达链接 |
| 模型名称 | 可直接输入任意模型名，也有建议可选 |

**不需要改任何配置文件。** 配置只存在本机（浏览器 localStorage / 桌面端 userData / 手机 App 私有存储）。

> 想让服务端自带一份默认配置（例如自建网页版给多人用），可以写 `.env.local`，
> 详见下方「模型与配置」。界面里填的会覆盖它。

---

## 桌面应用（Windows）

```bash
npm run desktop           # 开发模式：构建前端后拉起 Electron 窗口
npm run desktop:package   # 打包：产出 release/ 下的绿色版文件夹
```

打包产物：

```
release/ShortDramaStoryboard-win32-x64/ShortDramaStoryboard.exe   ← 双击即用
```

把整个 `ShortDramaStoryboard-win32-x64` 文件夹拷到任意机器（或压成 zip 分发）即可，**无需安装**。
需要安装版时可执行 `npm run desktop:dist`（electron-builder），但它首次运行要联网下载 nsis / winCodeSign 资源。

桌面端把 Express 后端**内嵌在 Electron 主进程**里，启动时自动挑选空闲端口（8790 起），所以**不需要安装 Node，也不用敲任何命令**。模型配置通过界面「设置」填写，保存在 `%APPDATA%/short-drama-storyboard/config.json`，不会写进代码。

> 打包脚本 `scripts/package-desktop.sh` 用的是「复制 Electron 运行时 + 放入 `resources/app`」的手工方式，
> 不依赖 electron-builder 的在线资源，因此离线也能打包。**它不会把 `.env` 打进包**，配置走界面。

---

## Android APK

首次构建需要 JDK 21 与 Android SDK（约 2GB）。已提供一键脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
```

脚本会把环境装到 `C:\Users\<你>\.android-build`，并把 `JAVA_HOME`、`ANDROID_SDK_ROOT` 写到 `env.txt`。

然后：

```bash
npm run android:init    # 首次：构建前端 + 添加 android 平台 + 同步
npm run android:build   # 产出 APK
```

APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`，拷到手机安装即可。

> 若使用自定义路径，构建前请设置环境变量：
> `JAVA_HOME`、`ANDROID_SDK_ROOT`、`ANDROID_HOME`，并把 `JAVA_HOME/bin` 加入 PATH。

**APK 为什么能直连模型服务**：浏览器 WebView 有跨域限制，所以手机端不走 `fetch`，而是用 Capacitor 的 `CapacitorHttp` 在**原生层**发请求，绕过 CORS。这意味着**手机上反而能连那些没配 CORS 头的服务**。因此 APK 必须由使用者填入自己的 Key（存于 App 私有存储）。

---

## 使用说明

| 输入项 | 说明 |
| --- | --- |
| 短剧主题 | 一句话概括题材，如「都市逆袭 / 婆媳过招 / 悬疑反转」 |
| 剧本 | 粘贴剧情梗概、小说片段或分场大纲；**留空则由大模型按主题原创剧情** |
| 风格偏好 | 三个维度可点选：**题材调性**最多选 3 个（第一个是主基调、其余为辅助元素，点按键上的「主 / 辅」徽标可互换主次）、**画面色调**与**镜头语言**可多选；也可在输入框自由补充 |

主题和剧本至少填一项。快捷键 `Ctrl / ⌘ + Enter` 可直接生成。

结果区每条分镜的每个字段都能单独复制，顶部可「复制全部」或导出 Markdown / JSON。

> 生成的「画面提示词」会自动剔除清晰度词（8k / 4k / 高清 / masterpiece…）与画面比例词（16:9 / 3:2 / aspect ratio…）——
> 竖屏短剧画幅固定，这类词会干扰下游文生图。剔除在服务端/客户端共用的解析层完成，网页、桌面、APK 三端一致。

### 生成过程与进度

点击「生成分镜」后，结果区会显示四步进度清单（**正在分析剧本 → 正在调用大模型 → 正在生成分镜 → 正在整理结果**）
与已用秒数，并可随时取消。左侧按钮的文案也会同步显示当前阶段。

网页与桌面端的阶段来自**服务端的真实信号**：`POST /api/generate-stream` 以 SSE 推送，
其中「正在调用大模型」对应「已发出请求、等上游响应头」，「正在生成分镜」对应「响应头已到、正在读 token 流」，
两者是真实可区分的时刻（服务端以 `stream: true` 调上游才能做到）。

> APK 走的是前端直连模型服务，`CapacitorHttp` 不支持流式，因此阶段用本地时间表估算——
> 估算把「不确定的等待」统一归到「正在生成分镜」，所以无论实际耗时多久文案都成立。
> 另需注意：**手机端无法真正中断已发出的请求**，取消后 App 会丢弃结果并如实提示。

---

## 架构

```
浏览器不直连模型服务（网页/桌面）      手机端走原生层绕过 CORS
        │                                    │
  POST /api/generate-stream           CapacitorHttp.post(...)
        │                                    │
   Node/Express 代理                    原生 HTTP
        │                                    │
        └────────────┬───────────────────────┘
                     ▼
       {你在设置里填的接口地址}/chat/completions
```

这样做的原因：

1. 规避浏览器跨域限制；
2. 服务端统一做错误映射（401 Key 无效 / 403 无权限 / 429 限流 / 404 地址或模型名错 / 超时）；
3. 服务端统一做参数兼容降级（见下）。

**共享逻辑**：`shared/prompt.mjs` 同时被 Node 后端和前端（APK 直连模式）引用，保证两端的提示词与返回解析完全一致，不会出现两套实现漂移。

### 参数兼容降级

不同厂商对 OpenAI 协议的实现程度参差不齐。请求失败且疑似「参数不被支持」时，会**逐级去掉可选参数重试**：

```
带 response_format + stream
   └─失败─▶ 去掉 response_format（保留 stream）
              └─失败─▶ 去掉 stream（改用非流式）
```

判定同时看状态码（400/404/405/409/415/422/500/501/502）与响应体关键词（中英文都覆盖），
所以对「把参数问题报成 500」或「用中文报错」的网关也有效。这套逻辑在 `shared/compat.mjs`，三端共用。

### 接口地址的安全限制

接口地址由用户自定义，服务端会对它发请求，所以做了 SSRF 防护：

- 仅允许 `http` / `https`；拒绝含用户名密码的 URL
- **一律拒绝云元数据地址**（169.254.169.254 等）
- 内网 / 回环地址**仅在本机来源时放行**，这样桌面端和本地开发能连 Ollama，公网部署的远程请求则被拒绝
- 不跟随重定向（防公网地址跳到内网）
- **接口地址被请求体覆盖时，不会回落到服务端保存的 Key**，防止密钥被骗到第三方地址

如需在服务器上允许内网地址（例如内网部署的模型网关），设 `STORYBOARD_ALLOW_LOCAL_ENDPOINTS=true`。

## 配图生成

分镜文字出来后，可以让每条分镜自动配图。**配图是按张计费的**，所以不会自动跑，由你决定给哪几条出图。

### 支持的服务商

| 服务商 | 默认模型 | 参考图 | 说明 |
| --- | --- | --- | --- |
| 阿里云百炼（通义万相） | `wan2.7-image-pro` | ✅ 最多 4 张 | 开箱即用，中英文提示词都行 |
| OpenAI 兼容 | `gpt-image-1` | — | 可接自建网关 / 第三方兼容服务 |

两家都只出**横屏画幅**（16:9 一类），方图与竖屏选项已移除 —— 短剧是横屏内容，混着出会很难用。

### 怎么让整组图看起来是一套

三件事保证一致性，按重要性排序：

1. **统一视觉设定**（视觉圣经）—— 生成分镜**之前**先产出一份设定，固定角色外貌与服装、核心场景的空间布局、整体画风、色调光线，以及一段可直接拼到每条分镜提示词前的英文锚定提示词。分镜的「画面提示词」本身就是照着它写的，所以天然一致。
2. **角色 / 场景参考图** —— 根据设定再各出一张参考图（最多 4 个角色 + 1 张核心场景），后续每张分镜都带着它们去生成，比纯文字锚定更能锁住长相与场景。
3. **负面约束** —— 设定里会给出应避免的元素（肢体变形、多余手指、水印等）。

设定产出后会在结果区展示，**锚定提示词可以直接编辑**，改完点「应用并重新生成配图」就能重出全套。

### 参考图

参考图区会显示「N / M 就绪 · K 张失败」，**每张都能单独重新生成**（不用整套重跑），失败时给出可读的错误原因。

> 参考图会增加每张分镜的输入量，成本略高。如果只想要个大概效果，可以不用参考图 —— 设定先行带来的文字锚定已经能保证基本一致。

### 单张超时

设置里可以调（默认 180 秒，可填 30~3600，按图片服务商分别保存）。云端模型在高峰期会明显变慢，调大即可；超时只影响等待，不会影响已经提交的任务。

---

## 项目结构

```
short-drama-storyboard/
├── shared/                     # 前后端共用（前端 TS 与服务端 JS 一起引用）
│   ├── prompt.mjs              # 提示词 + 返回解析 + 视觉设定结构
│   ├── image-adapters.mjs      # 文生图适配器（百炼 / OpenAI 兼容）
│   └── endpoint.mjs            # 地址归一化与内网判定
├── server/
│   ├── app.mjs                 # Express 应用工厂（Web 与 Electron 复用）
│   ├── image.js                # 配图编排：缓存 → 参考图转码 → 调用 → 落盘
│   ├── image-cache.mjs         # 配图磁盘缓存（原子写 + 上限清理）
│   └── index.mjs               # 独立服务入口
├── electron/
│   ├── main.cjs                # 主进程：内嵌后端 + 窗口 + 配置读写
│   └── preload.cjs             # 桥接 window.electronAPI
├── android/                    # Capacitor 生成的原生工程
├── src/
│   ├── App.tsx                 # 页面骨架 + 生成流程编排
│   ├── components/
│   │   ├── InputPanel.tsx      # 输入区
│   │   ├── ResultsPanel.tsx    # 结果区（空态/加载/错误/列表）
│   │   ├── ShotCard.tsx        # 单条分镜卡片
│   │   ├── VisualSettingPanel.tsx # 统一视觉设定展示与编辑
│   │   ├── ReferenceImages.tsx # 角色 / 场景参考图
│   │   └── SettingsDialog.tsx  # API Key 与模型设置
│   ├── lib/
│   │   ├── api.ts              # 按运行时选择请求通道
│   │   ├── platform.ts         # web / desktop / native 运行时判定
│   │   ├── reference.ts        # 从视觉设定推演参考图
│   │   ├── settings.ts         # 配置存取（localStorage / Electron / Preferences）
│   │   └── style-presets.ts    # 风格偏好的可选项
│   └── components/ui/          # shadcn 风格基础组件
└── scripts/
    ├── smoke.mjs               # 组件渲染 + 纯函数冒烟测试（191 项断言）
    ├── test-image.mjs          # 配图链路集成测试（起假上游）
    ├── test-sse.mjs            # 流式分镜集成测试
    └── setup-android.ps1       # 一键准备 Android 构建环境
```

## 模型与配置

**默认什么都不用配**：打开应用点右上角「设置」，选服务商 / 填接口地址 / 填 Key / 填模型名即可。
配置只存在本机 —— 浏览器在 localStorage、桌面端在 `%APPDATA%/short-drama-storyboard/config.json`、手机在 App 私有存储。

### 支持的服务商

协议限 **OpenAI 兼容**（`POST {baseUrl}/chat/completions` + `Authorization: Bearer`）。内置以下预设，选一下会自动填好接口地址与常用模型名：

| 服务商 | 接口地址 |
| --- | --- |
| 阿里云百炼（通义千问） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| OpenAI | `https://api.openai.com/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| 月之暗面 Kimi | `https://api.moonshot.cn/v1` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` |
| 硅基流动 | `https://api.siliconflow.cn/v1` |
| 字节火山方舟（豆包） | `https://ark.cn-beijing.volces.com/api/v3` |
| Ollama（本机） | `http://127.0.0.1:11434/v1` |

选「自定义」可填任意 OpenAI 兼容地址（自建网关、vLLM、LM Studio、One-API 等）。
**模型名是自由输入框**，预置列表只是建议，以各厂商文档为准。

### 可选：服务端默认值（`.env.local`）

只有「想让服务端自带一份默认配置」时才需要，例如自建网页版给多人用。**界面里填的会覆盖它**。

```dotenv
STORYBOARD_API_KEY=sk-xxxxxxxxxxxxxxxx
STORYBOARD_MODEL=qwen-plus
STORYBOARD_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
PORT=8787
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `STORYBOARD_API_KEY` | 空 | 默认 Key |
| `STORYBOARD_MODEL` | `qwen-plus` | 默认模型 |
| `STORYBOARD_BASE_URL` | 百炼北京地域 | 默认接口地址 |
| `STORYBOARD_ALLOW_LOCAL_ENDPOINTS` | `false` | 设为 `true` 时允许远程请求使用内网接口地址 |
| `PORT` | `8787` | 网页版后端端口（桌面端自动选空闲端口） |
| `BAILIAN_*` / `DASHSCOPE_*` | — | 旧变量名，仍兼容，优先级低于 `STORYBOARD_*` |

**读取优先级**（由 `server/app.mjs` 统一处理）：

```
界面「设置」里填的（请求体传入）        ← 用户填了就用用户的
  └─ 服务端进程环境变量（Electron 注入的 STORYBOARD_UI_*）
       └─ .env.local / .env 的 STORYBOARD_*
            └─ 旧变量名 BAILIAN_* → DASHSCOPE_*
```

改完文件**无需重启服务**，后端按 mtime 热读取。

> ⚠️ **关于 APK**：手机端是前端直连模型服务，没有服务端可读文件，所以只认 App 内「设置」里填的配置。

### 🔒 关于密钥安全

**本项目刻意不提供「构建期注入 API Key」的能力。**

有些项目支持在打包时把 Key 写进安装包当默认值。这个项目**没有**做这件事，因为那些变量经
`vite define` 注入属于**构建期文本替换** —— Key 会被直接写进 `dist/assets/*.js`，
一旦安装包或构建结果流出去，Key 就跟着泄露了；公开平台通常还有密钥扫描，检测到会**通知厂商吊销**。

所以：

- `.env` / `.env.local` 里的变量**只由服务端读取**（`server/app.mjs`），自建网页版预置默认配置仍然可用
- 前端与安装包里**不会**出现任何 Key，每个使用者填自己的
- `.env*`、`dist/`、`release/`、`.cache/` 都已在 `.gitignore` 中忽略

> 提交前建议自查一遍：`git grep -nE "sk-[a-zA-Z0-9]{20,}"`

### 接入非百炼服务的注意事项

- 各家对 OpenAI 协议的实现程度不一，本项目已内置**参数兼容降级**（见上文），遇到不支持 `response_format` 或 `stream` 的服务会自动去掉后重试。
- 「画面提示词」是针对文生图模型的，与调用哪个文本模型无关。
- 部分服务（如火方方舟）用「接入点 ID」而非模型名，设置页会在提示里说明。
- 模型名迭代很快，预置列表可能过时 —— 以厂商文档为准，直接手填即可。

## 脚本命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 网页版开发（前端 + 后端） |
| `npm run build` | 类型检查 + 构建前端到 `dist/` |
| `npm start` | 生产模式：单端口同时提供页面与接口 |
| `npm run desktop` | 启动 Electron 桌面应用 |
| `npm run desktop:package` | 打包免安装绿色版（离线可用，推荐） |
| `npm run desktop:dist` | 用 electron-builder 打安装包（需联网下载资源） |
| `npm run android:build` | 构建 Android APK（自动探测 JDK/SDK，一条命令到底） |
| `npm run android:sync` | 只同步前端资源到 Android 工程 |
| `npm run android:plugins` | 增删 Capacitor 插件后同步原生工程 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run smoke` | 组件渲染与纯逻辑冒烟测试 |
| `npm run test:sse` | SSE 端点集成测试（mock 上游 + 真实服务） |
