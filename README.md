# 课时小账 · 月度课时费计算器

项目包含 React 网页与 原生微信小程序，两端及云函数共用同一份精确计算规则。网页继续独立使用；微信小程序提供个人云端计费表、手动保存、历史快照、复用与删除。

## 微信小程序

```powershell
corepack pnpm install --frozen-lockfile
Copy-Item project.local.example.json project.local.json
# 填入小程序 AppID 和测试云环境 ID 后执行：
corepack pnpm build:wechat
```

微信开发者工具导入仓库根目录。小程序使用原生 `Page + WXML + WXSS`，不包含 React。没有云环境配置时可用默认表本地试算。云功能需先按部署文档创建集合、配置权限和索引、部署 `ledger` 云函数。

- [架构与数据契约](docs/architecture.md)：共享核心、会话状态、平台适配、服务端事务。
- [部署与联调](docs/wechat-deployment.md)：固定版本、微信项目导入、云数据库、升级恢复。
- [验收结果与真机清单](docs/acceptance.md)：已通过的本地检查与仍需真实账号/设备执行的验收。
- 产品需求：[网页版](docs/requirements/web.md)、[微信小程序](docs/requirements/miniprogram.md)。

`packages/core` 为可复用纯计算；`packages/application` 为平台无关状态层；`apps/miniprogram` 为原生UI；`server` 为云端业务与仓储；`cloudfunctions/ledger` 为构建后的可部署云函数。原有网页保留在 `src`。

```powershell
corepack pnpm test          # 共享规则、会话、服务端、SDK契约和原生页面事件
corepack pnpm build:wechat  # 类型检查 + 小程序与云函数构建
corepack pnpm check:wechat  # 使用本机微信开发者工具编译 WXML / WXSS
```

## 网页启动

需要 Node.js 22.12+ 与 pnpm 10。

```bash
export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 all_proxy=socks5://127.0.0.1:7897
pnpm install
pnpm dev
```

打开终端显示的地址，默认 http://localhost:5173。网页生产构建执行 `pnpm build:web`，构建产物为 `dist/`，可部署到静态网站托管；本地预览执行 `pnpm preview`。`pnpm build:wechat` 构建小程序和云函数，`pnpm build` 依次构建全部平台。

## 网页使用

右上角“计费说明”先展示当前生效的只读阶梯表，再展示计算规则；表旁的“修改阶梯表”会关闭说明并打开计费设置。月份旁的“计费设置”也可直接查看和编辑价格。

1. 选择结算月份，展开年级组和实际年级，按一对一、一对二、一对三填写节数或小时数，两者自动换算。
2. 点击“计算课时费”，查看总额、录入摘要、六阶梯明细与本次完整计费表。空白输入也可计算，结果为零。
3. 在“计费设置”中编辑 24 个单价，点击“保存并应用”。取消丢弃草稿；恢复默认也需保存才生效。
4. 修改月份、课时或应用价格后，旧结果会标记“上次计算”，点击计算后更新金额和快照。切换月份会保留课时，不会加载历史记录。

## 网页数据与计算边界

- 月度课时、结果和计算快照仅在页面内存中保留，刷新即清空，不会上传。
- 只有价格配置存入本站点的当前浏览器 localStorage。不同浏览器、设备、站点地址之间不共享；清除浏览器数据会丢失自定义配置。
- 无效或不兼容的本地配置会提示并回退默认，不自动覆盖原值。保存失败时保留草稿；可主动选择“仅本次使用”，刷新后不保留。
- 全月共用六个阶梯，每节固定 2 小时。多人班的工时不乘学生人数，费用系数分别为 1.0、1.2、1.3。
- 已确认的结算口径：按实际年级从一年级到高三排序，同年级按一对一 → 一对二 → 一对三填充。以百分之一小时、分及整数系数存储，使用十进制整数串完成精确中间计算；每条合并后的最终明细四舍五入到分，再汇总。超出安全整数范围会报错，不输出不精确结果。
- 金额为月度课时费，不含底薪、奖金或税费。网页版不提供混合年级同课、月中调价、历史档案或导入导出；个人云端配置与历史记录通过微信小程序使用。

## 验证

```bash
pnpm test                       # 计算、精度与配置单元测试
pnpm build:web                  # 网页类型检查及生产构建
pnpm build:wechat               # 小程序、共享模块和云函数检查及构建
pnpm build                      # 构建全部平台
pnpm exec playwright install chromium
pnpm test:e2e                   # 桌面及 375px 手机浏览器交互验收
pnpm check                      # 依次执行全部检查
```

Playwright 首次安装浏览器时也可使用上述代理。若浏览器安装到自定义路径，运行安装和测试时需设置相同的 `PLAYWRIGHT_BROWSERS_PATH`。浏览器运行环境需要 Chromium 所需的系统依赖。

Linux 缺少浏览器运行库时，可使用 `pnpm exec playwright install --with-deps chromium` 安装浏览器及系统依赖，需要系统安装权限。本次 Windows 验证将浏览器放在项目内 `.browsers`，可按以下方式复跑：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path (Get-Location).Path '.browsers'
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e --workers=4
```

这些临时文件清理后，需要重新准备浏览器环境。

- `src/domain.ts`：网页兼容入口，重导出 `packages/core/domain.ts` 的计算、价格、校验与格式化。
- `src/config.ts`：版本校验、本地配置读取与保存。
- `src/InputEditor.tsx`：固定 36 组合录入、双向换算与分组。
- `src/BillingHelp.tsx`：集中展示工时、排序、阶梯及舍入说明。
- `src/Settings.tsx`：价格草稿、校验、保存与存储故障处理。
- `src/Results.tsx`：金额概览、输入快照、阶梯明细与完整计费表。
- `src/App.tsx`：月份、计算、待重算和页面状态协调。

单元测试覆盖需求 A01–A15、额外精度与守恒检查；浏览器测试覆盖 B01–B10、输入换算、清空确认、键盘操作和移动布局。
