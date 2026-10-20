# 技术架构

## 邀请制账号与本机共享

2026-10-10 增加本机常开、HTTPS 内网穿透的小范围邀请制使用。生产入口统一由 `createAuthenticatedApp` 提供，默认监听 `127.0.0.1:3000`，免域名试用启动器监听 `127.0.0.1:3199`；直接提供 `apps/web/dist` 静态构建和 SPA 路由，`/api/auth/session`、`POST /api/auth/login`、`POST /api/auth/logout` 管理网站会话。匿名健康检查只返回服务状态，不返回本机目录。其余业务入口先验证网站会话，包含文件下载、导出和 SSE；本地 CLI 和模型环境状态仅管理员可查。

`scripts/online.mjs` 使用系统 SSH 与 localhost.run 建立免费 HTTPS 隧道，不读取用户 SSH 私钥。启动器解析实际分配域名后设置 `PHOTO_STUDIO_PUBLIC_ORIGIN`，通过子进程运行生产服务；异常退出自动重启，隧道断线自动重连，域名变化时关闭旧服务后切换来源。启停、状态与日志位于 `data/deployment`；同时运行开发服务会被拒绝，避免同一数据目录有多个模型执行器。浏览器在公网 HTTP 页面加载时先转 HTTPS，正式 HTTPS 响应提供 HSTS 与 Secure Cookie。免费入口会限速与换域名，当前只用于小范围试用。

`accounts.db` 保存 users、login_sessions 与 login_attempts。账号密码使用独立随机盐和 scrypt 派生；七天会话只保存随机 token 的 SHA256，浏览器通过 HttpOnly、SameSite=Lax、Path=/api Cookie 持有原 token。`PHOTO_STUDIO_PUBLIC_ORIGIN` 配置正式 HTTPS 入口时启用 Secure Cookie；写操作要求应用请求头并校验 Origin。账号或来源连续登录失败触发十五分钟限制。退出立即撤销 token 并关闭对应 SSE；重置或停用撤销所有会话，已有 SSE 最迟三十秒内关闭。

为沿用现有业务结构，每个账号按需初始化并缓存独立的 `AppModule.forWorkspace`，拥有自己的 SQLite、业务队列、事件流、文件目录和 Codex 提供者。首次本机命令创建的管理员使用原数据根目录，保留全部旧项目、素材和对话；后续账号使用 `users/<userId>/`，不复制旧数据。请求不会把客户端账号编号作为目录来源；跨账号引用项目、素材、作品、画布或任务时，在当前账号数据库中找不到目标，按现有规则返回不存在。服务退出先关闭 SSE 和账号任务，再关闭数据库。

所有账号的提供者通过同一个 `CodexCallQueue` 串行执行规划、生图与图片处理，队列上限为一百项；等待阶段的取消不会启动 CLI。该串行调度不改变 `AgentModelProvider` 的调用边界、Codex ChatGPT 登录或模型选择，也不引入 Redis、Docker 或 API Key。每个已使用账号保留一份业务服务实例，适用于当前少量邀请用户；个人日额度、全局队列名次和磁盘配额另行实现。

账号管理仅提供本机交互命令，密码不回显、不写入命令参数。网站不提供公开注册、密码重置或管理账号接口，避免开放初始化入口。前端统一登录弹窗，提交动作登录成功后继续，取消登录保留原输入；过期会话保留当前创作内容等待重新认证，换成其他账号或退出后重新加载页面，清除旧缓存和订阅。

## 本地图片编辑

当前 `codex/local-image-layer-tools` 分支保留整图生成，本地模型处理识字、抠图和拆层。商品图、套图、详情模块与复杂改图仍由 Codex 内置生图执行。`AgentModelProvider.processImage` 统一调度本地专用工具：PaddleOCR 的 PP-OCRv5 ONNX（RapidOCR）、BiRefNet、SAM 2.1 和 LaMa；业务层不读取模型原始输出。识字和抠图不调用 Codex；拆层清字后通常做一次 Codex 前景语义分组，再在本地提取像素和修复背景。不可靠物体范围由本地工具返回严格校验的分割失败信息，提供者转换为 `LayerSegmentationError`，应用最多追加一次语义范围纠正；再次失败不保存结果。环境错误、取消和其他异常不触发该纠正，不逐层生图生成蒙版。

