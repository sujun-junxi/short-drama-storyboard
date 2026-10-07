import { ClipboardPaste, Loader2, RotateCcw, Sparkles } from 'lucide-react'

import { StylePicker } from '@/components/StylePicker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { PHASE_META, type GeneratePhase } from '@/lib/progress'
import { splitTopicAndScript } from '@/lib/split-input'

export interface FormState {
  topic: string
  script: string
  /** 自由输入的风格补充文本，与点选的 styleTags 解耦 */
  style: string
  /** 点选产生的风格标签，按维度组合 */
  styleTags: string[]
  /** 快速粘贴框的原文，只用于回显与重新拆分，不参与生成 */
  quickPaste: string
}

export const EMPTY_FORM: FormState = { topic: '', script: '', style: '', styleTags: [], quickPaste: '' }

interface InputPanelProps {
  form: FormState
  onChange: (next: FormState) => void
  onSubmit: () => void
  onReset: () => void
  loading: boolean
  /** 生成中的阶段，用于让窄屏用户不滚动也能看到进度 */
  phase?: GeneratePhase | null
}

export function InputPanel({ form, onChange, onSubmit, onReset, loading, phase }: InputPanelProps) {
  const canSubmit = !loading && (form.topic.trim() !== '' || form.script.trim() !== '')

  const update = (patch: Partial<FormState>) => onChange({ ...form, ...patch })

  /**
   * 粘贴框变化时立即拆分并填入下面两个字段。
   * 只在粘贴框自身变化时触发 —— 用户手动改下面字段不会被覆盖回去。
   * 清空粘贴框不动作，避免连带清掉用户已经调好的内容。
   */
  const onQuickPaste = (value: string) => {
    if (!value.trim()) {
      update({ quickPaste: value })
      return
    }
    const { topic, script } = splitTopicAndScript(value)
    update({ quickPaste: value, topic, script })
  }

  return (
    <Card className="lg:sticky lg:top-24">
      <CardHeader>
        <CardTitle className="text-base">创作输入</CardTitle>
        <CardDescription>主题和剧本至少填一项，风格决定画面调性。</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="quick-paste" className="flex items-center gap-1.5">
              <ClipboardPaste className="size-3.5" />
              快速粘贴
            </Label>
            {form.quickPaste.trim() !== '' ? (
              <button
                type="button"
                onClick={() => update({ quickPaste: '' })}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                清空粘贴框
              </button>
            ) : null}
          </div>
          <Textarea
            id="quick-paste"
            value={form.quickPaste}
            onChange={(e) => onQuickPaste(e.target.value)}
            placeholder="粘贴主题与剧情，自动拆分到下方两个字段"
            className="min-h-28"
            maxLength={5000}
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            会先认「主题：」「剧情：」这类标记；没有标记时把首行当主题、其余当剧情。
            拆完仍可在下面手动调整。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="topic">短剧主题</Label>
          <Input
            id="topic"
            value={form.topic}
            onChange={(e) => update({ topic: e.target.value })}
            placeholder="如：都市逆袭 / 婆媳过招 / 悬疑反转"
            maxLength={60}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="script">剧本</Label>
            <span className="text-muted-foreground text-xs tabular-nums">{form.script.length} 字</span>
          </div>
          <Textarea
            id="script"
            value={form.script}
            onChange={(e) => update({ script: e.target.value })}
            placeholder="粘贴剧情梗概、小说片段或分场大纲。留空则由大模型根据主题原创剧情。"
            className="min-h-40"
            maxLength={4000}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="style">风格偏好</Label>
            {(form.styleTags?.length ?? 0) > 0 || form.style.trim() !== '' ? (
              <button
                type="button"
                onClick={() => update({ style: '', styleTags: [] })}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                清空风格
              </button>
            ) : null}
          </div>
          <Input
            id="style"
            value={form.style}
            onChange={(e) => update({ style: e.target.value })}
            placeholder="自定义补充，如：暖调电影感、手持纪实"
            maxLength={40}
          />
          <StylePicker
            value={form.styleTags ?? []}
            onChange={(tags) => update({ styleTags: tags })}
            className="pt-1"
          />
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <Button onClick={onSubmit} disabled={!canSubmit} size="lg" className="w-full">
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                {phase ? `${PHASE_META[phase].label}…` : '正在生成 5 条分镜…'}
              </>
            ) : (
              <>
                <Sparkles />
                生成分镜
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onReset} disabled={loading}>
            <RotateCcw />
            清空输入
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
