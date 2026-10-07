import type { LucideIcon } from 'lucide-react'
import {
  Anchor,
  Aperture,
  Building,
  Camera,
  Contrast,
  Droplets,
  Eye,
  Feather,
  Film,
  Flame,
  Flower2,
  Focus,
  Gem,
  Heart,
  House,
  Mountain,
  MoveUp,
  Palette,
  PartyPopper,
  ScanEye,
  Snowflake,
  Sunrise,
  WandSparkles,
  Zap,
} from 'lucide-react'

export type StyleDimensionId = 'tone' | 'palette' | 'camera'
/** single：组内互斥；multi：平级可叠加；ranked：多选 + 上限 + 有序（第 1 个为主基调） */
export type StyleMode = 'single' | 'multi' | 'ranked'

export interface StyleOption {
  /** 同时用作选中态存储值与提交给模型的文案，保持中文可读以便直接拼接 */
  id: string
  label: string
  icon: LucideIcon
  /** 详细说明。只在按键区之外的说明区展示，不占用按键空间 */
  desc: string
}

export interface StyleDimension {
  id: StyleDimensionId
  title: string
  mode: StyleMode
  /** ranked 模式下的选取上限 */
  max?: number
  /** 该组一条都没选时，说明区显示的占位提示 */
  hint: string
  options: StyleOption[]
}

export const STYLE_DIMENSIONS: StyleDimension[] = [
  {
    id: 'tone',
    title: '题材调性',
    mode: 'ranked',
    max: 3,
    hint: '首个选中的是主基调，主导全片气质；其后为辅助元素。点「主 / 辅」徽标可互换主次。',
    options: [
      { id: '都市写实', label: '都市写实', icon: Building, desc: '现代都市生活质感，表演自然真实，场景贴近日常。' },
      { id: '古风唯美', label: '古风唯美', icon: Flower2, desc: '古典东方美学，服饰庭院讲究，画面含蓄有诗意。' },
      { id: '悬疑暗调', label: '悬疑暗调', icon: Eye, desc: '冷静压抑的叙事氛围，明暗强烈，悬念层层递进。' },
      { id: '甜宠清新', label: '甜宠清新', icon: Heart, desc: '明亮柔和的恋爱氛围，节奏轻快，互动甜而不腻。' },
      { id: '热血逆袭', label: '热血逆袭', icon: Flame, desc: '逆风翻盘的爽感，节奏凌厉，情绪爆发力十足。' },
      { id: '家庭伦理', label: '家庭伦理', icon: House, desc: '家长里短的现实冲突，对白生活化，情感张力拉满。' },
      { id: '玄幻仙侠', label: '玄幻仙侠', icon: WandSparkles, desc: '法术光影与超凡场景，构建磅礴的东方奇幻世界。' },
      { id: '轻松喜剧', label: '轻松喜剧', icon: PartyPopper, desc: '夸张的表演与幽默节奏，包袱密集，轻松解压。' },
    ],
  },
  {
    id: 'palette',
    title: '画面色调',
    mode: 'multi',
    hint: '可叠加多个色调，组合出想要的画面氛围。',
    options: [
      { id: '冷色调', label: '冷色调', icon: Snowflake, desc: '以蓝青为主的低饱和冷色，冷静疏离，适合悬疑职场。' },
      { id: '暖色调', label: '暖色调', icon: Sunrise, desc: '橙黄暖光包裹画面，温馨治愈，适合情感与家庭戏。' },
      { id: '高对比', label: '高对比', icon: Contrast, desc: '强烈的明暗反差，人物立体硬朗，戏剧张力突出。' },
      { id: '低饱和', label: '低饱和', icon: Droplets, desc: '灰调降饱和的克制观感，带着文艺与纪实的气息。' },
      { id: '高饱和', label: '高饱和', icon: Palette, desc: '色彩浓郁鲜艳，视觉冲击强，适合甜宠与喜剧。' },
      { id: '柔光雾面', label: '柔光雾面', icon: Feather, desc: '柔焦朦胧的光感，弱化锐利边缘，氛围梦幻温柔。' },
      { id: '赛博朋克', label: '赛博朋克', icon: Gem, desc: '紫青霓虹与强反光，未来都市的科技感与迷离夜感。' },
      { id: '复古胶片', label: '复古胶片', icon: Film, desc: '颗粒质感与褪色偏色，怀旧的胶片电影色彩。' },
    ],
  },
  {
    id: 'camera',
    title: '镜头语言',
    mode: 'multi',
    hint: '可叠加多种运镜与构图，塑造片子的节奏和质感。',
    options: [
      { id: '手持纪实', label: '手持纪实', icon: Camera, desc: '轻微晃动的手持跟拍，临场感强，真实不刻意。' },
      { id: '电影运镜', label: '电影运镜', icon: Aperture, desc: '推拉摇移顺滑讲究，注重构图与纵深，电影感十足。' },
      { id: '特写情绪', label: '特写情绪', icon: Focus, desc: '大量面部与细节特写，放大情绪，直击人物内心。' },
      { id: '大全景', label: '大全景', icon: Mountain, desc: '开阔的环境远景，交代空间与人物关系，气势恢宏。' },
      { id: '快剪节奏', label: '快剪节奏', icon: Zap, desc: '高频切换的短镜头，节奏凌厉，制造紧张与爽感。' },
      { id: '第一人称', label: '第一人称', icon: ScanEye, desc: '主观视角镜头，代入感强，让观众身临其境。' },
      { id: '稳定长镜', label: '稳定长镜', icon: Anchor, desc: '长镜头与固定机位，克制留白，真实中带着压迫感。' },
      { id: '低角度仰拍', label: '低角度仰拍', icon: MoveUp, desc: '自下而上的仰拍，人物显得高大，压迫感与力量感强。' },
    ],
  },
]