沿用 ImageToolInput、ImageToolTask 和 EditorDocument，不新增前端请求字段或数据库表。运行环境和权重放在 `data/runtimes/image-tools`，任务输入、蒙版、输出与日志放在独立 `data/runs/image-tool-*/local-*`。任务执行阶段不下载模型；安装脚本预先下载并核对 SHA256。输出尺寸、图层格式、坐标和来源均校验，失败不保存半份结果，取消中止本地进程。本地背景修复采用带上下文的局部补全。

字体从编辑器已有白名单估算匹配，不保证恢复原字体。残字检测通过不代表视觉无接缝；透明材质、复杂投影、重叠遮挡及大面积背景补全必须单独验收。具体安装和验证见 `local-image-tools.md`。

## 创作场景与编辑文档

`POST /api/projects/:id/creation` 接收可选 `resultId`，校验作品属于当前项目，返回 `{ sessionId, projectId, resultId }`。单图优先恢复未删除的来源对话，项目入口恢复最近相关对话，无记录时创建空白会话；不提交规划或生图任务。`agent_sessions.project_id` 为可空默认保存项目，旧库补列，项目删除时解除外键；共享类型字段为 `AgentSession.projectId`。创作入口携带 `session`、`project` 和可选 `result` 查询参数，读取当前项目作品并复用已有 EditorDocument。画板保存与图片工具允许引用会话执行作品及关联项目作品；新执行优先使用显式项目、会话默认项目，再沿用历史执行项目。

每个作品继续使用现有 EditorDocument；同页和独立编辑器共用图片、素材、文字、形状、画笔、调色和自动保存。CreationScene 独立保存会话内画板 `{ resultId, x, y }`、视口 `{ x, y, zoom }`、selectedId 与 revision，SQLite `creation_scenes` 以 session_id 为主键。GET/PATCH `/api/editor/scenes/:sessionId` 校验所属会话与有限坐标；版本冲突拒绝覆盖，相同已保存重发返回当前值。

`generateImage` 返回 PNG 字节，生成结果先作为整张图片进入编辑文档，不携带模型原生文字、商品或形状图层。手动新增的设计元素直接保存为 EditorDocument 图层；原图中的文字和前景按需提取。`renderCommerceImage` 保存原始画面并返回图片、标题与文案图层；CommerceService 在同一事务创建结果与 EditorDocument。程序文字不是从生图模型取得的原生设计图层。

浏览器编辑和服务端导出共用 `packages/editor/src/render.ts` 的 Konva 节点规则。服务端采用 CPU `@napi-rs/canvas` 画布处理图片、文字、形状、画笔、变换与调色；不调用模型。GET `/api/editor/results/:resultId/file` 输出最新保存的文档，原结果文件接口继续返回生成位图供图片图层使用，避免自引用。ZIP 和长图先读取所有模块的持久化文档快照，再串行渲染，长图按最大宽度居中拼接。不同窗口未保存的编辑不进入导出。

`brand_presets` 保存名称、BrandStyle JSON 与时间；`creation_presets` 保存名称、功能类型、已有生成参数快照与时间。品牌样式为 `{ fontFamily, primaryColor, textColor, backgroundColor, styleDescription }`，套图参数可选 `brand: BrandStyle | null`。旧任务没有该字段时保持原结构。新任务直接保存品牌快照，重试不读取可变预设。GET/POST `/api/brand-presets` 与 `/api/creation-presets` 提供列表和创建，PATCH/DELETE `/:id` 更新与删除；方案 GET 可按 kind 筛选，更新不能改变 kind。快照通过公共严格校验后落库，方案素材可为空。

图片工具使用 `/api/image-tools/tasks/session/:sessionId/events` 聚合同会话进度，每会话一条 SSE；结果与编辑文档原子保存。拆层先在本地识字和清字，再经 Codex 分析最多 8 个前景元素；本地分割和透明度细化提取原像素，合并前景选区后修复背景。局部改图、消除和无痕改字仍按原尺寸遮罩逐像素保留外部区域。独立任务目录和统一 AgentModelProvider 边界保持不变。

## 本地拓扑

```text
Vue 3 PC 前端
      ↓ HTTP / SSE
NestJS 本地服务
      ↓
LangGraph.js 电商工作流
      ↓
AgentModelProvider
      └─ CodexCliProvider（文本、生图与本地图片处理）
      ↓
白名单业务工具与本地任务执行器
      ↓
SQLite + 本地文件目录
```

## 代码结构

