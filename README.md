# Photo Studio

面向电商用户的本地 PC Web AI 视觉生产工作台，提供 Agent 对话、商品图、商品套图、详情页、多画板编辑、图片工具和本地项目资产。

## 本地启动

使用 Node.js 24 LTS（至少 24.15.0）。在项目根目录执行：

```powershell
.\scripts\start.ps1
```

首次启动安装锁定依赖并启动前后端，打开 [本地工作台](http://127.0.0.1:5173)。也可手动执行 `npm ci` 后使用 `npm run dev`。按 Ctrl+C 停止，或在另一个终端执行 `.\scripts\stop.ps1`。

服务仅监听本机，前端端口 5173、后端端口 3000。SQLite、上传、生成、导出和任务文件保存在 `data/`，不提交版本库；可通过 `PHOTO_STUDIO_DATA_DIR` 指定业务数据目录，启动器进程记录仍保存在项目 `data/` 下。

## 模型与图片工具

规划、文案、整图生成及复杂改图通过本机已登录的 Codex CLI 执行，使用 `codex login` 登录 ChatGPT，无需 OpenAI API Key。Codex 调用需要联网并消耗账户额度。

CLI 需支持 `--json`、`--output-schema`、`--ignore-user-config`、`--ignore-rules` 和 `app-server --stdio`。Windows 自动定位 PATH 下官方 npm 安装的原生程序；其他位置通过 `PHOTO_STUDIO_CODEX_PATH` 指定。规划和生图调度默认使用代码配置的 `gpt-5.5`，分别可通过 `PHOTO_STUDIO_CODEX_MODEL`、`PHOTO_STUDIO_CODEX_IMAGE_MODEL` 调整。

当前分支的“编辑文字 → 直接编辑”和抠图使用本地专用模型，不调用 Codex；拆层仍需一次 Codex 前景语义分析，再用本地模型分割和补背景。AI 改图、无痕消除、无痕改字、AI 超清和 AI 扩图仍调用 Codex 生图，功能与输出区别见 [创作工具处理方式](docs/creation-tools-contract.md#功能与处理方式)。安装 uv 后执行：

```powershell
.\scripts\setup-image-tools.ps1
```

安装、模型目录、处理边界和已知效果问题见 [本地图片工具](docs/local-image-tools.md)。整图生成无需本地扩散模型，旧 OpenVINO 实验运行时不再使用。

## 使用流程

在首页描述需求，素材可选；助手补齐信息并展示方案，点击“开始生成”后执行。结果自动保存项目并进入同页画板，可引用当前编辑画面继续修改。商品图、套图和详情页也提供独立配置入口、进度、取消、失败重试及导出。

创作页与独立编辑器共享编辑文档，支持文字、图片、形状、画笔、图层、调色、撤销重做和自动保存；多画板布局与视口可恢复。生图先保存整张图片，文字和商品图层在编辑时按需提取，手动新增的文字、图片和形状直接保存为独立图层。PNG/JPG 导出包含当前编辑，尺寸倍率仅改变输出尺寸；商品细节、识字字体和背景修复效果需核对。

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

