import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { listImageAdaptersForUi, testConnection } from '@/lib/api'
import { IS_NATIVE, PLATFORM, PLATFORM_LABEL } from '@/lib/platform'
import { CUSTOM_PROVIDER_ID, PROVIDERS, findProviderByBaseUrl, getProviderById, modelSuggestionsFor } from '@/lib/providers'
import { defaultImageConfig, saveSettings, type ImageProviderConfig, type Settings } from '@/lib/settings'

/** 与项目其它表单一致的 h-9 输入框样式 */
const FIELD_CLASS =
  'border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]'

/** 区块小标题 */
function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-foreground text-sm font-semibold">{children}</h3>
      {right}
    </div>
  )
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Settings
  onSaved: (next: Settings) => void
}

export function SettingsDialog({ open, onOpenChange, settings, onSaved }: SettingsDialogProps) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [providerId, setProviderId] = useState<string>(CUSTOM_PROVIDER_ID)
  const [revealed, setRevealed] = useState(false)
  const [revealedImage, setRevealedImage] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  // 服务商列表直接取自 shared 里的适配器定义 —— APK 没有服务端，不能走接口拿
  const adapters = useMemo(() => listImageAdaptersForUi(IS_NATIVE), [])

  useEffect(() => {
    if (open) {
      setDraft(settings)
      setProviderId(findProviderByBaseUrl(settings.baseUrl)?.id ?? CUSTOM_PROVIDER_ID)
      setMessage(null)
      setRevealed(false)
      setRevealedImage(false)
    }
  }, [open, settings])

  const provider = getProviderById(providerId)
  const modelSuggestions = useMemo(() => modelSuggestionsFor(providerId), [providerId])

  const activeAdapter = adapters.find((a) => a.id === draft.imageProvider)
  const imageModelSuggestions = activeAdapter?.models ?? []
  const imageConfig: ImageProviderConfig =
    draft.imageConfigs[draft.imageProvider] ?? defaultImageConfig(draft.imageProvider)

  const patch = (next: Partial<Settings>) => setDraft((d) => ({ ...d, ...next }))

  const patchImageConfig = (next: Partial<ImageProviderConfig>) => {
    setDraft((d) => {
      const current = d.imageConfigs[d.imageProvider] ?? defaultImageConfig(d.imageProvider)
      return { ...d, imageConfigs: { ...d.imageConfigs, [d.imageProvider]: { ...current, ...next } } }
    })
  }

  const onProviderChange = (id: string) => {
    setProviderId(id)
    const preset = getProviderById(id)
    if (!preset) return // 自定义：保留当前地址，允许自由编辑
    setDraft((d) => ({
      ...d,
      baseUrl: preset.baseUrl,
      model: preset.models.includes(d.model) ? d.model : (preset.models[0] ?? d.model),
    }))
  }

  const onBaseUrlChange = (value: string) => {
    const matched = findProviderByBaseUrl(value)
    setProviderId(matched ? matched.id : CUSTOM_PROVIDER_ID)
    patch({ baseUrl: value })
  }

  /** 切换图片服务商时带出那家已存的配置；没有就用适配器默认值建一份 */
  const onImageProviderChange = (id: string) => {
    setDraft((d) => ({
      ...d,
      imageProvider: id,
      imageConfigs: { ...d.imageConfigs, [id]: d.imageConfigs[id] ?? defaultImageConfig(id) },
    }))
  }

  const persist = async () => {
    const next: Settings = {
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      imageProvider: draft.imageProvider,
      imageConfigs: draft.imageConfigs,
    }
    await saveSettings(next)
    onSaved(next)
    setMessage({ tone: 'ok', text: '已保存到本机' })
  }

  const runTest = async () => {
    if (!draft.apiKey.trim()) {
      setMessage({ tone: 'err', text: '请先填写 API Key' })
      return
    }
    setTesting(true)
    setMessage(null)
    try {
      await testConnection({
        apiKey: draft.apiKey.trim(),
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
      })
      setMessage({ tone: 'ok', text: '文本模型连接成功，配置可用 ✓' })
    } catch (err) {
      setMessage({ tone: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            当前运行环境：{PLATFORM_LABEL[PLATFORM]}。文本模型支持任意 OpenAI 兼容服务，配图可选多家文生图服务。配置只保存在本机。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto py-4">
          {/* ---------------- 文本模型 ---------------- */}
          <section className="flex flex-col gap-4">
            <SectionTitle>文本模型</SectionTitle>

            <div className="flex flex-col gap-2">
              <Label htmlFor="setting-provider">模型服务商</Label>
              <select
                id="setting-provider"
                value={providerId}
                onChange={(e) => onProviderChange(e.target.value)}
                className={FIELD_CLASS}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM_PROVIDER_ID}>自定义（OpenAI 兼容）</option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="setting-base-url">接口地址</Label>
              <Input
                id="setting-base-url"
                value={draft.baseUrl}
                onChange={(e) => onBaseUrlChange(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-muted-foreground text-xs">
                以 <code className="font-mono">/v1</code> 之类结尾，不要带{' '}
                <code className="font-mono">/chat/completions</code>。仅支持 OpenAI 兼容协议。
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="setting-key">API Key</Label>
              <div className="relative">
                <Input
                  id="setting-key"
                  type={revealed ? 'text' : 'password'}
                  value={draft.apiKey}
                  onChange={(e) => patch({ apiKey: e.target.value })}
                  placeholder="sk-xxxxxxxxxxxxxxxx"
                  className="pr-10 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition-colors"
                  aria-label={revealed ? '隐藏 Key' : '显示 Key'}
                >
                  {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              <p className="text-muted-foreground text-xs">
                {provider?.keyUrl ? (
                  <>
                    在{' '}
                    <a
                      href={provider.keyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      {provider.label}控制台
                    </a>{' '}
                    创建。Key 只保存在这台设备上。
                  </>
                ) : (
                  'Key 只保存在这台设备上。'
                )}
              </p>
              {provider?.hint ? <p className="text-muted-foreground text-xs">{provider.hint}</p> : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="setting-model">模型名称</Label>
              <Input
                id="setting-model"
                list="setting-model-options"
                value={draft.model}
                onChange={(e) => patch({ model: e.target.value })}
                placeholder="例如 qwen-plus / gpt-4o-mini / deepseek-chat"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="setting-model-options">
                {modelSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <p className="text-muted-foreground text-xs">可直接输入任意模型名，也可以从建议里选。</p>
            </div>
          </section>

          {/* ---------------- 图片模型 ---------------- */}
          <section className="border-border flex flex-col gap-4 border-t pt-4">
            <SectionTitle>图片模型</SectionTitle>

            <p className="text-muted-foreground text-xs leading-relaxed">
              配图不会自动生成 —— 文字分镜出来后，在结果区点「生成全部配图」或单张卡片上的「生成配图」。
              每张图都按次计费，用多少算多少。
            </p>

            <div className="flex flex-col gap-2">
              <Label htmlFor="setting-image-provider">图片服务商</Label>
              <select
                id="setting-image-provider"
                value={draft.imageProvider}
                onChange={(e) => onImageProviderChange(e.target.value)}
                className={FIELD_CLASS}
              >
                {adapters.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="setting-image-base">图片接口地址</Label>
              <Input
                id="setting-image-base"
                value={imageConfig.baseUrl}
                onChange={(e) => patchImageConfig({ baseUrl: e.target.value })}
                placeholder={activeAdapter?.defaultBaseUrl ?? 'https://dashscope.aliyuncs.com'}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              {activeAdapter?.baseUrlHint ? (
                <p className="text-muted-foreground text-xs">{activeAdapter.baseUrlHint}</p>
              ) : null}
            </div>

            {/* 单张超时：云端高峰期会明显变慢 */}
            {activeAdapter ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="setting-image-timeout">单张超时（秒）</Label>
                <Input
                  id="setting-image-timeout"
                  type="number"
                  min={30}
                  max={3600}
                  value={imageConfig.timeoutSeconds === undefined ? '' : String(imageConfig.timeoutSeconds)}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    if (!raw) {
                      patchImageConfig({ timeoutSeconds: undefined })
                      return
                    }
                    const n = Number(raw)
                    patchImageConfig({ timeoutSeconds: Number.isFinite(n) && n > 0 ? n : undefined })
                  }}
                  placeholder="180"
                  className="font-mono"
                  autoComplete="off"
                />
                <p className="text-muted-foreground text-xs">
                  默认 180 秒，可填 30~3600。云端模型在高峰期会明显变慢，可以调大；
                  超时只影响等待，不会影响已经提交的任务。
                </p>
              </div>
            ) : null}

            {activeAdapter?.needsKey !== false ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="setting-image-key">图片 API Key</Label>
                <div className="relative">
                  <Input
                    id="setting-image-key"
                    type={revealedImage ? 'text' : 'password'}
                    value={imageConfig.apiKey}
                    onChange={(e) => patchImageConfig({ apiKey: e.target.value })}
                    placeholder="留空则复用上面文本模型的 Key"
                    className="pr-10 font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setRevealedImage((v) => !v)}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition-colors"
                    aria-label={revealedImage ? '隐藏 Key' : '显示 Key'}
                  >
                    {revealedImage ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-muted-foreground text-xs">
                  留空即复用文本模型的 Key（多数人文本与配图用的是同一个百炼 Key）。
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="setting-image-model">图片模型</Label>
              <Input
                id="setting-image-model"
                list="setting-image-model-options"
                value={imageConfig.model}
                onChange={(e) => patchImageConfig({ model: e.target.value })}
                placeholder={activeAdapter?.defaultModel || '例如 wan2.7-image-pro'}
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="setting-image-model-options">
                {imageModelSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <p className="text-muted-foreground text-xs">
                可直接输入任意模型名。尺寸写法各家不同（百炼用{' '}
                <code className="font-mono">1920*1080</code>，OpenAI 兼容用{' '}
                <code className="font-mono">1536x1024</code>），已按服务商预置好。
              </p>
            </div>

            {/* 尺寸统一下拉到横屏：全项目只留横屏画幅 */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="setting-image-size">图片尺寸</Label>
              <select
                id="setting-image-size"
                value={imageConfig.size ?? activeAdapter?.defaultSize ?? ''}
                disabled={!activeAdapter}
                onChange={(e) => patchImageConfig({ size: e.target.value })}
                className={FIELD_CLASS}
              >
                {(activeAdapter?.sizeOptions ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {message ? (
            <p className={message.tone === 'ok' ? 'text-primary text-xs' : 'text-destructive text-xs'}>{message.text}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={runTest} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            测试文本连接
          </Button>
          <Button size="sm" onClick={persist}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