```text
photo-studio/
├─ apps/
│  ├─ web/                  # Vue PC端
│  └─ server/               # NestJS本地服务
├─ packages/
│  ├─ agent/                # LangGraph状态与节点
│  ├─ ai-provider/          # 模型提供者及事件归一化
│  ├─ tools/                # 电商业务工具白名单
│  ├─ editor/               # Konva画布能力
│  └─ shared/               # 公共类型与校验规则
├─ data/                    # 运行时数据，不提交版本库
│  ├─ app.db
│  ├─ uploads/
│  ├─ generated/
│  ├─ exports/
│  ├─ runtimes/image-tools/  # 本地图片工具环境与权重
│  └─ runs/
├─ docs/
├─ scripts/
│  ├─ start.ps1
│  ├─ stop.ps1
│  └─ setup-image-tools.ps1
├─ AGENTS.md
└─ README.md
```

## 模型提供者边界

业务层只依赖统一接口，不读取 Codex CLI JSONL，也不直接调用 OpenAI SDK。

```ts
interface AgentModelProvider {
  run(input: AgentInput): AsyncIterable<AgentEvent>
  continue(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent>
  generateImage(taskId: string, source: Buffer | null, prompt: string, signal: AbortSignal, guide?: Buffer): Promise<Buffer>
  processImage(taskId: string, source: Buffer, input: LocalImageInput, signal: AbortSignal, progress: (value: number) => void): Promise<LocalImageOutput>
  cancel(taskId: string): Promise<void>
}
```

统一事件覆盖启动、内容增量、工具调用、完成、失败和取消。接口及本地处理类型定义位于 `packages/ai-provider/src/model-provider.ts`，公共业务字段与校验位于 `packages/shared/src/index.ts`。

## Codex CLI 接入

- NestJS 使用子进程启动 `codex exec` 完成文本请求，使用 `codex app-server --stdio` 接收真实图片生成事件。
- 使用 JSONL 事件流和 JSON Schema 约束最终结果。
- 图片以当前任务目录中的本地文件传入。
- 多轮任务保存会话标识，并通过 CLI 恢复能力继续。
- 原始事件只在 `CodexCliProvider` 内解析并归一化。
- 规划与文案显式指定本机验证可用的 `gpt-5.5`，可通过 `PHOTO_STUDIO_CODEX_MODEL` 配置账户支持的模型，避免忽略用户配置后落入 CLI 不受当前账户支持的默认模型。
- 商品图、商品套图和详情模块的真实生图使用 Codex 内置图片生成能力，经过统一 `AgentModelProvider` 调用；不使用 OpenAI API Key，不依赖本地扩散模型。
- 规划和文案请求保持只读沙箱并关闭生图；图片请求仅开放内置生图工具，在独立任务目录中接收本次商品素材，通过应用协议接收 PNG 字节。应用校验图片后保存到本地结果目录并写入结果库；不读取模型回复或事件中的任意文件路径。Codex 自身可能另存图片副本到其生成目录。
- 每个任务创建独立目录，记录输入、Schema、事件、结果和必要日志。
- 默认使用最小权限沙箱，不允许模型任意修改项目或系统文件。

## Agent 与工具职责

LangGraph 保存业务状态并控制节点转换；Codex CLI 负责需求理解、参数整理、计划、文案、真实生图、拆层前景语义分析和质量判断；本地工具负责素材处理、规格适配、模块排版、任务执行和数据写入。文本/视觉分析与图片生成是不同的模型调用。

```text
需求理解
→ 参数检查
→ 计划生成
→ 用户确认
→ 工具执行
→ 质量检查
→ 重试或完成
```

工具必须由应用注册并校验参数，模型不能通过自由 Shell 命令代替业务工具。

## 本地持久化

单图删除在事务内重新统计项目图片数量，最后一张要求请求明确携带 `{ deleteProjectWhenEmpty: true }`；未确认时拒绝删除并要求页面重新确认。确认后复用整个项目的删除流程，同步删除关联对话；接口返回 `{ id, projectDeleted }`，页面据此返回项目列表。多图时只删除指定图片，确认标记不会扩大为整个项目删除。

项目资产删除采用数据库物理删除，不新增删除标记。`DELETE /api/projects/:id` 通过 `agent_executions` 与作品任务定位关联对话，在同一事务内删除项目、图片、编辑文档、关联对话及其消息、布局与执行记录；共享其他项目的对话或图片拒绝删除。`DELETE /api/projects/:id/results/:resultId` 只删除属于该项目的单张图片和编辑文档，同步清理画板、图片工具输出及套图模块引用，保留对话和项目。`DELETE /api/assets/:id` 删除素材记录并解除历史任务素材外键；正在使用的素材或仍被编辑图层引用的素材拒绝删除。删除前检查活动任务和跨作品引用，失败整体回滚。此轮删除范围是数据库记录，本地文件清理不随接口执行。

