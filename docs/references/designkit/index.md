# 美图设计室 PC 页面参考索引

## 采集范围

- 采集日期：2026-10-05 至 2026-10-10。
- 公开页面视口：1440 × 1000；登录后观察使用用户已有咖啡创作记录。
- 原始截图目录：`output/playwright/designkit/`。
- 用途：确认信息架构、布局比例、操作入口和真实状态，截图仅作内部参考。
- 不绕过登录、验证码或付费限制；超清只观察到会员提示，未实测效果。先前部分浏览器操作超时，不能判定为验证码。

## 创作页现场观察

| 区域 | 观察依据 |
| --- | --- |
| 对话与输入 | 登录后咖啡会话；方案与附件、逐轮缩略图 |
| 图片浮动操作 | 拆层、编辑文字、改图、超清、工具、编辑 |
| 改图与消除 | 实际涂抹、画笔/擦除/大小/撤销/重做/重置、按钮启用 |
| 裁剪与扩图 | 九宫格、比例、宽高、边框拖动、取消 |
| 文字控制 | 底部 T 新增文字；10 月 10 日在已登录会话完成原图识字、双击标题、修改及恢复；浮动栏提供字体、字号、颜色和文字样式 |
| 底部形状和画笔 | 创作会话菜单已打开；10 月 7 日公共编辑器补验单箭头拖动与反向矩形拖动，均产生独立可选图形 |
| 素材库 | 模板/素材/图片、搜索及多种分类实际可见 |
| 多作品场景 | 真实会话多图、抓手/缩放/定位入口 |
| 图片属性 | 官方图片流程提供色彩调整等编辑能力 |
| 下载 | 公共编辑器实测 PNG/JPG；JPG 提供 100/80/70/50/20% 压缩质量，实际下载要求登录 |
| 拆层效果 | [官方图层拆分](https://www.designkit.cn/help/157) 提到背景、商品、文字与装饰 |

现场截图：`text-and-materials-20261007.jpg`、`ai-edit-mask-20261006.png`、`crop-interaction-20261006.png`、`agent-conversation-canvas-20261006.png`，均位于上述截图目录。

首页 Agent、图片与视频模式可切换，图片模式上传为可选，画质和比例收在紧凑入口；视频排除在本项目范围外。已有会话为覆盖整个窗口的自由画布，左侧白色对话面板悬浮于画布上，输入固定在面板底部；不以首页截图推断会话布局。

2026-10-08 补验：登录后测得画布从窗口 `(0, 0)` 覆盖全屏，对话面板宽 390px、左侧及上下留空 10px、圆角 24px；文件操作位于右上角，底部工具悬浮。历史会话缩略图点击打开大图预览。另建测试会话，单张咖啡杯海报成功生成，账户美豆从 75 变为 60；商品图设计师先要求输入图片，改由内容视觉设计师完成纯文字生成。生成后图片选中、浮动工具与画布定位已确认，入场动画瞬间未完整捕获，不把本地 620ms 过渡时长视为参考站实测值。证据见 `output/playwright/creation-layout-20261008/reference-generated.jpg`。

2026-10-10 补验：在已有 iPhone 海报上选择“编辑文字 → 直接编辑”，产生可编辑结果；双击识别出的标题后，画板从 7% 自动放大到 60%，标题进入编辑状态。将 `iPhone 17 Pro` 改为 `iPhone 17 Pro Test` 后，画面实时换行显示新内容，再恢复原文并点击空白处完成编辑。浮动栏显示 Rubik-Medium、字号 187、颜色、粗体/斜体/下划线/删除线及对齐入口；没有实际改变这些样式，不把入口可见当作全部样式效果通过。截图见 `output/playwright/goal-20261010/reference-text-edit.jpg`。

“直接编辑”先前产生的咖啡结果没有可编辑文字，不能作为文字修改效果依据。第三方新生图完整流程未验证；公共编辑器的下载与形状补验截图和说明位于 [现场观察](../../../output/playwright/goal-20261007/reference/observations.md)，不能替代已登录创作会话的全部流程。

## 页面截图索引

| 页面与状态 | 来源 | 参考图 | 主要观察 |
| --- | --- | --- | --- |
| 工作台首页默认状态 | [首页](https://www.designkit.cn/) | [home-default-01.png](../../../output/playwright/designkit/home-default-01.png) | 固定窄侧栏；中央 Agent 输入是第一主操作；下方依次为业务场景、推荐工具和内容流 |
| Agent 公开介绍页 | [AI Agent](https://www.designkit.cn/agent) | [agent-public-entry-01.png](../../../output/playwright/designkit/agent-public-entry-01.png) | 营销型深色首屏；大输入框与案例内容并列，不直接作为应用内首页骨架 |
| AI 商品图公开入口 | [AI 商品图](https://www.designkit.cn/ai-product-background) | [product-image-public-entry-01.png](../../../output/playwright/designkit/product-image-public-entry-01.png) | 公开页首屏突出上传，后续展示场景参考和能力说明；实际生成状态需要上传后补采 |
| 商品套图默认状态 | [商品套图](https://www.designkit.cn/product-kit) | [product-kit-default-01.png](../../../output/playwright/designkit/product-kit-default-01.png) | 顶部任务栏＋左侧任务类型＋配置栏＋右侧示例预览；主按钮固定在配置栏底部 |
| 商品套图升级弹窗 | [商品套图](https://www.designkit.cn/product-kit) | [product-kit-upgrade-modal-01.png](../../../output/playwright/designkit/product-kit-upgrade-modal-01.png) | 居中模态弹窗覆盖任务页，展示标题、三项能力说明和单一确认操作 |
| A+ / 详情页默认状态 | [A+ / 详情页](https://www.designkit.cn/product-kit/detailpage) | [detail-page-default-01.png](../../../output/playwright/designkit/detail-page-default-01.png) | 与商品套图共用任务外壳；配置栏更宽，模块以可多选卡片呈现，右侧为组合结果示意 |
| 图片编辑器空状态 | [图片编辑器](https://www.designkit.cn/editor/) | [editor-empty-01.png](../../../output/playwright/designkit/editor-empty-01.png) | 独立编辑器外壳；顶部文件操作、左侧工具、次级属性区、中央空画布入口 |
| 项目未登录状态 | [项目](https://www.designkit.cn/space) | [projects-signed-out-01.png](../../../output/playwright/designkit/projects-signed-out-01.png) | 与首页共用工作台侧栏；顶部搜索；未登录时使用居中空状态和登录按钮 |
| 资产库登录弹窗 | [资产库](https://www.designkit.cn/agent-lib) | [assets-login-modal-01.png](../../../output/playwright/designkit/assets-login-modal-01.png) | 资产页与项目页结构一致；访问时出现账号登录模态框 |

## 官方流程补充

[功能入门](https://www.designkit.cn/help/143) 区分 Agent 对话需求与确定任务的表单工具；[生成效果调整](https://www.designkit.cn/help/150) 与 [指令调整](https://www.designkit.cn/help/151) 用于核对连续修改流程。[AI 商品图](https://www.designkit.cn/help/66) 说明二次抠图的笔刷修整与确认返回画布；[画布拆分与文字编辑](https://www.designkit.cn/help/157) 补充未完整实测的能力说明。2026-10-09 本项目据此补充前景手动修整；官方说明不能替代参考站的登录态操作实测。

官方说明与现场观察分别记录。本项目的方案确认、项目保存、工具处理方式和自有电商版式按自身产品契约执行，不将第三方说明视为本地效果已通过验收。

## 1440 × 1000 布局测量基准

### 工作台外壳

- 参考图中左侧导航约 80px 宽，图标与文字垂直排列。
- 主内容使用浅灰背景和大面积留白，Agent 输入区位于首屏视觉中心。
- 项目和资产沿用同一外壳，因此本项目也应共用导航与顶部搜索结构。

### 生成任务外壳

- 顶部任务栏约 54px 高，承载品牌返回、新建任务、批量任务和账户入口。
- 左侧任务类型栏约 68px 宽，用图标与短标题切换商品套图、详情页等任务。
- 商品套图配置栏在参考图中约 399px 宽；详情模块选择较多，配置栏约 479px 宽。
- 右侧为浅灰预览区，默认展示流程或成品示意；实际结果应在相同区域替换展示。
- 核心提交按钮固定在配置栏底部，配置内容单独滚动。

### 编辑器外壳

- 顶部文件栏约 54px 高，左侧工具栏约 71px 宽。
- 工具属性区与中央画布分开，未打开图片时不可用操作使用弱化状态。
- 空状态把“打开图片”作为主按钮，同时保留批处理和新建画布入口。

以上尺寸为 1440 × 1000 截图中的页面结构测量值，用于首版布局基准，不视为第三方设计资产。
