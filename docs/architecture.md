# 架构与数据契约

## 目录与依赖方向

```text
src/                         React 网页，保留独立使用方式
apps/miniprogram/            原生微信小程序（App/Page/WXML/WXSS）
  pages/                    计算、记录、设置、详情
  components/billing-table  原生只读计费表
  app.js                    wx.cloud、缓存、网络、身份生命周期适配
packages/core/              纯计算、金额精度、规则快照和数据契约
packages/application/       与 UI/存储 SDK 无关的会话状态和显示模型
server/                     身份之后的服务端业务、事务仓储适配
cloudfunctions/ledger/      可部署的云函数产物、固定依赖与锁文件
database/                   集合权限与索引部署清单
scripts/                    两端构建、微信原生模板/样式编译检查
docs/requirements/          按网页版、小程序分类的产品需求
```

网页 `src/domain.ts` 只重导出 `packages/core/domain.ts`。小程序和云函数从同一源码构建，不维护第二份计算规则。`core` 不依赖 React、微信、网络或存储；`application` 通过 `Platform` 接口访问身份、配置缓存和云接口，网页未来接入云端时可复用这个会话层，但本次不改造网页账号或持久化方式。

小程序只使用原生页面和组件。构建后的 `runtime.js` 是纯业务与显示模型，不含 React、DOM、Node.js 或 SDK 密钥。`server/testing` 的内存仓储仅用于自动化测试，不进入云函数包，也不是离线保存实现。

## 精度和快照

固定规则版本为 `lower-grade-first-v1`；一至五年级、六年级/初一/初二、初三/高一、高二/高三四组价格，六阶梯共24格。小时为百分之一小时整数，价格和金额为分整数。阶梯宽度3000，最后一阶无上限；系数分子为10、12、13，分母10，每节2小时。

为避免小程序引擎对 BigInt 支持不同，使用十进制数字串完成中间乘法，再按1000的分母逐条四舍五入。超过安全整数范围直接拒绝。测试用独立 BigInt 参考验证2000组中间大数，并保留[网页版需求](requirements/web.md)中的全部 A01–A15 验收。

记录内嵌输入、结果、全部价格、规则版本、年级和班型枚举名称、阶梯边界、系数分子分母、工时与金额单位、排序和舍入说明。历史按存储的明细显示，不调用 `calculate` 重新生成金额。不支持的结构或规则显示兼容提示。

## 身份和会话

云函数入口从 `cloud.getWXContext()` 获取可信 APPID/OPENID，生成应用内用户哈希；从不使用客户端身份作为归属。客户端的 `sessionKey` 仅用于检测调用时微信账号已经改变，服务端始终用可信上下文生成的归属执行操作。每个业务操作严格验证字段；伪造 `openid`、`ownerId`、`userId` 会被拒绝。

前台恢复时先隐藏私人页面数据并确认身份。同一身份恢复会话；账号变化清除输入、结果、配置草稿与来源信息。会话世代号和页面请求序号阻止迟到响应覆盖新账号或新页面。保存中切到后台再返回时转为状态未确认，可主动查询或重试，不承诺后台任务必定完成。

缓存键为 `lesson-ledger:config:v1:<环境ID>:<可信用户哈希>`，仅保存最近已同步配置。身份确认前不读私人缓存。未保存输入、计算结果、历史列表、编辑草稿只在进程内存中保留。恢复网络只重新读取配置，不发送保存请求。

## 云端集合

| 集合 | 主键与内容 | 写入约束 |
| --- | --- | --- |
| user_configs | 用户哈希作为 `_id`；当前版本ID、修订号、服务端创建/更新时间 | 一个用户一份，事务切换指针 |
| config_versions | 用户＋配置请求ID的确定性哈希；完整配置及规则 | 创建后不改写；归属校验后可读旧版本 |
| calculation_records | 用户＋计算请求ID的确定性哈希；完整输入/结果/快照；摘要查询字段 | 事务创建；整条删除；无修改接口 |
| operation_receipts | 用户＋操作类型＋请求ID的确定性哈希；请求指纹、目标ID | 用于配置和记录重试，删除后保留不可逆指纹与删除标记 |

第四个集合保证：即使记录已删除，迟到重试也不能复活已删除输入和快照。记录回执不存输入、金额或计费表；配置回执保留当次成功配置用于确认响应丢失。不能在仍需支持历史重试期间清理回执，不能给它设置 TTL。

`_id` 唯一性与数据库事务共同保证原子性。事务中先检查回执，再验证当前修订或冻结版本，最后整体写入。相同请求标识内容不同拒绝。配置无实际价格变化不增加版本，但保存成功的请求仍有回执。保存结果时按本人的原配置版本复算，并比较完整结果的规范化内容；服务端生成快照和保存时间。

列表强制按本人归属过滤，使用 `savedAt DESC, id DESC` 稳定游标，每页上限20条。游标使用服务端毫秒时间，不使用设备时间。列表只投影摘要，详情另行验证归属。删除不存在或别人的记录统一报“记录不存在或不可访问”，重复删除无数据副作用。

## 接口

统一调用 `wx.cloud.callFunction({name: 'ledger', data: {action, payload, sessionKey}})`，返回 `{ok: true, data}` 或 `{ok: false, error: {code, message}}`。`identity` 不需要 `sessionKey`。

| action | payload |
| --- | --- |
| identity / getConfig | 空对象 |
| saveConfig | requestId、expectedRevision、rates（分整数） |
| configStatus | requestId |
| saveRecord | requestId、versionId、ruleVersion、input、calculatedAt、expectedResult、可选sourceRecordId |
| saveStatus | requestId |
| listRecords | 可选month、cursor（savedAt、id）、limit（1–20） |
| getRecord / deleteRecord | id |

请求体上限128KiB，最多36个课时组合。服务端不接受客户端归属、保存时间或独立替换的快照。未知/不一致结果、无归属版本、其他人的来源记录和非法精度均拒绝；云端错误不会触发默认配置覆盖。
