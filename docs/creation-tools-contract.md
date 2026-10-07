# 非视频创作工具接口契约

创作页全部非视频工具与实际交互属于验收范围。基础编辑使用同一 EditorDocument，图片工具使用独立任务；生成、停止、重试与刷新恢复保持既有数据流。公共字段和校验以 `packages/shared/src/index.ts` 为准。

当前分支识字与抠图在本地执行；拆层只经 Codex 做一次前景语义分组，再用本地模型提取像素与修复背景。整图生成、复杂改图、消除、无痕改字、超清和扩图仍使用 Codex，所有模型处理经过 AgentModelProvider。安装与质量边界见 [本地图片工具](local-image-tools.md)。

## 功能与处理方式

下表描述当前实现，Codex 生图调用需要联网并消耗账户额度；“本地”包含在本机运行的专用 AI 模型，不代表完全不用 AI。

| 功能 | 作用与输出 | 当前处理方式 |
| --- | --- | --- |
| 商品图、商品套图、详情模块 | 根据素材与要求生成场景，保存整张图片 | Codex 生图；本地工具适配尺寸，套图和详情模块另用 Sharp/SVG 合成底部标题、文案 |
| AI 改图（`edit`） | 按描述修改整图或选区，得到新图片 | Codex 生图；有遮罩时由应用合成，保留选区外像素 |
| 无痕消除（`erase`） | 移除涂抹区域的物体或文字并补背景，得到新图片 | Codex 生图后按遮罩合成 |
| 无痕改字（`replace-text`） | 按输入内容重绘选区文字，文字仍是图片像素 | Codex 生图后按遮罩合成，不生成独立文字层 |
| AI 超清（`upscale`） | 请求增强细节并输出 2 倍或 4 倍尺寸的新图片 | Codex 生图后适配目标尺寸，当前未接入本地超分模型 |
| AI 扩图（`expand`） | 扩大画布并补充外围场景，得到新图片 | Codex 生图，再将原图合成回原位置，保留原图区域 |
| 编辑文字 → 直接编辑（`recognize-text`） | 识别原文字、清除底图文字，创建可改内容和样式的独立文字层 | 本地 PP-OCRv5/RapidOCR、OpenCV 笔画蒙版、LaMa 背景修复，不调用 Codex |
| 抠图（`cutout`） | 提取主体透明图片，保留原图 RGB | 本地 BiRefNet 预测透明度，不调用 Codex、不重绘商品 |
| 拆分图层（`split-layers`） | 得到背景、可见商品/装饰及识别出的文字层 | 本地清字 → 一次 Codex 前景语义分析 → 本地 SAM 2.1/BiRefNet 分割与 LaMa 补背景，不调用 Codex 生图 |
| 基础编辑与导出 | 新增文字、图片、形状、画笔、裁剪、调色、图层操作及 PNG/JPG 下载 | Konva/Sharp 等确定性处理，不调用 Codex |

需求理解、参数整理、计划、文案和质量检查仍可调用 Codex 文本/视觉分析；这些调用不等于生图。当前生图接口返回整张位图，没有直接返回原生文字、商品、形状图层；套图/详情的程序排版文字也合成进图片。手动新增的设计图层按 EditorDocument 保存，图片内原有文字和物体需按需提取。

“无痕”和“超清”是功能目标，不保证任意图片都能无接缝处理或恢复真实细节。模型改图、改字和超清仍可能改变选区内的商品细节或字形；本地 LaMa 也会生成缺失背景，无法恢复被遮挡内容的真实原貌。下载的尺寸倍率只缩放输出，与 AI 超清的模型处理不同。

## 数据结构

### 场景、文字和图片属性补充

多画板使用 `CreationScene = { boards: { resultId: string; x: number; y: number }[]; viewport: { x: number; y: number; zoom: number }; selectedId: string | null; revision: number }`。GET/PATCH `/api/editor/scenes/:sessionId` 读写；坐标范围 ±100 万，缩放 .03–3，最多 2000 个画板，必须引用所属会话结果。旧会话默认空布局，无需改写旧文档。

EditorTextLayer 保留原字段，新增可选 `fontStyle: 'normal' | 'bold' | 'italic' | 'bold italic'`、`textDecoration: '' | 'underline' | 'line-through'`、`letterSpacing: -20..100`、`lineHeight: .5..5`。界面与服务端共用字体白名单 Microsoft YaHei、SimSun、SimHei、KaiTi、Arial、Georgia、Times New Roman。图片和素材图层可选 `adjustments: { brightness: -1..1; contrast: -100..100; saturation: -2..2; blur: 0..30 }`，四项必须齐全。未使用的旧文档不添加字段。