/** id 全局唯一前提下的反查表：风格 id -> 所属维度 */
const OPTION_DIMENSION = new Map<string, StyleDimension>(
  STYLE_DIMENSIONS.flatMap((dim) => dim.options.map((opt) => [opt.id, dim] as const)),
)

const TONE_DIMENSION = STYLE_DIMENSIONS.find((dim) => dim.id === 'tone')!
const TONE_IDS = new Set(TONE_DIMENSION.options.map((opt) => opt.id))

/** 题材组的选取上限，供 UI 与切换逻辑共用 */
export const TONE_MAX = TONE_DIMENSION.max ?? 3

const dimensionIdOf = (tag: string) => OPTION_DIMENSION.get(tag)?.id

/**
 * 按数组顺序取出题材项：第 1 个是主基调，其余为辅助元素。
 * 主次完全由数组顺序表达，色调/镜头的插入位置不影响判定。
 */
export function getToneTags(tags: string[] | undefined): string[] {
  return (tags ?? []).filter((tag) => TONE_IDS.has(tag))
}

/**
 * 切换一个风格标签：
 * - single：再点已选项＝取消；点同组其它项＝顶掉原项
 * - ranked：点击顺序即主次顺序；达上限则拒绝新增；取消主基调后剩余首个自动升主
 * - multi：直接增删
 */
export function toggleStyleTag(current: string[], id: string): string[] {
  const dim = OPTION_DIMENSION.get(id)
  if (!dim) return current

  const inGroup = (tag: string) => dim.options.some((opt) => opt.id === tag)
  const active = current.includes(id)

  if (dim.mode === 'single') {
    const withoutGroup = current.filter((tag) => !inGroup(tag))
    return active ? withoutGroup : [...withoutGroup, id]
  }

  if (dim.mode === 'ranked') {
    // 取消即移除；剩余题材天然按顺序顺位，第 2 个自动升为主基调
    if (active) return current.filter((tag) => tag !== id)
    const picked = current.filter((tag) => inGroup(tag))
    // 达上限时拒绝而不是顶替：顶替会静默销毁用户已有选择
    if (picked.length >= (dim.max ?? TONE_MAX)) return current
    return [...current, id]
  }

  return active ? current.filter((tag) => tag !== id) : [...current, id]
}

/**
 * 把某个已选题材提升为主基调（与当前主基调互换）。
 * 非题材 id、未选中、或本身已是主基调时原样返回。
 */
export function promoteToneTag(current: string[], id: string): string[] {
  if (!TONE_IDS.has(id) || !current.includes(id)) return current
  if (getToneTags(current)[0] === id) return current

  const rest = current.filter((tag) => tag !== id)
  const firstToneIndex = rest.findIndex((tag) => TONE_IDS.has(tag))
  const next = [...rest]
  // 插到题材子序列最前 → 成为主基调，原主基调顺位降为辅助
  if (firstToneIndex === -1) next.push(id)
  else next.splice(firstToneIndex, 0, id)
  return next
}

/**
 * 组装给模型看的「结构化多行风格说明」。
 * 题材按主 / 辅分行以强调权重，色调与镜头同组平级，自定义补充置末。
 * 空类别整行省略；全空返回空串。
 */
export function composeStyle(tags: string[] | undefined, custom: string): string {
  const list = tags ?? []
  const tones = getToneTags(list)
  const [primary, ...aux] = tones
  const palette = list.filter((tag) => dimensionIdOf(tag) === 'palette')
  const camera = list.filter((tag) => dimensionIdOf(tag) === 'camera')
  const note = custom.trim()

  const lines: string[] = []
  if (primary) lines.push(`题材主基调：${primary}`)
  if (aux.length) lines.push(`题材辅助元素：${aux.join('、')}`)
  if (palette.length) lines.push(`画面色调：${palette.join('、')}`)
  if (camera.length) lines.push(`镜头语言：${camera.join('、')}`)
  if (note) lines.push(`自定义补充：${note}`)
  return lines.join('\n')
}

/**
 * 面向人的单行风格摘要，用于结果区 meta 与 Markdown / JSON 导出。
 * 导出模板是单行（`- 风格：xxx`），所以不能直接用 composeStyle 的多行文本。
 */
export function summarizeStyle(tags: string[] | undefined, custom: string): string {
  const list = tags ?? []
  const tones = getToneTags(list)
  const palette = list.filter((tag) => dimensionIdOf(tag) === 'palette')
  const camera = list.filter((tag) => dimensionIdOf(tag) === 'camera')
  const note = custom.trim()

  const parts: string[] = []
  tones.forEach((tone, i) => parts.push(i === 0 ? `${tone}（主基调）` : tone))
  if (palette.length) parts.push(palette.join('、'))
  if (camera.length) parts.push(camera.join('、'))
  if (note) parts.push(note)
  return parts.join(' · ')
}
