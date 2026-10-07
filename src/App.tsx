import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Info, KeyRound, Settings as SettingsIcon } from 'lucide-react'

import { EMPTY_FORM, InputPanel, type FormState } from '@/components/InputPanel'
import { ResultsPanel } from '@/components/ResultsPanel'
import { SettingsDialog } from '@/components/SettingsDialog'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { generateImage, generateStoryboard, generateVisualSetting, buildImagePrompt } from '@/lib/api'
import { IS_NATIVE } from '@/lib/platform'
import { TOTAL_SHOTS, createNativeEstimator, type GeneratePhase, type GenerateProgress } from '@/lib/progress'
import {
  DEFAULT_SETTINGS,
  imageTimeoutMs,
  loadSettings,
  resolveImageApiKey,
  type ImageProviderConfig,
  type Settings,
} from '@/lib/settings'
import { composeStyle, summarizeStyle } from '@/lib/style-presets'
import { useTheme } from '@/lib/theme'
import { buildReferenceTargets, readyReferenceUrls } from '@/lib/reference'
import type { GenerateStatus, ImageState, ReferenceImage, Shot } from '@/lib/types'
import type { VisualSetting } from '../shared/prompt.mjs'
import { isAdapterAvailableOn } from '../shared/image-adapters.mjs'

/** 配图并发数。百炼按账号限流，取一个保守值避免触发限流。 */
const IMAGE_CONCURRENCY = 3

/** 图片 Key 解析不出来时的统一提示：两家不同源（或图片地址还没填），不能拿文本 Key 顶上 */
const NO_IMAGE_KEY_NOTICE =
  '图片服务缺少可用的 API Key：它和文本模型不是同一个服务（或图片地址还没填）。请在「设置 → 图片模型」里补上。'

