# 微信小程序部署与联调

源码和自动化验证已交付。真实微信云环境部署、两个微信账号及两台手机的验收，需要项目所有者的小程序 AppID、云环境权限和设备。本文不代表已发布、已通过微信审核或已完成真机验收。

## 固定版本

| 项目 | 本次基线 |
| --- | --- |
| 本机开发 Node.js | 22.18.0；构建建议22.12+ |
| 包管理器 | pnpm 10.14.0 |
| 小程序基础库 | 3.7.12（project.config.json） |
| 小程序业务包输出 | ES2017，不依赖 BigInt |
| 云函数运行时 | Nodejs18.15（cloudbaserc.example.json）；函数入口 index.main |
| 微信服务端SDK | wx-server-sdk 4.0.2（固定）；生产依赖由云函数 package-lock.json 锁定 |
| 云函数业务包输出 | Node.js 18 |
| 规则 / 记录结构 | lower-grade-first-v1 / schemaVersion 1 |

腾讯云目前列出了 Node.js 18.15 的云函数运行环境；实际账号可选运行时应在控制台联调时再次确认。参见[运行环境支持](https://docs.cloudbase.net/cloud-function/runtime-support)。若该环境不再提供18.15，显式升级运行时配置和此表，重新测试后部署，不静默修改基线。

## 本地准备

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7897"
$env:HTTPS_PROXY="http://127.0.0.1:7897"
corepack pnpm install --frozen-lockfile
Copy-Item project.local.example.json project.local.json
```

编辑 `project.local.json`，填入真实的 `appid` 与**测试** `cloudEnv`。这是小程序和云环境的公开标识，不需要也不要填 AppSecret、SecretId、SecretKey。

```powershell
corepack pnpm build:wechat
```

构建生成 `apps/miniprogram/runtime.js`、`cloudfunctions/ledger/index.js`，并将本地配置写入微信项目配置和小程序 `env.js`。如未提供本地配置，仍可构建，游客项目只能体验默认表本地试算，云功能会显示不可用。

使用微信开发者工具导入**仓库根目录**，不要只导入 `apps/miniprogram`。工具会按 `project.config.json` 定位小程序和云函数。由项目成员微信账号登录，选择基础库3.7.12。

## 云数据库与云函数

1. 在该小程序下建立/选择测试云开发环境；正式环境另建并独立配置，不共用数据。确认计费、资源额度和项目成员权限。
2. 手动创建 `user_configs`、`config_versions`、`calculation_records`、`operation_receipts` 四个集合。业务函数不会在集合缺失或网络失败时擅自建库。
3. 对四个集合逐一设置“仅管理端可读写”，或在自定义权限规则中填入该集合的 `{ "read": false, "write": false }`。完整清单见 `database/permissions.json`。随后验证小程序直接读写均失败，而云函数服务端可以访问。[官方读写说明](https://docs.cloudbase.net/en/recipes/add-database-wechat-miniprogram)说明了仅管理端可读写时客户端访问会被拒绝。
4. 按 `database/indexes.json` 的字段顺序建立 `calculation_records` 的两个复合索引。保留各集合默认 `_id` 唯一索引，等待复合索引状态可用后再验证分页。无需对24个价格或明细数组建索引。
5. 再执行一次 `pnpm build:wechat`，确保最新共享规则已进入两端产物。云函数运行时选 Nodejs18.15，入口 `index.main`，超时30秒，内存256MB。
6. 在开发者工具中右键 **`cloudfunctions` 根目录**，确认当前云环境与 `project.local.json` 中的 `cloudEnv` 一致。如果此前已在云开发控制台创建 `ledger`，先选择“同步云函数列表”，让工具识别已有函数，再右键 `ledger` 选择“上传并部署”。只同步列表，不要下载云端的空白示例代码覆盖本地项目。若仍显示“创建并部署”，重新打开项目后再同步。只有目标环境尚不存在 `ledger` 时才使用“创建并部署”。
   - **上传并部署：所有文件**：先在 `cloudfunctions/ledger` 目录执行 `npm ci --omit=dev`，按该目录的 `package-lock.json` 安装生产依赖，再将代码和本地 `node_modules` 一起上传。本项目采用此流程，便于明确部署依赖版本；不要上传仓库根目录的 `node_modules`。
   - **上传并部署：云端安装依赖（不上传 node_modules）**：上传代码与依赖清单，由云端安装依赖，省去本地安装及上传依赖目录。这种方式也可用；如需严格复现锁文件，应确认云端安装流程遵循 `package-lock.json`，部署后核对 SDK 版本。
   - 两种方式都必须先执行第5步的 `pnpm build:wechat`；云端安装依赖不会替代本项目的构建。若报 `ResourceInUse.FunctionName` / “指定的 FunctionName 已存在，请勿重复创建”，按本步先同步列表，再上传更新已有函数。
7. 云函数仅供小程序云调用，不添加 HTTP 访问服务、定时触发器或公开匿名入口。不配置 OpenAPI 权限和管理员密钥。
8. 在真实微信客户端打开小程序，确认能识别身份并建立默认配置。开发者工具“云端测试”若没有可信微信调用上下文，应返回身份不可用，这不是让客户端补传 OPENID 的理由。

若页面提示无法读取个人数据，在手机点击“重新同步”，按调用时间查看 `ledger` 日志的 `ret_msg`。HTTP 状态200不代表业务成功，应检查返回体的 `ok`。当前错误响应包含 `error.diagnostic.revision: "wechat-request-v2"`，用于确认诊断代码已部署；`INVALID` 还会给出操作名、入口和 payload 的字段名及类型，不包含字段值。若重新部署后的新调用仍没有该标记，检查上传目录、目标环境和生成的 `cloudfunctions/ledger/index.js` 是否包含该标记。微信入口忽略附加的 `userInfo` 和 `tcbContext`，身份仍只取自 `getWXContext()`；其他未知业务字段继续严格拒绝。这两个字段若出现在业务 `payload` 内仍会被拒绝。

小程序端仅在开发版、体验版的调用失败或超时时输出 `[ledger:cloud]` 简短日志（操作、阶段、环境和错误码）；正常请求不打印日志，正式版关闭这类客户端日志。原始 SDK 错误文本、请求参数和响应内容均不打印。服务端保留失败响应中的 `diagnostic` 与对应错误日志，便于排障，不因客户端正式发布而关闭。

若使用 CloudBase CLI，可参考 `cloudbaserc.example.json`，复制为个人部署配置并填写目标环境ID。集合、规则及索引清单仍需按上面步骤配置；不要把此示例理解为自动部署全部数据库资源。

## 可重复验证

```powershell
corepack pnpm test
corepack pnpm build:web
corepack pnpm build:wechat
corepack pnpm check:wechat
```

`check:wechat` 使用本机微信开发者工具自带的 wcc/wcsc 编译全部原生模板和样式。非默认安装位置可设置 `$env:WECHAT_DEVTOOLS_PATH='安装目录'`；未安装编译器时明确失败，不伪装为检查成功。本仓库当前检查脚本按新版Windows开发者工具目录布局提供，其他平台可在开发者工具中执行同等编译检查。

网页回归：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path (Get-Location).Path '.browsers'
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e --workers=4
```

浏览器测试仅证明网页回归；原生页面的事件测试使用微信API替身，不替代iOS/Android真机交互。

## 发布前云端和真机验收

按 `docs/acceptance.md` 执行全部待验项，至少两个真实微信账号、两台设备，并记录系统版本、微信版本、基础库与目标环境。

特别检查首次同时进入只产生一个配置、两个设备同时改价返回冲突、伪造其他用户记录ID被拒绝、断网后保存状态确认、同秒多页记录完整性、测试与正式数据隔离。工具内可对 `wx.cloud.callFunction` 模拟响应丢失，但必须核对真实云数据库中只存在一条对应记录。

320、375、430逻辑像素竖屏及放大字体逐项检查课时键盘、底部按钮、安全区、原生Tab、长金额、返回和恢复前台行为。计算页键盘打开时隐藏固定操作区，由原生输入框调整位置；关闭键盘后恢复底部计算按钮。不能承诺微信终止进程时一定弹出未保存提示。

## 升级与恢复

- 发布前保存上一版云函数包、对应小程序版本及锁文件。先部署支持现有规则的云函数，再发布小程序；让两者在发布窗口内保持兼容。
- 修改排序、系数、阶梯或舍入需新规则版本；增加结构需新schema。保留旧规则复算路径和历史渲染能力，或明确显示兼容提示。不得批量用当前算法改写历史金额。
- 回滚优先恢复上一版云函数和小程序包，不把用户配置或记录回滚成旧数据。不删除配置版本或请求回执，否则会破坏冻结版本保存或防重复语义。
- 单个用户想恢复默认价格，应在设置中恢复到草稿并主动保存，形成新版本。操作不会改变已有记录。
- 发生环境数据损坏时，停止写入、由环境所有者使用云平台备份/恢复能力恢复一致的数据集，并核对四个集合间关系和索引。平台备份是否启用、保留周期及费用由所有者配置，本产品不承诺自动备份试算。
- 不将生产数据、用户输入、价格明细或管理员凭据写入日志、测试夹具和小程序包。入口错误日志输出错误类型与诊断版本；参数错误额外输出已知操作名、入口和 payload 的字段名及类型，不输出字段值或嵌套身份信息。

## SDK核验来源与范围

可信身份和小程序调用的官方说明见[小程序调用云函数](https://docs.cloudbase.net/en/recipes/add-cloud-function-wechat-miniprogram)，事务约束见[数据库事务](https://docs.cloudbase.net/database/transaction)。

本次还直接核对了安装的 `wx-server-sdk@4.0.2/index.js` 与其 `@cloudbase/database@1.4.3/dist/commonjs/transaction/index.js`：可信身份读取上下文、缺失文档返回null选项、事务回调返回值、业务异常回滚和事务冲突重试。自动化测试用实际SDK配合传输替身验证这些接口行为；真实云端事务冲突、规则和索引执行仍在部署后验收，不把本地测试等同于云联调。