会话管理沿用 `agent_sessions`，新增可空 `pinned_at`、`deleted_at`，接口字段为 `pinnedAt`、`deletedAt`；旧库事务补列，原消息、任务及作品引用保留。`PATCH /api/agent/sessions/:id` 接收 `{ title }`，名称为 1–80 个字符。`POST /api/agent/sessions/actions` 接收 `{ ids: string[], action: 'pin' | 'unpin' | 'delete' }`，整批验证并事务写入；删除拒绝仍有规划、生成或图片工具任务进行中的会话。列表优先展示置顶会话，过滤已删除记录；删除后不能继续读取或提交对话，项目与作品保留。

- SQLite 保存项目、会话、任务、步骤和资源索引。
- 文件系统保存上传文件、生成结果和导出文件。
- 任务状态先落库再推送前端，保证刷新后可恢复。
- 本地任务执行器控制并发、取消和失败重试，不依赖 Redis。

`ProductImageParameters.sourceAssetId`、`CommerceParameters.sourceAssetId` 与执行提交 `projectId` 允许为 `null`；已保存 `AgentExecution.projectId` 仍为真实项目编号。`POST /api/agent/tasks/:id/parameters` 接收 `{ sourceAssetId: string | null }`，经统一提供者返回 `{ steps: AgentStepInput[] }`，服务校验工具、标题、顺序、素材与数量后保存到运行目录。草案按计划及素材复用；切换页面可取消请求，生成需单独确认。原规划 `AgentResult` 保持现有结构，旧会话无需改写。

`GET /api/agent/tasks/:id/parameters` 只读取本轮最近保存的 `{ steps }` 草案，恢复素材选择；尚未整理的方案返回 404。`POST` 可按素材复用缓存，并更新最近草案，不因刷新重新推断素材。执行记录优先从持久化步骤恢复。

纯文字图片调用不写 `source.png`，不传 `localImage`，直接使用原生生图返回的 PNG 字节；检查只接收生成图，不假定第一张是原图。素材模式保留原有路径。旧 SQLite 的必填素材列经完整快照与事务迁移为可空列，保留任务及结果外键引用。

## 图片工具

`ImageToolInput` 与 `ImageToolTask`、任务列表/单任务/SSE/停止/重试接口见 [创作工具契约](creation-tools-contract.md)，逐项处理方式见其 [功能表](creation-tools-contract.md#功能与处理方式)；SQLite 新增 `image_tool_tasks`、`image_tool_results`。结果复用既有图片下载、项目资产和编辑文档接口，外键使用真实工具任务，不能伪造商品图任务。所有智能处理经过 `AgentModelProvider`；独立运行目录、输出校验和完成时事务落库，重启中断不自动重跑。

涂抹 PNG 与处理原图尺寸一致，白色为处理区、黑色为保留区；模型同时接收未染色的原图与粉色选区示意，原图作为字色、纹理和样式依据。扩图同时提供原图与目标画布位置示意，不把灰色边缘当成最终背景。两个附件仅在本任务目录中暴露。应用在原尺寸按遮罩合成，局部保留区 RGBA 与扩图原矩形保持一致；模型补全与边缘自然程度仍须视觉验收。拆层主体使用本地分割与透明度模型提取，原图像素与蒙版生成透明 PNG，再修复背景；本地识字返回真实文本及原图坐标，清除对应底图文字后保存可编辑图层。透明背景纳入编辑文档校验和 PNG 导出，生成原图保持不变。

AI 改图、消除、无痕改字、超清和扩图继续走 `generateImage`。无痕改字返回位图文字；超清请求模型增强细节后由 Sharp 适配 2 倍/4 倍尺寸，当前未接入本地超分模型。扩图先生成扩大画布的场景，再把原图合成回原位置。画布基础编辑与下载尺寸倍率由 Konva/Sharp 处理，不调用 Codex。

工具包中的 `renderMockProductImage` 只用于确定性测试，正式生成由 `PRODUCT_IMAGE_TOOL` 接入 Codex 图片引擎；素材解码、裁边、规格适配与模块排版仍由本地工具负责。