export default function App() {
  useTheme()

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [status, setStatus] = useState<GenerateStatus>('idle')
  const [phase, setPhase] = useState<GeneratePhase | null>(null)
  const [progress, setProgress] = useState<GenerateProgress>({ completed: 0, total: TOTAL_SHOTS, shots: [] })
  const [shots, setShots] = useState<Shot[]>([])
  const [model, setModel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 配图状态，与 shots 同索引。刻意不塞进 Shot —— 那是会被导出的纯数据。 */
  const [images, setImages] = useState<ImageState[]>([])
  /** 统一视觉设定（视觉圣经）：生成前先产出，页面展示并可编辑后重新出图 */
  const [visualSetting, setVisualSetting] = useState<VisualSetting | null>(null)
  const [visualSettingStatus, setVisualSettingStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [visualSettingError, setVisualSettingError] = useState<string | null>(null)
  const visualSettingRef = useRef<VisualSetting | null>(null)
  /**
   * 参考图：角色与场景各一张，先于分镜图产出，后续当锚喂给每张分镜。
   * 与 images 一样不塞进 Shot —— 那是会被导出序列化的纯数据。
   */
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const imageAbortRef = useRef<AbortController | null>(null)
  const referenceAbortRef = useRef<AbortController | null>(null)
  /** 配图回调里要读最新参考图，用 ref 规避闭包竞态（与 visualSettingRef 同理） */
  const referenceImagesRef = useRef<ReferenceImage[]>([])
  const nativeEstRef = useRef<ReturnType<typeof createNativeEstimator> | null>(null)
  const cancelledRef = useRef(false)
  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    referenceImagesRef.current = referenceImages
  }, [referenceImages])

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s)
      setModel(s.model)
    })
  }, [])

  // 条数进度：只增不减、不超上限。网页/桌面来自服务端流式解析，APK 来自本地估算。
  const handleProgress = useCallback((next: GenerateProgress) => {
    if (cancelledRef.current) return
    setProgress((prev) => {
      const total = next.total > 0 ? next.total : prev.total
      const completed = Math.min(total, Math.max(prev.completed, next.completed))
      // shots 只在变长时替换，防止乱序帧导致内容回退
      const shots = next.shots.length >= prev.shots.length ? next.shots : prev.shots
      return { completed, total, shots }
    })
  }, [])

  /** 只替换第 index 项，用函数式更新避免并发 worker 之间的闭包竞态 */
  const patchImage = useCallback((index: number, next: ImageState) => {
    setImages((prev) => {
      const copy = prev.slice()
      copy[index] = next
      return copy
    })
  }, [])

  /**
   * 配图：由用户主动触发，并发池逐张完成即回填。
   * 手机端没有服务端做缓存，走直连（见 api.ts 的 generateImageNative）。
   */
  const generateImages = useCallback(
    async (
      targetShots: Shot[],
      current: Settings,
      opts: { force?: boolean; only?: number[]; provider?: string } = {},
    ) => {
      // 卡片上可以临时换一家；不换（或选「跟随文本模型」）就用设置里那家
      const override = opts.provider && opts.provider !== 'auto' ? opts.provider : null
      const providerId = override ?? current.imageProvider
      if (!isAdapterAvailableOn(providerId, { native: IS_NATIVE })) {
        setNotice('当前图片服务在手机端不可用，请在「设置 → 图片模型」换一个。')
        return
      }

      const cfg: ImageProviderConfig = current.imageConfigs[providerId] ?? { baseUrl: '', apiKey: '', model: '' }
      // 图片 Key 留空则复用文本 Key（多数人文本与配图用的是同一个百炼 Key）。
      // 两家不是同一个服务时必须各填各的 —— 见 resolveImageApiKey 的注释。
      const apiKey = resolveImageApiKey(current, cfg)
      if (!apiKey) {
        setNotice(NO_IMAGE_KEY_NOTICE)
        return
      }

      const controller = new AbortController()
      imageAbortRef.current?.abort()
      imageAbortRef.current = controller

      const targets = opts.only ?? targetShots.map((_, i) => i)
      setImages((prev) => {
        const copy = targetShots.map((_, i) => prev[i] ?? { status: 'idle' as const })
        for (const i of targets) copy[i] = { status: 'loading' }
        return copy
      })

      let cursor = 0
      const worker = async () => {
        for (;;) {
          const slot = cursor++
          if (slot >= targets.length || controller.signal.aborted) return

          const index = targets[slot]
          // 统一视觉设定的锚定提示词拼到每条分镜前，整组画面更统一
          const prompt = buildImagePrompt(visualSettingRef.current, targetShots[index]?.imagePrompt)
          if (!prompt) {
            patchImage(index, { status: 'idle' })
            continue
          }

          try {
            const res = await generateImage(
              {
                provider: providerId,
                prompt,
                baseUrl: cfg.baseUrl ?? '',
                apiKey,
                model: cfg.model ?? '',
                size: cfg.size,
                // 参考图只在已成功生成的那些里取 —— 失败或还在跑的不能塞进请求
                referenceImages: readyReferenceUrls(referenceImagesRef.current),
                timeoutMs: imageTimeoutMs(cfg),
                force: opts.force === true,
              },
              controller.signal,
            )
            if (controller.signal.aborted) return
            patchImage(index, { status: 'success', url: res.url, cached: res.cached })
          } catch (err) {
            if (controller.signal.aborted || (err as DOMException)?.name === 'AbortError') return
            patchImage(index, { status: 'error', error: err instanceof Error ? err.message : String(err) })
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, targets.length) }, worker))
      if (imageAbortRef.current === controller) imageAbortRef.current = null
    },
    [patchImage],
  )

  const cancelImages = useCallback(() => {
    imageAbortRef.current?.abort()
    imageAbortRef.current = null
    setImages((prev) => prev.map((im) => (im.status === 'loading' ? { status: 'idle' } : im)))
  }, [])

  /** 参考图单独的状态更新：按 id 定位，并发时不会错位 */
  const patchReference = useCallback((id: string, patch: Partial<ReferenceImage>) => {
    setReferenceImages((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }, [])

  /**
   * 参考图：角色与场景各出一张，先于分镜图产出，后续每张分镜都带着它们去生成。
   *
   * 参考图**不拼 imageAnchor** —— 它本身就是锚的来源，拼了反而自我叠加。
   * 单张失败只影响那一张，不阻断其余参考图，也不阻断后续流程。
   */
  const generateReferenceImages = useCallback(
    async (setting: VisualSetting | null, current: Settings, opts: { only?: string[]; force?: boolean } = {}) => {
      const providerId = current.imageProvider
      if (!isAdapterAvailableOn(providerId, { native: IS_NATIVE })) return

      const cfg: ImageProviderConfig = current.imageConfigs[providerId] ?? { baseUrl: '', apiKey: '', model: '' }
      // 没 Key 就别把好几张参考图挨个发出去撞 401，直接告诉用户去补配置
      const apiKey = resolveImageApiKey(current, cfg)
      if (!apiKey) {
        setNotice(NO_IMAGE_KEY_NOTICE)
        return
      }

      const all = buildReferenceTargets(setting)
      const targets = opts.only ? all.filter((t) => opts.only?.includes(t.id)) : all
      // 重新生成单张时不能清空其余参考图的状态
      if (opts.only) {
        for (const t of targets) patchReference(t.id, { status: 'loading', error: undefined })
      } else {
        setReferenceImages(all.map((t) => ({ ...t, status: 'idle' as const })))
      }
      if (targets.length === 0) return

      const controller = new AbortController()
      referenceAbortRef.current?.abort()
      referenceAbortRef.current = controller

      let cursor = 0
      const worker = async () => {
        for (;;) {
          const slot = cursor++
          if (slot >= targets.length || controller.signal.aborted) return
          const target = targets[slot]
          patchReference(target.id, { status: 'loading', error: undefined })
          try {
            const res = await generateImage(
              {
                provider: providerId,
                prompt: target.prompt,
                baseUrl: cfg.baseUrl ?? '',
                apiKey,
                model: cfg.model ?? '',
                size: cfg.size,
                timeoutMs: imageTimeoutMs(cfg),
                force: opts.force === true,
              },
              controller.signal,
            )
            if (controller.signal.aborted) return
            patchReference(target.id, { status: 'success', url: res.url, cached: res.cached })
          } catch (err) {
            if (controller.signal.aborted || (err as DOMException)?.name === 'AbortError') return
            patchReference(target.id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, targets.length) }, worker))
      if (referenceAbortRef.current === controller) referenceAbortRef.current = null
    },
    [patchReference],
  )

  /** 单张参考图重新生成（force 跳过缓存，确保真的重出一张） */
  const regenerateReference = useCallback(
    (id: string) => {
      const setting = visualSettingRef.current
      void generateReferenceImages(setting, settings, { only: [id], force: true })
    },
    [generateReferenceImages, settings],
  )

  /** 批量：把还没成功的都生成一遍（已成功的不重复计费） */
  const generateAllImages = useCallback(() => {
    const pending = shots.map((_, i) => i).filter((i) => images[i]?.status !== 'success')
    if (pending.length === 0) return
    void generateImages(shots, settings, { only: pending })
  }, [generateImages, shots, settings, images])

  // 生成单条或重试（不带 force）：失败本就不计费，而缓存命中能省掉重复调用
  const requestImage = useCallback(
    (index: number, provider?: string) => {
      void generateImages(shots, settings, { only: [index], provider })
    },
    [generateImages, shots, settings],
  )

  // 「换一张」加 force：明确要重新生成，跳过缓存并另存新图（会重新计费）
  const regenerateImage = useCallback(
    (index: number, provider?: string) => {
      void generateImages(shots, settings, { only: [index], force: true, provider })
    },
    [generateImages, shots, settings],
  )

  /**
   * 产出统一视觉设定。
   *
   * **设定先行**：它必须早于分镜，因为分镜的 imagePrompt 要受它约束
   * （整组画面的角色、场景、画风是否统一，取决于分镜提示词有没有照着设定写）。
   * 代价是多等一次文本往返，这是统一性换来的必要开销。
   *
   * 返回设定对象，失败时返回 null —— 调用方据此决定要不要把设定注入分镜提示词。
   */
  const generateSetting = useCallback(async (): Promise<VisualSetting | null> => {
    setVisualSettingStatus('loading')
    setVisualSettingError(null)
    try {
      const vs = await generateVisualSetting({
        topic: form.topic.trim(),
        script: form.script.trim(),
        style: composeStyle(form.styleTags, form.style),
      })
      if (cancelledRef.current) return null
      visualSettingRef.current = vs
      setVisualSetting(vs)
      setVisualSettingStatus('success')
      return vs
    } catch (err) {
      // 设定失败不阻断主流程：降级为「无设定」继续，分镜与配图仍能各自生成
      if (cancelledRef.current) return null
      visualSettingRef.current = null
      setVisualSetting(null)
      setVisualSettingStatus('error')
      setVisualSettingError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [form])

  // 设定先行时 shots 可能还是空的（比如分镜生成失败了），所以不能再拿 shots 当守卫
  const retryVisualSetting = useCallback(() => {
    void generateSetting()
  }, [generateSetting])

  /**
   * 用户在结果区编辑统一视觉设定（主要改锚定提示词）后，点「应用并重新生成配图」：
   * 更新设定并重跑全部配图。锚定已变 → 拼接后的 prompt 变化 → 缓存键随之变化，会出新图。
   */
  const applyVisualSettingAndRegenerate = useCallback(
    (draft: VisualSetting) => {
      visualSettingRef.current = draft
      setVisualSetting(draft)
      setVisualSettingStatus('success')
      if (shots.length > 0) void generateImages(shots, settings)
    },
    [generateImages, shots, settings],
  )

  const generate = useCallback(async () => {
    if (!form.topic.trim() && !form.script.trim()) {
      setError('请至少填写「短剧主题」或「剧本」中的一项。')
      setStatus('error')
      return
    }

    const current = await loadSettings()
    // APK 是前端直连模型服务，必须自带 Key；桌面端/网页端可依赖界面设置或服务端配置
    if (IS_NATIVE && !current.apiKey) {
      setSettingsOpen(true)
      setError('请先在设置里填写模型服务的 API Key。')
      setStatus('error')
      return
    }

    cancelledRef.current = false
    setStatus('loading')
    setError(null)
    setNotice(null)
    setPhase('preparing')
    setProgress({ completed: 0, total: TOTAL_SHOTS, shots: [] })
    setImages([])
    setVisualSetting(null)
    setVisualSettingStatus('idle')
    setVisualSettingError(null)
    visualSettingRef.current = null
    // 参考图跟着设定走：换一部剧本就全部作废
    referenceAbortRef.current?.abort()
    referenceAbortRef.current = null
    setReferenceImages([])

    const controller = new AbortController()
    abortRef.current = controller
    // APK 拿不到流式信号（CapacitorHttp 不支持），阶段与条数都用本地时间表驱动；
    // 网页 / 桌面由服务端 SSE 推送真实值
    if (IS_NATIVE) nativeEstRef.current = createNativeEstimator(setPhase, { onProgress: handleProgress })

    try {
      // ---- 第一步：先产出统一视觉设定 ----
      // 必须 await —— 分镜提示词要用它约束，否则整组画面的角色/场景/画风就统一不起来。
      // APK 没有服务端，/api/visual-setting 走不通，直接跳过（那边只有文本直连）。
      let setting: VisualSetting | null = null
      if (!IS_NATIVE) {
        setPhase('preparing')
        setting = await generateSetting()
        if (cancelledRef.current) return
        // 参考图不 await：它是给后续分镜图当锚的，晚一点就绪也没关系，
        // 没必要让用户为了几张参考图多等一轮。生成完会自动回填到面板。
        void generateReferenceImages(setting, settings)
      }

      // ---- 第二步：带着设定生成分镜 ----
      const data = await generateStoryboard(
        {
          topic: form.topic.trim(),
          script: form.script.trim(),
          style: composeStyle(form.styleTags, form.style),
          visualSetting: setting,
        },
        {
          onPhase: IS_NATIVE ? undefined : setPhase,
          onProgress: IS_NATIVE ? undefined : handleProgress,
          signal: controller.signal,
        },
      )
      if (cancelledRef.current) return

      if (IS_NATIVE) nativeEstRef.current?.finish()

      // 让「正在整理结果」有机会被看见：结果与最后一个阶段信号几乎同时到达，
      // 不稍等一下的话进度组件会立刻卸载，四步清单的最后一步用户永远看不到。
      await new Promise((resolve) => setTimeout(resolve, 400))
      if (cancelledRef.current) return

      setShots(data.shots)
      setModel(data.model)
      // 配图不自动生成 —— 每张都要计费，交给用户在结果区按需触发
      setImages(data.shots.map(() => ({ status: 'idle' })))
      setStatus('success')
    } catch (err) {
      // 用户主动取消不算失败
      if (cancelledRef.current || (err as DOMException)?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    } finally {
      nativeEstRef.current?.stop()
      nativeEstRef.current = null
      abortRef.current = null
      setPhase(null)
    }
  }, [form, handleProgress, generateImages, generateSetting])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    abortRef.current?.abort()
    imageAbortRef.current?.abort()
    imageAbortRef.current = null
    referenceAbortRef.current?.abort()
    referenceAbortRef.current = null
    nativeEstRef.current?.stop()
    nativeEstRef.current = null
    abortRef.current = null
    setPhase(null)
    setImages((prev) => prev.map((im) => (im.status === 'loading' ? { status: 'idle' } : im)))
    // 有历史结果就保留（回到 success），否则回到空态
    setStatus(shots.length > 0 ? 'success' : 'idle')
    if (shots.length === 0) {
      setVisualSetting(null)
      setVisualSettingStatus('idle')
      setVisualSettingError(null)
    }
    // APK 的原生请求无法中止，只能丢弃结果——如实告诉用户，避免以为真的停了
    if (IS_NATIVE) setNotice('手机端无法中断已发出的请求，本次结果已忽略。')
  }, [shots.length])

  /**
   * 顶部「重新生成」。它会重新调用文本模型，之后配图需要用户重新按需生成，
   * 所以只在已经生成过配图时才需要确认（那部分会重新计费）。
   */
  const handleRetry = useCallback(() => {
    if (images.some((im) => im.status === 'success')) {
      setConfirmOpen(true)
      return
    }
    void generate()
  }, [images, generate])

  // 窄屏下结果区在输入区下方，生成时自动滚过去，让进度清单可见
  useEffect(() => {
    if (status !== 'loading') return
    if (!window.matchMedia('(max-width: 1023px)').matches) return
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [status])

  // Ctrl / Cmd + Enter 快捷生成
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && status !== 'loading') {
        e.preventDefault()
        void generate()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [generate, status])

  // 手机上必须自己填 Key（App 不再内置任何 Key，所以只有「没填」这一种状态需要引导）
  const needKey = IS_NATIVE && !settings.apiKey

  return (
    <div className="min-h-screen">
      <header className="bg-card/80 border-border sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-lg">
              <Clapperboard className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold leading-tight">短剧分镜生成器</h1>
              <p className="text-muted-foreground hidden truncate text-xs sm:block">
                一句话生成 5 条可直接开拍的横屏短剧分镜
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {model ? (
              <Badge variant="outline" className="text-muted-foreground hidden font-mono text-xs sm:inline-flex">
                {model}
              </Badge>
            ) : null}
            <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)} aria-label="设置">
              <SettingsIcon className="size-4" />
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {needKey ? (
          <div className="border-primary/30 bg-primary/5 mb-6 flex flex-col gap-1.5 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-primary flex shrink-0 items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4" />
              尚未设置 API Key
            </span>
            <span className="text-foreground/80 text-sm leading-relaxed">
              手机版需要你自己的 API Key 才能生成，点右上角「设置」填入即可，Key 只存在本机。
            </span>
          </div>
        ) : null}

        {notice ? (
          <div className="bg-muted/60 text-muted-foreground mb-6 flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-sm">
            <Info className="size-4 shrink-0" />
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-primary underline underline-offset-2"
            >
              知道了
            </button>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <InputPanel
            form={form}
            onChange={setForm}
            onSubmit={generate}
            onReset={() => setForm(EMPTY_FORM)}
            loading={status === 'loading'}
            phase={phase}
          />
          <div ref={resultsRef}>
            <ResultsPanel
              status={status}
              phase={phase}
              completed={progress.completed}
              total={progress.total}
              partialShots={progress.shots}
              estimated={IS_NATIVE}
              shots={shots}
              images={images}
              error={error}
              visualSetting={visualSetting}
              referenceImages={referenceImages}
              onRegenerateReference={regenerateReference}
              visualSettingStatus={visualSettingStatus}
              visualSettingError={visualSettingError}
              onApplyVisualSetting={applyVisualSettingAndRegenerate}
              meta={{
                topic: form.topic,
                script: form.script,
                // 导出模板是单行，这里用摘要而非 composeStyle 的多行结构化文本
                style: summarizeStyle(form.styleTags, form.style),
                model,
              }}
              onRetry={handleRetry}
              onCancel={cancel}
              onRetryVisualSetting={retryVisualSetting}
              onGenerateAllImages={generateAllImages}
              onRetryImage={requestImage}
              onRegenerateImage={regenerateImage}
              onCancelImages={cancelImages}
            />
          </div>
        </div>

        <footer className="text-muted-foreground mt-10 text-center text-xs">
          支持任意 OpenAI 兼容模型服务 · 按 Ctrl / ⌘ + Enter 快速生成
        </footer>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSaved={(next) => {
          setSettings(next)
          setModel(next.model)
        }}
      />

      {/* 重新生成会重新调用文本模型，已生成过的配图会随之作废，所以先确认 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新生成？</DialogTitle>
            <DialogDescription>
              这会重新调用文本模型生成 {shots.length || TOTAL_SHOTS} 条分镜。已生成的配图会作废，
              需要重新按需生成（配图按张计费）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setConfirmOpen(false)
                void generate()
              }}
            >
              确定重新生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
