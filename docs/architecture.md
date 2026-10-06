# 技术架构

## 本地拓扑

```text
Vue 3 PC 前端
      ↓ HTTP / SSE
NestJS 本地服务
      ↓
LangGraph.js 电商工作流
      ↓
AgentModelProvider
      ├─ MVP：CodexCliProvider
      └─ 后期：OpenAIResponsesProvider
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
│  └─ runs/
├─ docs/
├─ scripts/
│  ├─ start.ps1
│  └─ stop.ps1
├─ AGENTS.md
└─ README.md
```

## 模型提供者边界

业务层只依赖统一接口，不读取 Codex CLI JSONL，也不直接调用 OpenAI SDK。

```ts
interface AgentModelProvider {
  run(input: AgentInput): AsyncIterable<AgentEvent>
  continue(sessionId: string, input: AgentInput): AsyncIterable<AgentEvent>
  generateImage(taskId: string, source: Buffer | null, prompt: string, signal: AbortSignal): Promise<Buffer>
  cancel(taskId: string): Promise<void>
}
```

统一事件至少覆盖：启动、内容增量、工具调用、完成、失败和取消。具体字段在实现前根据页面状态与 CLI 实际输出确认，不提前猜测。

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

LangGraph 保存业务状态并控制节点转换；Codex CLI 负责需求理解、计划、文案、真实生图和质量判断；本地工具负责素材处理、规格适配、模块排版、任务执行和数据写入。

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

- SQLite 保存项目、会话、任务、步骤和资源索引。
- 文件系统保存上传文件、生成结果和导出文件。
- 任务状态先落库再推送前端，保证刷新后可恢复。
- 本地任务执行器控制并发、取消和失败重试，不依赖 Redis。

具体业务表和字段在对应功能实现前确认，禁止为了预留扩展而添加未使用字段。

2026-10-06 用户确认 `ProductImageParameters.sourceAssetId`、`CommerceParameters.sourceAssetId` 与执行提交 `projectId` 允许为 `null`；已保存 `AgentExecution.projectId` 仍为真实项目编号。`POST /api/agent/tasks/:id/parameters` 接收 `{ sourceAssetId: string | null }`，经统一提供者返回 `{ steps: AgentStepInput[] }`，服务校验工具、标题、顺序、素材与数量后保存到运行目录。草案按计划及素材复用；切换页面可取消请求，生成需单独确认。原规划 `AgentResult` 保持现有结构，旧会话无需改写。

`GET /api/agent/tasks/:id/parameters` 只读取本轮最近保存的 `{ steps }` 草案，恢复素材选择；尚未整理的方案返回 404。`POST` 可按素材复用缓存，并更新最近草案，不因刷新重新推断素材。执行记录优先从持久化步骤恢复。

纯文字图片调用不写 `source.png`，不传 `localImage`，直接使用原生生图返回的 PNG 字节；检查只接收生成图，不假定第一张是原图。素材模式保留原有路径。旧 SQLite 的必填素材列经完整快照与事务迁移为可空列，保留任务及结果外键引用。

## 图片工具

2026-10-07 用户已确认非视频图片工具结构和后续字段接入。`ImageToolInput` 与 `ImageToolTask`、任务列表/单任务/SSE/停止/重试接口见 `creation-tools-contract.md`；SQLite 新增 `image_tool_tasks`、`image_tool_results`。结果复用既有图片下载、项目资产和编辑文档接口，外键使用真实工具任务，不能伪造商品图任务。所有智能处理经过 `AgentModelProvider`；独立运行目录、输出校验和完成时事务落库，重启中断不自动重跑。

涂抹 PNG 与处理原图尺寸一致，白色为处理区、黑色为保留区；模型按粉色提示编辑后，应用在原尺寸按遮罩合成，保留区 RGBA 保持一致。拆层主体由模型识别蒙版，原图像素与蒙版生成透明 PNG，背景独立重建；识字返回真实文本及原图坐标，清除对应底图文字后保存可编辑图层。透明背景纳入编辑文档校验和 PNG 导出，生成原图保持不变。

## OpenAI API 后期迁移

后期新增 `OpenAIResponsesProvider`，通过 OpenAI 官方 SDK 和 Responses API 实现相同接口。需要替换的内容仅包括认证、流式事件转换、结构化输出、图片输入、会话标识、限流和费用统计。

LangGraph、页面、业务工具、SQLite 和项目数据保持不变。MVP 阶段不得让 CLI 专有字段进入公共类型，避免扩大迁移范围。

