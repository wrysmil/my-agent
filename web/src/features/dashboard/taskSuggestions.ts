/**
 * Dashboard 任务卡片常量与类型。
 *
 * 来源：spec § 4.3 .ai-runtime-artifacts/specs/2026-08-09-chat-composer-redesign-spec.md
 * 落地：plan § Step 1.1 .ai-runtime-artifacts/plans/2026-08-09-chat-composer-redesign-plan.md
 *
 * 本期 8 条写死任务；通过 useTaskSuggestions hook 可被远程 GET /api/task-suggestions 覆盖。
 */

export type TaskCategory =
  | 'research'
  | 'video'
  | 'image'
  | 'design'
  | 'office'
  | 'writing'
  | 'development'
  | 'growth';

export type TaskIconName =
  | 'Search'
  | 'Video'
  | 'Image'
  | 'Palette'
  | 'FileSpreadsheet'
  | 'PenLine'
  | 'Code'
  | 'TrendingUp';

export interface TaskSuggestion {
  /** 唯一 key（i18n 用，也是常量数组的 key） */
  id: string;
  /** 类别，决定图标与底色 */
  category: TaskCategory;
  /** i18n key，落在 dashboard.tasks.{id}.title / description / deliverable */
  titleKey: string;
  descriptionKey: string;
  deliverableKey: string;
  /** 点击卡片 → 填入 Composer 的 prompt（zh 模板；en 由 i18n 处理描述文案，但 prompt 始终是中文） */
  prompt: string;
  /** Lucide 图标名（避免运行时引入全部图标，按需 import） */
  iconName: TaskIconName;
}

/** 本期写死 8 条；后续接入 GET /api/task-suggestions 后可被覆盖 */
export const TASK_SUGGESTIONS: readonly TaskSuggestion[] = [
  {
    id: 'research',
    category: 'research',
    titleKey: 'dashboard.tasks.research.title',
    descriptionKey: 'dashboard.tasks.research.description',
    deliverableKey: 'dashboard.tasks.research.deliverable',
    prompt: '研究开源 AI 桌面应用',
    iconName: 'Search',
  },
  {
    id: 'video',
    category: 'video',
    titleKey: 'dashboard.tasks.video.title',
    descriptionKey: 'dashboard.tasks.video.description',
    deliverableKey: 'dashboard.tasks.video.deliverable',
    prompt: '制作一条 AI 发展趋势科普视频',
    iconName: 'Video',
  },
  {
    id: 'image',
    category: 'image',
    titleKey: 'dashboard.tasks.image.title',
    descriptionKey: 'dashboard.tasks.image.description',
    deliverableKey: 'dashboard.tasks.image.deliverable',
    prompt: '设计城市夏日咖啡节活动海报：8 月 16 日 14:00–20:00，城市中央广场，包含手冲体验、咖啡市集和限定特调。',
    iconName: 'Image',
  },
  {
    id: 'design',
    category: 'design',
    titleKey: 'dashboard.tasks.design.title',
    descriptionKey: 'dashboard.tasks.design.description',
    deliverableKey: 'dashboard.tasks.design.deliverable',
    prompt: '设计个人记账应用登录注册 UI',
    iconName: 'Palette',
  },
  {
    id: 'office',
    category: 'office',
    titleKey: 'dashboard.tasks.office.title',
    descriptionKey: 'dashboard.tasks.office.description',
    deliverableKey: 'dashboard.tasks.office.deliverable',
    prompt: '制作一份电商销售月报',
    iconName: 'FileSpreadsheet',
  },
  {
    id: 'writing',
    category: 'writing',
    titleKey: 'dashboard.tasks.writing.title',
    descriptionKey: 'dashboard.tasks.writing.description',
    deliverableKey: 'dashboard.tasks.writing.deliverable',
    prompt: '写一篇 AI 办公助手推荐社媒文章',
    iconName: 'PenLine',
  },
  {
    id: 'development',
    category: 'development',
    titleKey: 'dashboard.tasks.development.title',
    descriptionKey: 'dashboard.tasks.development.description',
    deliverableKey: 'dashboard.tasks.development.deliverable',
    prompt: '制作产品设计师个人作品集网站',
    iconName: 'Code',
  },
  {
    id: 'growth',
    category: 'growth',
    titleKey: 'dashboard.tasks.growth.title',
    descriptionKey: 'dashboard.tasks.growth.description',
    deliverableKey: 'dashboard.tasks.growth.deliverable',
    prompt: '为 orkas.ai 制定 SEO 与 GEO 方案',
    iconName: 'TrendingUp',
  },
] as const;

/** TaskSuggestion / TaskCategory / TaskIconName 的白名单（测试 + 运行时校验用） */
export const TASK_IDS = TASK_SUGGESTIONS.map((t) => t.id);
export const TASK_CATEGORIES: readonly TaskCategory[] = [
  'research',
  'video',
  'image',
  'design',
  'office',
  'writing',
  'development',
  'growth',
] as const;
export const TASK_ICON_NAMES: readonly TaskIconName[] = [
  'Search',
  'Video',
  'Image',
  'Palette',
  'FileSpreadsheet',
  'PenLine',
  'Code',
  'TrendingUp',
] as const;