拆层语义分析返回严格 `{ objects: { name: string; x: number; y: number; width: number; height: number }[] }`，最多 8 个真实前景元素，第一项为主要商品，其余每项是具有明确闭合轮廓的独立可见元素，不合并分散装饰。阴影、倒影、地面纹理、背景渐变与环境光效留在背景。每项提取原尺寸透明图层，重叠边缘不重复叠加；本地修复背景，真实文字另建文字层。无文字拆层允许空文字数组，单独识字没有发现文字则提示添加文字。模型输出坐标和名称均校验，任何分析失败都不保存半份结果。

工具聚合 SSE：`/api/image-tools/tasks/session/:sessionId/events`；保留单任务 SSE 接口。下载 PNG/JPG 与尺寸倍率由同一画布导出，无新增业务任务；倍率是输出尺寸，AI 超清仍走真实图像任务。

### 编辑图层

保留图片、文字与公共变换字段。新增两个联合类型：

```ts
interface EditorShapeLayer extends EditorLayerBase {
  type: 'shape';
  shape: 'rectangle' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow';
  fill: string;
  stroke: string;
  strokeWidth: number;
}
interface EditorPathLayer extends EditorLayerBase {
  type: 'path';
  points: number[]; // 图层局部坐标，x/y 成对
  stroke: string;
  strokeWidth: number;
}
```

图片图层改为明确的互斥来源：现有 `{ type: 'image', resultId }` 保留；上传图片使用 `{ type: 'asset-image', assetId }`，其余公共字段相同。不从名称、路径猜来源。颜色允许 `transparent` 或六位十六进制；图层数继续最多 50。

### 图片工具任务

独立图片工具任务沿用等待、运行、成功、失败、取消状态；不把直接工具点击转成再次填写聊天方案。

```ts
type ImageToolInput =
  | { operation: 'edit'; sourceAssetId: string; maskAssetId: string | null; prompt: string }
  | { operation: 'erase'; sourceAssetId: string; maskAssetId: string }
  | { operation: 'replace-text'; sourceAssetId: string; maskAssetId: string; text: string }
  | { operation: 'cutout'; sourceAssetId: string }
  | { operation: 'upscale'; sourceAssetId: string; scale: 2 | 4 }
  | { operation: 'expand'; sourceAssetId: string; width: number; height: number; x: number; y: number; prompt: string }
  | { operation: 'split-layers' | 'recognize-text'; sourceAssetId: string };
interface ImageToolTask {
  id: string;
  sessionId: string;
  resultId: string; // 操作的原作品，用于归属和刷新恢复
  input: ImageToolInput;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  outputResultIds: string[];
  outputLayers: EditorLayer[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`POST /api/image-tools/tasks` 接收 `{ sessionId, resultId, input }`；GET 列表按 sessionId，GET 单任务、SSE、取消和重试复用既有任务设计。输出图片复用 ProductImageResult 和现有文件接口；拆层与识字返回可编辑图层，真实图片来源逐项校验。不得以加一层文字冒充识字，不得以 CSS 放大冒充超清。

遮罩通过已有素材上传保存原尺寸 PNG：白色表示处理区域，黑色表示保留区域，服务器校验尺寸。局部生成后由应用按遮罩合成，保留区域不依赖模型自行保持。生成、识字和图层分析统一经过 AgentModelProvider；本地工具环境缺失或处理失败时明确报错，不静默回退到生图。

## 验收要求

每项工具按实际入口检查参数、执行、停止、处理中、成功回画板、失败重试、撤销和刷新恢复。直接编辑文字、抠图和拆层点击入口即提交；改图、消除、无痕改字需完成选区及所需输入，超清和扩图需完成参数后执行，不额外转成聊天方案确认。处理原图使用当前编辑画面，成功输出校验真实图片与所属会话，结果和编辑文档在完成事务中保存；失败不落半份结果。

拆层需产生可独立移动、显隐的真实背景、商品、装饰和文字图层，并检查前景保真、重合及背景残留。识字需识别真实内容、清除底图文字并保存可编辑文字；字体估算不等于还原原设计。超清检查输出尺寸与真实细节，局部处理检查保留区像素，扩图检查原图区域。

本地模型使用多类素材验证，历史 Codex 图片工具效果不能替代当前处理链路的验收。参考实测来源见 [参考索引](references/designkit/index.md)，尚未完成的效果与交互检查见 [剩余事项](../handoff.md)。
