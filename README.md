# Photo Studio

面向电商用户的本地 PC Web AI 视觉生产工作台，提供 Agent 对话、商品图、商品套图、详情页、多画板编辑、图片工具和本地项目资产。支持邀请制账号，可通过 HTTPS 内网穿透供少量用户使用，本机继续执行 Codex CLI。

## 本地启动

使用 Node.js 24 LTS（至少 24.15.0）。在项目根目录执行：

```powershell
.\scripts\start.ps1
```

首次启动安装锁定依赖并启动前后端，打开 [本地工作台](http://127.0.0.1:5173)。也可手动执行 `npm ci` 后使用 `npm run dev`。按 Ctrl+C 停止，或在另一个终端执行 `.\scripts\stop.ps1`。

服务仅监听本机，前端端口 5173、后端端口 3000。SQLite、上传、生成、导出和任务文件保存在 `data/`，不提交版本库；可通过 `PHOTO_STUDIO_DATA_DIR` 指定业务数据目录，启动器进程记录仍保存在项目 `data/` 下。

## 邀请制账号

工作台使用账号密码登录弹窗；不开放公众注册、短信或第三方登录。首次编译后，在项目根目录的另一个交互终端创建账号：

```powershell
npm run accounts -- create admin --admin
npm run accounts -- create friend
```

密码在终端输入两次，不回显、不进入命令参数，长度为 6–30 个字符。账号使用 3–32 位英文字母、数字、下划线或短横线，不区分大小写。首次必须创建管理员，现有 `app.db`、项目、素材和对话全部归该管理员，旧文件不搬移；后续账号从空白空间开始，业务数据位于 `data/users/<账号编号>/`，账号与会话保存在 `data/accounts.db`。

```powershell
npm run accounts -- list
npm run accounts -- reset-password friend
npm run accounts -- disable friend
```

重置密码或停用账号会撤销原登录会话；不能停用最后一个管理员。命令和服务必须使用相同的 `PHOTO_STUDIO_DATA_DIR`。请备份整个数据目录，包括各账号数据库、文件和 `accounts.db`。

## 本机 HTTPS 试用部署

生产构建由 NestJS 同源提供前端页面和 `/api`，无需对外提供 Vite 开发服务。构建完成并创建管理员后，在服务所在终端设置真实入口域名并运行：

```powershell
npm run build
$env:PHOTO_STUDIO_PUBLIC_ORIGIN = 'https://studio.example.com'
npm run start -w @photo-studio/server
```

将示例域名换成实际 HTTPS 入口；内网穿透指向 `http://127.0.0.1:3000`，保留请求原始 Host 或传入上述配置对应的 Origin。该配置用于校验写操作来源并启用 Secure Cookie，域名变化后要同步修改并重启服务。SSE 需要关闭代理缓冲和缓存，并允许长连接；入口上传限制至少允许 20 MB 图片及 multipart 开销。不要直接对外暴露源码、`data/` 或开发端口。

没有域名时，可先使用 localhost.run 免费 HTTPS 地址进行小范围试用。先执行 `npm run build` 并创建管理员，停止本地开发服务后启动：

```powershell
.\scripts\stop.ps1
.\scripts\start-online.ps1
Get-Content .\data\deployment\status.json
```

`status.json` 的 `url` 是当前公网入口。后台以当前 Windows 用户运行生产构建，服务监听 `127.0.0.1:3199`，通过 SSH 加密隧道转发；来源校验和 Secure Cookie 自动使用分配的 HTTPS 域名，继续使用该用户已登录的 Codex CLI。后台自动重连隧道、重启异常退出的服务，域名变化后需使用最新地址重新登录。停止执行 `.\scripts\stop-online.ps1`，日志在 `data/deployment/online.stdout.log` 与 `online.stderr.log`。线上运行期间先停止线上服务再启动开发服务，避免同一份数据由多个执行器运行。

免费入口会限速且域名可能变化，不保证持续可用。当前公网实测约 1 MB 上传用时约 25 秒，约 20 MB 上传在三分钟测试期限内未完成；上传请求允许等待十分钟，实际速度取决于入口限流。正式长期使用建议迁移到固定域名隧道。Windows 登录后启动可通过当前用户计划任务调用 `scripts/start-online.ps1`；运行状态和地址以 `status.json` 为准。

各账号业务服务和文件独立，Codex 规划、生图与图片处理共用进程内串行队列，继续使用本机 ChatGPT 登录与现有模型配置。每日个人额度、队列名次、磁盘自动清理和定时备份尚未实现，见 [剩余事项](handoff.md)。

## 模型与图片工具

规划、文案、整图生成及复杂改图通过本机已登录的 Codex CLI 执行，使用 `codex login` 登录 ChatGPT，无需 OpenAI API Key。Codex 调用需要联网并消耗账户额度。

CLI 需支持 `--json`、`--output-schema`、`--ignore-user-config`、`--ignore-rules` 和 `app-server --stdio`。Windows 自动定位 PATH 下官方 npm 安装的原生程序；其他位置通过 `PHOTO_STUDIO_CODEX_PATH` 指定。管理员可在本地设置中读取 Codex 当前模型目录并选择调用模型；首次使用默认跟随目录中的默认模型，规划、文案和生图统一使用所选模型。模型目录不代表账户调用权限，实际可用性以任务结果为准。

当前分支的“编辑文字 → 直接编辑”和抠图使用本地专用模型，不调用 Codex；拆层仍需一次 Codex 前景语义分析，再用本地模型分割和补背景。AI 改图、无痕消除、无痕改字、AI 超清和 AI 扩图仍调用 Codex 生图，功能与输出区别见 [创作工具处理方式](docs/creation-tools-contract.md#功能与处理方式)。安装 uv 后执行：

```powershell
.\scripts\setup-image-tools.ps1
```

安装、模型目录、处理边界和已知效果问题见 [本地图片工具](docs/local-image-tools.md)。整图生成无需本地扩散模型，旧 OpenVINO 实验运行时不再使用。

## 使用流程

在首页描述需求，素材可选；助手补齐信息并展示方案，点击“开始生成”后执行。结果自动保存项目并进入同页画板，可引用当前编辑画面继续修改。商品图、套图和详情页也提供独立配置入口、进度、取消、失败重试及导出。

创作页与独立编辑器共享编辑文档，支持文字、图片、形状、画笔、图层、调色、撤销重做和自动保存；多画板布局与视口可恢复。生图先保存整张图片，文字和商品图层在编辑时按需提取，手动新增的文字、图片和形状直接保存为独立图层。PNG/JPG 导出包含当前编辑，尺寸倍率仅改变输出尺寸；商品细节、识字字体和背景修复效果需核对。

新套图和详情模块的标题、文案直接保存为文字层，可修改后下载单图、ZIP 或详情长图；整套导出使用最新保存的编辑内容，原始生成图保留。商品图、套图、详情页与对话方案可保存和复用创作方案；默认保留当前商品事实，旧文案需主动选择恢复。设置页管理品牌字体、配色与风格预设，套图/详情保存独立快照，后续预设变化不会改变旧任务。项目与素材支持名称搜索，设置页可检查本地模型文件与各类任务状态。

## 开发检查

```powershell
npm run lint
npm run typecheck
npm run build
npm test
```

验收使用独立数据目录，截图和报告保存在 `output/playwright/` 与 `data/runs/`。普通文档修改只检查差异、引用及编码；核心流程或多文件代码联动再执行完整检查。

## 文档

- [产品范围与验收标准](docs/product.md)
- [技术架构与数据边界](docs/architecture.md)
- [UI 设计与页面规范](docs/ui-design.md)
- [创作工具接口契约](docs/creation-tools-contract.md)
- [本地图片工具安装与限制](docs/local-image-tools.md)
- [参考页面与观察证据](docs/references/designkit/index.md)
- [剩余事项](handoff.md)
- [开发约束](AGENTS.md)

