# 非视频创作工具接入方案

2026-10-07 本地编辑实验版：用户授权识字、抠图和拆层三个功能接入本地专用模型，接受安装与 CPU 处理耗时。请求、任务、SSE、图层和编辑文档字段沿用本文结构；真实生图主流程保留。识字使用 PP-OCRv5 ONNX，清字使用笔画蒙版和 LaMa；抠图使用 BiRefNet；拆层保留一次 Codex 前景分组，使用 SAM 2.1 分割、BiRefNet 透明度细化和 LaMa 背景修复。既有字体、字号、字距和旋转字段承接估算样式，不能声称恢复原设计源文件。以下历史效果记录不作为本版验收结论；本版必须用多类素材检查保留区像素、残字、接缝、独立显隐、原图保真和刷新恢复。

2026-10-07。目标保持为美图创作页全部非视频操作及交互同步；不以现有 MVP 能力代替完成标准。

## 已实测依据

进入用户已有咖啡会话，选中画板图片后出现浮动工具条：拆分图层、编辑文字（直接编辑 / 无痕改字）、AI 改图、AI 超清、工具（调整尺寸 / AI 无痕消除 / 抠图 / AI 扩图）、编辑。

- AI 改图进入独立状态：画笔、擦除、笔刷大小、撤销重做、重置、说明、取消和改图。实际涂抹后改图按钮从禁用变为启用。
- 调整尺寸进入裁剪状态：自由、原比例、自定比例、宽高、拖动裁剪边框、取消和裁剪。实际拖动左上角后宽高从 2048 变为 1771；取消未修改作品。
- 无痕消除也进入画笔选区状态；涂抹后按钮启用，尚未验证生成结果。
- AI 超清打开会员购买提示，未越过会员限制，不能声称已实测效果。
- 其余工具尚须实际操作；不能仅按菜单名猜内部交互。验证码和浏览器响应异常需恢复后继续。

证据：`output/playwright/designkit/ai-edit-mask-20261006.png`、`crop-interaction-20261006.png`。

## 沿用已有结构即可完成

去掉创作页“完整编辑器”跳转；图片操作围绕选中作品显示浮动工具条。编辑仍使用现有 EditorDocument；自由裁剪暂存框，仅点裁剪后更新画布尺寸和图层位置，取消不保存，撤销恢复。工具状态内不切换作品；基础编辑和导出无需新增接口。

## 用户已确认的数据结构

2026-10-07 用户明确同意本方案及后续字段和相关接入操作。基础图层已接入，图片工具任务继续按此结构实现；验证拦截时告知用户，由用户解除后继续实测。

### 场景、文字和图片属性补充

多画板使用 `CreationScene = { boards: { resultId: string; x: number; y: number }[]; viewport: { x: number; y: number; zoom: number }; selectedId: string | null; revision: number }`。GET/PATCH `/api/editor/scenes/:sessionId` 读写；坐标范围 ±100 万，缩放 .03–3，最多 2000 个画板，必须引用所属会话结果。旧会话默认空布局，无需改写旧文档。

EditorTextLayer 保留原字段，新增可选 `fontStyle: 'normal' | 'bold' | 'italic' | 'bold italic'`、`textDecoration: '' | 'underline' | 'line-through'`、`letterSpacing: -20..100`、`lineHeight: .5..5`。界面与服务端共用字体白名单 Microsoft YaHei、SimSun、SimHei、KaiTi、Arial、Georgia、Times New Roman。图片和素材图层可选 `adjustments: { brightness: -1..1; contrast: -100..100; saturation: -2..2; blur: 0..30 }`，四项必须齐全。未使用的旧文档不添加字段。

拆层内部模型返回严格 `{ objects: { name: string; x: number; y: number; width: number; height: number }[] }`，最多 8 个真实前景元素，第一项为主要商品，独立装饰按视觉元素分组。每项生成原尺寸透明图层，重叠边缘不重复叠加；整体重建背景，真实文字另建文字层。无文字拆层允许空文字数组，单独识字没有发现文字则提示添加文字。模型输出坐标和名称均校验，任何分析失败都不保存半份结果。

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

遮罩通过已有素材上传保存原尺寸 PNG：白色表示处理区域，黑色表示保留区域，服务器校验尺寸。局部生成后由应用按遮罩合成，保留区域不依赖模型自行保持。生成、识字和图层分析仍经过 AgentModelProvider 与 Codex CLI；不引入 API Key 或本地扩散模型。

### 完成验证

最新进展（2026-10-07 07:29，优先于以下阶段记录）：多画板、标题拖动、绝对缩放、布局/视口/选择持久化、文字放置与格式、斜向箭头、素材库、自有版式、调色和 PNG/JPG 导出已接入并进行真实交互验收。八类图片工具已有真实成功记录，保留像素与扩图原区域有逐像素检查；批量结果见 `data/runs/creation-flow-check-1791294990605/tool-quality-20261007.json`。拆层第一次隐藏装饰发现轮廓残留，第二次补全有接缝；第三次整体背景复测 `e1cb404b-4c1d-497c-8a27-9bc9db80af76` 已实际检查背景平滑、无残影，商品、散落咖啡豆和两行文字独立；移动撤销、显隐恢复与刷新均通过，证据 `split-smooth-background-final.json`。扩展字体、字距/行高实际持久化通过；最终构建、类型检查、ESLint 与 17 项自动测试通过。原 02:49 的“复测中”和“无限画板尚未接入”均为历史状态。

参考站本轮实际新增文字后出现可编辑文字和字体格式浮动条，模板/素材/图片库及分类可打开，导入菜单实际包含图片与视频，视频排除。证据 `output/playwright/designkit/text-and-materials-20261007.jpg`。参考页当前部分操作超时、超清存在会员提示，未越过限制；官方说明与实际操作证据分开记录。

当前进展（2026-10-07）：基础形状/画笔/上传素材图层、浮动工具条、独立自由裁剪和涂抹控制、图片工具任务、SSE、停止、重试、同会话及项目结果和编辑文档持久化已接入。扩图正在使用外扩边框和比例控制；无限多画板尚未接入。基础图层持久化回归及工具集成测试通过，全套 17 项自动测试通过。

真实改图任务 `3fd2bc82-690f-4160-a324-e3de0fac9e91` 成功：4725 个选区像素中 4724 个改变，781707 个保留区像素无差异。真实识字返回 `COFFEE / 每日一杯` 和文字图层；透明抠图也有真实结果，但首次蒙版边缘偏移、首次底图有笔画残留，已调整生成输入和清理边距，仍须复测，不计为效果验收通过。所有验收数据在独立目录 `data/runs/creation-flow-check-1791294990605/`。

参考站当前实际点过“直接编辑”，画板产生第二张咖啡结果，但该图片无可编辑文字，不能验证文字修改完整效果。隐藏验证码节点位于视口外，并非当前验证拦截；页面操作存在反复超时，已请用户检查是否可操作。参考超清被会员提示拦截；其他未完成的实测及效果验证保持待完成。

每项都要有参考页实测记录和本应用真实验收：入口、参数、取消、确认执行、处理中、成功回画板、失败重试、撤销与刷新恢复。智能拆层需证明图片内容拆为可独立移动的真实图层；超清需验证生成细节与尺寸；识字需验证原图文字识别和替换。视频排除，其余未达到验证要求的功能继续保持未完成状态。
