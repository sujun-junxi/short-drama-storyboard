import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Aperture,
  Check,
  Copy,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  PersonStanding,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { shotToText } from '@/lib/export'
import { listImageAdaptersForUi } from '@/lib/api'
import { IS_NATIVE } from '@/lib/platform'
import type { ImageState, Shot } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useCopy } from '@/lib/useCopy'

/**
 * 配图用哪套配置。
 * 'auto' 是「跟随文本模型」：用文本模型的 API Key，服务商与地址仍取设置里的图片配置 ——
 * 多数人文本与图片用的是同一个账号，默认这样就不用再配一遍。
 */
export type ImageProviderChoice = 'auto' | string

interface ShotCardProps {
  shot: Shot
  index: number
  /** 配图状态。不传或为 undefined 时不渲染图片块。 */
  image?: ImageState
  /** 生成配图（未生成时）或重试（失败时）。不带 force，命中缓存不重复计费。 */
  onRequestImage?: (provider: ImageProviderChoice) => void
  /** 换一张：强制重新生成，会重新计费 */
  onRegenerateImage?: (provider: ImageProviderChoice) => void
}

const SELECT_CLASS =
  'border-border bg-background text-foreground focus:ring-ring h-8 rounded-md border px-2 text-xs outline-none focus:ring-1'

export function ShotCard({ shot, index, image, onRequestImage, onRegenerateImage }: ShotCardProps) {
  const { copiedKey, copy } = useCopy()
  const [previewOpen, setPreviewOpen] = useState(false)
  // 每张卡片各自记住选了哪套，互不干扰
  const [provider, setProvider] = useState<ImageProviderChoice>('auto')
  const label = `镜头 ${shot.shotNumber || index + 1}`

  // 直接用 shared 里的定义 —— APK 没有服务端，不能走接口拿
  const adapters = useMemo(() => listImageAdaptersForUi(IS_NATIVE), [])

  return (
    <div
      className="animate-fade-in-up border-border bg-card flex flex-col gap-4 rounded-xl border p-5 shadow-sm"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge className="bg-primary text-primary-foreground border-primary px-2.5 py-1 text-sm font-semibold tabular-nums">
            镜头 {shot.shotNumber || index + 1}
          </Badge>
          {shot.shotType ? (
            <Badge variant="outline" className="text-muted-foreground">
              {shot.shotType}
            </Badge>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => copy('shot', shotToText(shot, index))}
          aria-label="复制本条分镜"
          title="复制本条分镜"
        >
          {copiedKey === 'shot' ? <Check className="text-primary" /> : <Copy className="text-muted-foreground" />}
        </Button>
      </div>

      {/*
        图片框只在「已经开始生成」之后才出现 —— 未生成时用一个按钮代替，不提前占位。
        loading / success / error 三态共用同一个框，尺寸不跳变。
      */}
      {image && image.status !== 'idle' ? (
        <div className="border-border bg-muted/40 relative aspect-video w-full overflow-hidden rounded-lg border">
          {image.status === 'success' && image.url ? (
            <>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="group block h-full w-full cursor-zoom-in"
                aria-label={`查看${label}配图大图`}
              >
                <img
                  src={image.url}
                  alt={`${label}配图`}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </button>
              <button
                type="button"
                onClick={() => onRegenerateImage?.(provider)}
                title="换一张（会重新计费）"
                className="bg-background/80 text-foreground absolute right-2 bottom-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Sparkles className="size-3.5" />
                换一张
              </button>
            </>
          ) : image.status === 'loading' ? (
            <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-xs">正在生成配图…</span>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
              <AlertCircle className="text-destructive size-5" />
              <span className="text-foreground/80 text-xs leading-relaxed">{image.error || '配图生成失败'}</span>
              <Button variant="outline" size="sm" onClick={() => onRequestImage?.(provider)}>
                <RefreshCw />
                重试
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <Field icon={<ImageIcon className="size-3.5" />} label="画面描述" value={shot.sceneDescription} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field icon={<PersonStanding className="size-3.5" />} label="人物动作" value={shot.characterAction} />
        <Field icon={<MessageSquare className="size-3.5" />} label="台词 / 旁白" value={shot.dialogue} />
      </div>
      <Field
        icon={<Aperture className="size-3.5" />}
        label="画面提示词"
        value={shot.imagePrompt}
        mono
        onCopy={() => copy('prompt', shot.imagePrompt)}
        copied={copiedKey === 'prompt'}
      />

      {/* 未生成配图时，这里是卡片唯一的配图入口；模型选择就放在按钮旁边 */}
      {image?.status === 'idle' && onRequestImage ? (
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <span className="text-muted-foreground text-xs">还没有配图</span>
          <div className="flex items-center gap-2">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className={SELECT_CLASS}
              aria-label="选择配图使用的模型服务"
              title="选择配图使用的模型服务"
            >
              {/* 默认项：直接用设置里填的文本模型 API，不用再单独配一套 */}
              <option value="auto">跟随文本模型</option>
              {adapters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={() => onRequestImage(provider)}>
              <Sparkles />
              生成配图
            </Button>
          </div>
        </div>
      ) : null}

      {image?.url ? (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl p-2 sm:p-3">
            <DialogTitle className="sr-only">{label}配图</DialogTitle>
            <img src={image.url} alt={`${label}配图大图`} className="w-full rounded-lg" />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

interface FieldProps {
  icon: React.ReactNode
  label: string
  value: string
  mono?: boolean
  onCopy?: () => void
  copied?: boolean
}

function Field({ icon, label, value, mono, onCopy, copied }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide">
          {icon}
          {label}
        </span>
        {onCopy ? (
          <button
            type="button"
            onClick={onCopy}
            aria-label={`复制${label}`}
            title={`复制${label}`}
            className="text-muted-foreground hover:text-foreground -mr-1 rounded p-1 transition-colors"
          >
            {copied ? <Check className="text-primary size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        ) : null}
      </div>
      <p
        className={cn(
          'text-foreground/90 text-sm leading-relaxed whitespace-pre-wrap break-words',
          mono && 'bg-muted text-foreground/80 rounded-md border px-3 py-2 font-mono text-xs leading-6',
        )}
      >
        {value || '—'}
      </p>
    </div>
  )
}
