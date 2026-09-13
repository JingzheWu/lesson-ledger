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
2. 手动创建 `user_configs`、`config_versions`、`calculation_records`、`operation_receipts`、`shared_calculations` 五个集合。业务函数不会在集合缺失或网络失败时擅自建库。已有环境升级本次分享功能，只需新增 `shared_calculations`。
3. 对五个集合逐一设置“仅管理端可读写”，或在自定义权限规则中填入该集合的 `{ "read": false, "write": false }`。完整清单见 `database/permissions.json`。随后验证小程序直接读写均失败，而云函数服务端可以访问。分享也通过云函数读取，不要将分享集合改成所有用户可直接读取。
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

## 真机调试提示组件WXML找不到

若上传错误内层包含 `WXML file not found: ./components/billing-table/index.wxml`，先按组件打包错误排查。文件在 `apps/miniprogram/components/billing-table`，引用中的 `/components/...` 是相对小程序根目录的合法路径。

本项目已关闭 `ignoreDevUnusedFiles` / `ignoreUploadUnusedFiles`，并用 `packOptions.include` 显式保留 `components/billing-table`（路径相对 `miniprogramRoot`）。本机 `project.private.config.json` 的 `ignoreDevUnusedFiles` 也需为 `false`，否则可能覆盖公共配置。修改打包选项后关闭并重新打开项目，清除编译缓存，再编译和真机调试；无需为这项修复重新部署云函数。

`pnpm check:wechat` 会检查组件引用对应的JSON/JS/WXML是否存在，并运行普通WXML、组件懒加载WXML以及WXSS编译。该检查不等同于开发者工具实际上传打包；若重试仍失败，应继续核对开发者工具的打包文件列表和编译缓存。

## 长图保存与只读分享升级

现有微信云开发即可承载本功能，无需自建云服务器、HTTPS域名或额外云存储。客户端用 Canvas 2D 绘制完整明细并导出本地PNG；只有主动生成小程序分享时才向 `ledger` 提交只读快照。参考[微信体系的云函数调用](https://docs.cloudbase.net/en/recipes/add-cloud-function-wechat-miniprogram)、[微信官方API定义（图片保存及分享）](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)。

已有项目按以下顺序更新：

1. 在当前 `cloudEnv` 新建 `shared_calculations`，设置“仅管理端可读写”。只按文档ID访问，无需新增复合索引。
2. 执行 `pnpm build:wechat`，再按上文流程上传并部署 `cloudfunctions/ledger`。本次增加了 `createShare`、`getShare`、`revokeShare`，必须更新云函数；没有新增生产依赖。
3. 在微信公众平台检查并补充《用户隐私保护指引》中相册写入用途，例如“将用户主动生成的课时费明细长图保存到相册”。保存只在用户点击后触发，拒绝权限时页面提供“打开权限设置”，开启后再次点击保存。
4. 重新编译小程序、生成预览或上传体验版，用两个已获体验权限的账号测试发送与接收。面向普通用户使用时需发布包含这些页面的新版本。

明细页底部固定操作栏提供“保存长图到相册”和“分享明细”。分享面板可选“分享长图”或“生成小程序分享”；云端准备好链接后点击“发送小程序给微信好友”。这避免云函数冷启动导致分享回调来不及返回正确链接。长图直接走本地文件，不会生成分享快照；图片消息不附带私人明细页面路径。

分享快照包含当时的输入、金额、阶梯明细、完整24项计费表及计算规则。试算分享不会新增历史记录，后续修改输入或价格不会改变已分享内容。小程序链接持有者可以查看、保存图片和再次转发，但没有复用、编辑或删除入口；左上角首页图标进入接收者自己的计算页。

链接使用云端生成的256位随机令牌，数据库文档ID是令牌哈希；查询响应不包含所有者、原记录ID、来源ID、请求ID或私有配置版本ID。原有 `getRecord` / `deleteRecord` 仍严格限制本人访问。当前链接不自动过期；创建者可在当前明细页分享面板中停止本次链接分享。已保存记录删除后，其历史分享链接也失效；已发送或保存的图片无法撤回。关闭页面后重新生成分享会创建另一条独立链接。

长图按全部正文节点及文字末行测量，保留页面样式、左右16px和底部32px留白。直接使用微信原生PNG导出，优先2倍像素、最长8192px、最多1200万像素。先检查画布右下角实际像素，绘制后校验导出的图片尺寸；设备不支持时依次尝试6144px、4096px，并在页面显示本次兼容分辨率。每次尝试有独立10秒预算。特别长的明细或兼容导出时清晰度会降低。已移除真机耗时过长的JS PNG压缩及fflate依赖。浏览器Canvas验证不能替代微信真机相册、分享菜单和图片尺寸能力验证。

仅更新按钮交互、样式及长图绘制时，执行 `pnpm build:wechat` 后在微信开发者工具重新编译、预览即可，无须重复上传云函数。首次启用上面的只读分享能力仍须完成集合创建与云函数部署。

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

### 长图超时诊断

长图详细日志默认关闭。排查时将 `apps/miniprogram/debug.js` 中的 `detailImage` 改为 `true`，重新编译后，开发版/体验版会在Console输出以 `[ledger:image]` 开头的单行JSON；正式版始终不输出。排查结束改回 `false`。构建不会覆盖这个开关；它不影响超时保护、图片尺寸校验和画布清理。

`revision: image-native-v3` 用于确认诊断版本。在真机调试Console筛选 `ledger:image`，点击一次生成长图，复制从 `export/start` 到 `export/done` 或 `export/failed` 的全部日志。如仍停住，复制已输出的所有行。附上错误提示、手机系统与微信版本。

`run` 区分导出操作；`stage` 标识布局查询、画布setData、边界探测、绘制、原生导出及尺寸校验；`elapsedMs` 是累计时间，`durationMs` 是阶段耗时，`fallback` 表示降级。日志只含阶段、尺寸、数量、耗时和数字错误码，不含身份、文件路径、课时/金额文案、图片像素或原始SDK错误文本。没有日志时先确认Console显示Info级别以及当前为开发版/体验版。

可信身份和小程序调用的官方说明见[小程序调用云函数](https://docs.cloudbase.net/en/recipes/add-cloud-function-wechat-miniprogram)，事务约束见[数据库事务](https://docs.cloudbase.net/database/transaction)。

本次还直接核对了安装的 `wx-server-sdk@4.0.2/index.js` 与其 `@cloudbase/database@1.4.3/dist/commonjs/transaction/index.js`：可信身份读取上下文、缺失文档返回null选项、事务回调返回值、业务异常回滚和事务冲突重试。自动化测试用实际SDK配合传输替身验证这些接口行为；真实云端事务冲突、规则和索引执行仍在部署后验收，不把本地测试等同于云联调。
