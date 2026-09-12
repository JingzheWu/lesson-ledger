# 课时小账 · 月度课时费计算器

一期纯前端中文网页，使用 React、TypeScript、Vite 和 pnpm。支持电脑与手机浏览器，无需账号或服务端。

## 启动

需要 Node.js 22.12+ 与 pnpm 10。

```bash
export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 all_proxy=socks5://127.0.0.1:7897
pnpm install
pnpm dev
```

打开终端显示的地址，默认 http://localhost:5173。生产构建执行 `pnpm build`，构建产物为 `dist/`，可部署到静态网站托管；本地预览执行 `pnpm preview`。

## 使用

右上角“计费说明”先展示当前生效的只读阶梯表，再展示计算规则；表旁的“修改阶梯表”会关闭说明并打开计费设置。月份旁的“计费设置”也可直接查看和编辑价格。

1. 选择结算月份，展开年级组和实际年级，按一对一、一对二、一对三填写节数或小时数，两者自动换算。
2. 点击“计算课时费”，查看总额、录入摘要、六阶梯明细与本次完整计费表。空白输入也可计算，结果为零。
3. 在“计费设置”中编辑 24 个单价，点击“保存并应用”。取消丢弃草稿；恢复默认也需保存才生效。
4. 修改月份、课时或应用价格后，旧结果会标记“上次计算”，点击计算后更新金额和快照。切换月份会保留课时，不会加载历史记录。

## 数据与计算边界

- 月度课时、结果和计算快照仅在页面内存中保留，刷新即清空，不会上传。
- 只有价格配置存入本站点的当前浏览器 localStorage。不同浏览器、设备、站点地址之间不共享；清除浏览器数据会丢失自定义配置。
- 无效或不兼容的本地配置会提示并回退默认，不自动覆盖原值。保存失败时保留草稿；可主动选择“仅本次使用”，刷新后不保留。
- 全月共用六个阶梯，每节固定 2 小时。多人班的工时不乘学生人数，费用系数分别为 1.0、1.2、1.3。
- 已确认的结算口径：按实际年级从一年级到高三排序，同年级按一对一 → 一对二 → 一对三填充。以百分之一小时、分及整数系数存储，使用 BigInt 中间计算；每条合并后的最终明细四舍五入到分，再汇总。超出安全整数范围会报错，不输出不精确结果。
- 金额为月度课时费，不含底薪、奖金或税费。混合年级同课、月中调价、历史档案、导入导出及二期小程序不在一期范围内。

## 验证

```bash
pnpm test                       # 计算、精度与配置单元测试
pnpm build                      # TypeScript 检查及生产构建
pnpm exec playwright install chromium
pnpm test:e2e                   # 桌面及 375px 手机浏览器交互验收
pnpm check                      # 依次执行全部检查
```

Playwright 首次安装浏览器时也可使用上述代理。若浏览器安装到自定义路径，运行安装和测试时需设置相同的 `PLAYWRIGHT_BROWSERS_PATH`。浏览器运行环境需要 Chromium 所需的系统依赖。

Linux 缺少浏览器运行库时，可使用 `pnpm exec playwright install --with-deps chromium` 安装浏览器及系统依赖，需要系统安装权限。本次验证将运行库与中文字体临时解压到 `/tmp`；在当前环境中可用下列命令复跑，无需修改系统：

```bash
FONTCONFIG_FILE=/tmp/lesson-ledger-runtime/fonts.conf \
LD_LIBRARY_PATH=/tmp/lesson-ledger-runtime/root/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=/tmp/lesson-ledger-browsers \
pnpm test:e2e
```

这些临时文件清理后，需要重新准备浏览器环境。

- `src/domain.ts`：纯计算、默认价格、校验与精确格式化。
- `src/config.ts`：版本校验、本地配置读取与保存。
- `src/InputEditor.tsx`：固定 36 组合录入、双向换算与分组。
- `src/BillingHelp.tsx`：集中展示工时、排序、阶梯及舍入说明。
- `src/Settings.tsx`：价格草稿、校验、保存与存储故障处理。
- `src/Results.tsx`：金额概览、输入快照、阶梯明细与完整计费表。
- `src/App.tsx`：月份、计算、待重算和页面状态协调。

单元测试覆盖需求 A01–A15、额外精度与守恒检查；浏览器测试覆盖 B01–B10、输入换算、清空确认、键盘操作和移动布局。
