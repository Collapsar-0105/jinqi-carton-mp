# 金淇纸箱小程序 交接文档

> 交接对象：接手本项目的新工程师。本文档只写事实，不确定的地方一律标「不确定」。
> 生成时间：2026-10-24（本地时区 Asia/Hong_Kong）
> 代码位置：`D:\个人文件\miniprogram-1`
> 当前版本号：`1.9.43`（定义在 `D:\个人文件\miniprogram-1\utils\constants.js` 的 `APP_VERSION`）

---

## 0. 先看这三件事（免得踩坑）

1. **云函数已部署到最新。** 2026-10-24 09:49 用 MCP 部署 `cloudfunctions/data`（2 个文件，包大小 3.9KB），包含：多关键词搜索、`_baseAt` 冲突检测、`ordersList` 的 `since` 增量参数。部署后已实测：全量 14 条 → 带 `since` 返回 0 条；多词搜索「测试 宏达」4 条 /「金泰」4 条 / 不存在的词 0 条；旧 `_baseAt` 推送返回 `CONFLICT` 并带回云端数据；客户端 `cloudPush(true)` 自动合并重推成功。**如果接手后改了云函数，必须重新部署。**
2. **微信后台已上传 1.9.43**（2026-10-24 09:48，246KB），接手后请确认后台「体验版」指向的是它，而不是更早的 1.9.36。
3. **用户（厂主）在手机上打开小程序时出现过「页面不存在」白屏，根因未确认。** 我做过的事和结论见第 5、6 节，别以为已经解决。

---

## 1. 原始任务

### 1.1 任务来源

厂主（非程序员）提供了一份已经被修改过的项目压缩包 `miniprogram-1_v93_194_20261023_001747.zip`（**此原始包现在不在本机，`D:\个人文件\_backup` 里最早的是 `miniprogram-1_v93_195_20261023_2138.zip`，已经是我改过一版的中间状态**），要求：恢复项目、按他的业务规则继续改、改完上传到微信云开发。

### 1.2 实际完成到什么程度

功能层面基本按需求做完，版本从 1.9.5 一路迭代到 1.9.43，主要需求都实现了：

- 工序体系简化（水印→生产；删掉材质/粘钉/打包），最终变成「纸板到货 / 面纸印刷 / 裱纸 / 生产 / 代印刷 / 代工」
- 删除交期/工期相关一切字段，改为「已持续 X 天」
- 订单卡片重做（两行指标卡、天数渐变色、完成量/订单量、库存标）
- 单个产品拆子单、单款入库、全部入库自动合并
- 产品级默认收货地址 + 订单按地址分配数量 + 按地址送货
- 撤销（带标签反馈）、多端同步冲突合并、断网补推
- 权限（管理员/工人）、设置页按角色裁剪
- 导出/导入模板 17 列（含默认收货地址）

### 1.3 明确没做完的

| 项 | 状态 |
|---|---|
| 真机验证 | **没做**。我只能在微信开发者工具模拟器里操作，无法操作厂主手机 |
| 手机端「页面不存在」白屏 | **没定位根因**（详见 5.3） |
| 「做到 90% 提前入库」与「所有工序做完才能入库」的语义冲突 | 厂主最终选了「所有工序做完才能入库」，我保留了 `itemRatio >= 0.9` 的判断，在当前工序体系下基本等价于「全做完」，但代码里那个 0.9 常量**没有删**，属于历史残留 |
| 导入导出完整往返测试 | **没做**。只验证过模板能导出、能给出 17 列，没有做「导出→改→导入→字段全对」的往返验证 |
| 多设备并发、弱网、大数据量（300+ 单） | **没测** |
| 模拟器页面创建 1.5 秒 | **没解决**，判断是模拟器开销（详见 6.1） |

---

## 2. 改动清单

### 2.1 说明改动基线

我拿不到最初的 `v93_194` 包，所以下面的清单由两部分构成：

- **(A) 可验证部分**：把 `_backup\miniprogram-1_v93_195_20261023_2138.zip` 解压后与当前代码做全文件 MD5 对比得到的差异。这部分**准确**。
- **(B) 无法 diff 部分**：在 v93_195 之前（即 2026-10-23 21:38 之前）我做的改动，只能依据当时的操作记录描述，**准确性低于 (A)**，会标注。

### 2.2 修改过的文件（与 v93_195 相比，全部经 MD5 对比确认）

除特别说明，路径前缀都是 `D:\个人文件\miniprogram-1\`。

#### 数据层（最关键）

**`app.js`（1733 行，改得最多）**

- 新增内存 KV 缓存 `_kvRead / _kvWrite / clearCache`：以前 `getData()` 每次 `JSON.parse` 整包，列表渲染时被调用几百次，点击卡顿。现在读走内存、写同步回 storage。
- 新增 `collectPayload()`：把 `SYNC_KEYS` 里的 key 拼成整包上传。**关键改动：上传前把 `factory_data` 里的 `orders` 删掉**（订单已一单一个云端文档，整包里再塞一份会导致每次上传几十上百 KB）。同时附带 `_baseAt`（客户端当前基线时间戳）。
- 拆分 `pushOrderCloud` / `_doPushOrder`：单条订单推送，600ms 内同一单的多次改动合并成一次云调用。
- 新增 `markPendingPush / clearPendingPush / flushPendingPush`（配 storage key `pending_push`）：断网或云函数失败时记下订单号，云端就绪后自动补推，最多 200 条。
- 新增 `syncOrdersFromCloud(forceFull)`：以云端为准拉订单，**默认增量**（`orders_sync_at` 之后改动的单），首次或距上次超过 6 小时才全量；内容没变的单直接跳过不写盘。
- 新增 `updateOrder(orderId, updater, label)` + `undoLast`：带标签的撤销栈（深拷贝 30 层），覆盖订单/批量订单/库存项/产品/客户/供应商。
- 新增 `setUrgentTree(id, urgent, label)`：加急标记（含子单）可撤销。
- 订单状态与库存：`stockItemIn`（单款入库拆子单）、`stockIn`（整单入库）、`applyStockStatus`、`mergeSubOrders`（方案甲：整款拆出、自动合并）、`autoMerge`、`hasStockExtra`（库存标）、`shippableQty`、`deliveredOf`、`deliveredOfAddr`。
- 地址：`itemAddrList`、`customerAddresses`、`defaultAddrFor`。
- 领域计算：`stockLimitOf`（订单 × 1.1 上限）、`stepBaseQty`（本批基数）、`stepNeedsQty`、`completedQtyOf`、`producedQtyOf`、`itemRatio`、`completedRatio`、`orderCardData`、`cardAgeColor`（按状态分色卡，1.9.48）。
- 启动：`onLaunch` 包了 `step()` 工厂，四步（自动备份 / 迁移 / 云初始化 / 网络监听）**各自 try/catch**，任何一步出错不影响云端初始化（此前串行执行，一步抛错就整台设备白屏）。
- 迁移：`migrate` / `migrateOrders`（订单 v2 结构）/ `migrateProducts` / `migrateOrderSteps`（删交期等字段、工序规范化）/ `migrateStepQty` / `migrateOldSubs`（清理旧「分批完成」留下的子单，用 `subs_merged_v1` 标记只跑一次）。
- 删除的无用函数：`orderAmount`、`allPacked`、`factoryNames`（依据操作记录，v93_195 之前的改动）。

**`utils/constants.js`（155 行）**

- 工序总表 `STEPS` 收敛为：`['纸板到货','面纸印刷','裱纸','生产','代印刷','代工']`
- `QTY_STEPS`（需要填数量的工序）最终为：`['纸板到货','面纸印刷','代工']`。历史上曾包含裱纸/生产，按厂主要求改过多次，**这是最新结论**。
- `DEFAULT_STEPS`：草箱 `['纸板到货','生产']`，彩箱 `['纸板到货','面纸印刷','裱纸']`
- `autoSteps(opts)`：`成品箱 → ['代工']`；彩箱 → 三道；草箱+代印 → `['纸板到货','代印刷']`；否则 `['纸板到货','生产']`。彩箱与代印互斥（代码里强制）。
- `feedLimit(craft)`：彩箱 1600 / 草箱 `MAX_FEED_WIDTH`(2450)，用于纸板两片判定。
- `normalizeSteps()`：水印→生产、剔除已删工序、去重、按总表排序。
- 删除：`COLORS`（颜色枚举）、`BIND_MODES`（钉/粘）、`DIFFICULTY` / `DIFFICULTY_QTY` / `DIFFICULTY_INPUT`（难度因子）、`MATERIAL_TYPES` 里删掉「打包带/钉线」。
- `APP_VERSION = '1.9.43'`。

**`cloudfunctions/data/index.js`（322 行）**

- 新增 `escRe()`、`orderSearchText()`（拼订单搜索文本，含 PO 和「加急」）。
- `ordersList`：支持空格分词多关键词 AND；**注意**云数据库对同一字段不支持多次 where，所以 ≥2 个词时改为「先用第一个词缩小范围 → 服务端 JS 过滤」，一次最多取 1000 条；新增 `since` 参数（`updatedAt > since`，增量拉取）。
- `push`：新增冲突检测 —— 客户端 `_baseAt` 小于云端 `updatedAt` 时返回 `{ok:false, error:'CONFLICT', payload:云端最新, updatedAt}`，客户端据此合并后重推。
- `orderSave` 写入时用 `orderSearchText` 生成 `search` 字段（老数据没有 PO/加急，需重新保存一次才会更新）。
- 其余 action 未改动。

#### 页面

**`pages/orders/orders.js / .wxml / .wxss`**

- 指标卡拆两行：第一行（全部/暂缓/常备预警/已完成）、第二行 3 列（进行中/加急/已入库）；点「常备预警」不是筛选而是 `wx.navigateTo` 到预警页。
- `renderLimit: 120` + `showMore`，避免一次渲染全部卡片。
- 卡片：两段式布局，`--age` CSS 变量驱动左边色带和边框。色卡按状态分流（1.9.48）：加急固定红 > 已完成固定绿 > 暂缓灰蓝；已入库 0~15 天青→深紫、>15 天常驻深紫；进行中 0~5 天浅黄→较深橙红、5~15 天橙红→较深红、>15 天常驻深红。天数与卡片上「已持续/已入库 N 天」一致（均自下单日起算）。
- 卡片数量改为「**完成量 / 订单量**」（如 `450 / 500`），超量标红并加 `超 N` 标签；已入库的款加绿色 `已入库 500` 标。
- 撤销后顶部闪现提示条（`undoFlash`）。
- `refreshFromCloud` 改为调用 `app.syncOrdersFromCloud()`（增量），10 秒节流。
- 「进行中」筛选 `isActive = o => o.status === 'active'`，**不含 paused**（暂缓有自己的 tab）。
- 加载异常兜底：`loadError` + 重试按钮 + 去设置页清缓存入口。
- 删除无用的 preload 尝试：`preloadCommonPages()` 保留但 `wx.preloadPage` 在当前基础库里不存在（`typeof wx.preloadPage === 'undefined'`），实际不生效，是死代码。

**`pages/detail/detail.js / .wxml / .wxss`**

- 只把模板用到的订单字段投影到 `orderView`（1.3KB），不再整个 order `setData`。
- 每款展示地址明细（`addrList`），每个地址一行，可单独送货、单独复制送货信息。
- 工序交互（最新规则）：**只有纸板到货 / 面纸印刷 / 代工弹数量输入框，其余工序点「完成」即完成**，数量自动取 `app.stepBaseQty(it)`；不再累加分批。
- `completeStep(item, step, qty)`：`qty == null` 表示不填数量，直接 `status='done'` 且 `doneQty = stepBaseQty(it)`。
- 工序状态文案简化：数量工序显示「已完成 500 个」，其他显示「已完成」。
- 单款入库按钮（`stockItem`）出现条件：`!isSub && !it.stocked && order.status !== 'done' && app.canStockItem(it) && 未入库款数 > 1`。
- 撤销提示条（`undoToast`）。
- `onLoad` 先设 `orderId` 再 `refreshFromCloud`（此前顺序反了，会用 undefined 发一次空请求并吃掉 10 秒节流）。

**`pages/order/order.js / .wxml / .wxss`**

- 多地址分配：`buildAddrState / syncAddrDerived / toggleAddrPanel / onAddrQty / onAddrPick / setSingleAddrQty`，填数量时自动预填默认地址，改分配要凑满订单数量才能提交。
- 提交校验顺序：产品 → 数量 → 单价 → 代工厂 → 地址分配。
- 保存 `item.addrList`。
- 生产模式 `factoryModes: ['本厂生产','外协代工']`，选外协要填代工厂和代工价（这部分是原有逻辑，未改语义）。

**`pages/backup/backup.js / .wxml`**（设置页）

- `isAdmin` + `requireAdmin()`：只有管理员可见用户管理/清空云端/重置全部/当前数据/导出备份。工人只看字体、云同步状态、拉取数据、导入。
- 新增 `perfCheck()`：测量读整包、写存储、生成全部卡片、渲染耗时。
- 新增 `clearLocalCache()`：清本机 storage 后重登（只清本地，不动云端），**对所有角色可见**（防止云端未连接时管理按钮全隐藏、用户无路可走）。
- 新增启动异常展示：`app.globalData.launchErrors` 渲染成红字卡片。
- `pullCloud()` 点了之后额外调用 `app.syncOrdersFromCloud(true)` 强制全量。

**`pages/users/users.js / .wxml`**

- 删除重复的 `setAdmin`（保留 `setRole`），此前页面上有两个「设为管理员」按钮。
- `load(depth)` 加重试（冷启动时云调用偶发失败会一直转圈）。

**`pages/product-edit/product-edit.js / .wxml`**

- 新增「默认收货地址」picker：`addrOptions / addrIndex / onAddrPreset / applyPresetAddr`，保存为 `product.addrPreset = {address, contact, phone}`。

**`pages/product-import/product-import.js / .wxml`**

- 模板改为 17 列，含 `默认收货地址(客户|地址)`；解析用 `split('|')`；导出也带这一列。

**`pages/product/product.js / .wxml`、`pages/product-select/product-select.js`、`pages/purchase/purchase.js / .wxml`、`pages/directory/directory.js`、`pages/customers/customers.js`、`pages/customer-edit/customer-edit.js`、`pages/customer-detail/customer-detail.wxml`、`pages/suppliers/suppliers.js`、`pages/supplier-edit/supplier-edit.js`、`pages/supplier-detail/supplier-detail.js / .wxml`**

- 联动修改：删掉材质/粘钉/打包/交期相关字段的读写与展示；客户增加 `addresses: [{address, contact, phone}]`；工人守卫（`role === 'worker'` 时 `switchTab` 回订单页）；供应商服务类型 `['代印','成品箱']`。
- 这些文件我只做了删字段和适配，**没有重构**，具体每处改动未逐行记录。

#### 配置

**`app.json`**

- 新增 `"entryPagePath": "pages/orders/orders"`（显式指定首页，试图规避手机端「页面不存在」）。
- 删除 `"pages/board/board"`（看板页已删除）。
- 曾加过 `"lazyCodeLoading": "requiredComponents"`，A/B 测试后**已移除**（对页面创建速度无改善）。

**`project.config.json`**

- ⚠️ **不确定是谁改的**：`setting.es6` 和 `setting.enhance` 现在是 `false`（v93_195 时是 `true`）。可能是开发者工具在切换「ES6 转 ES5」时自动写入，也可能是我某次操作导致。**影响**：关闭了 ES6→ES5 转译，代码里大量使用 `const/let/箭头函数/模板字符串/展开运算符`，依赖微信基础库原生支持（3.x 没问题，极老微信有风险）。**建议接手者确认后改回 `true`**。

**`project.private.config.json`**

- 开发者工具自动维护（`compileHotReLoad`、`libVersion: 3.17.4` 等），我没手动改过内容。

### 2.3 删除的文件

| 文件 | 原因 |
|---|---|
| `D:\个人文件\miniprogram-1\pages\board\board.js` | 看板/对账功能整套删除（厂主明确不要「当前数据」之外的财务视图）。同一批还删了 `ledger_list` / `settle_list` 两个 storage key |
| `D:\个人文件\miniprogram-1\pages\board\board.json` | 同上 |
| `D:\个人文件\miniprogram-1\pages\board\board.wxml` | 同上 |
| `D:\个人文件\miniprogram-1\pages\board\board.wxss` | 同上 |

### 2.4 新建的文件

小程序包内**没有新建任何文件**。

项目外新建了测试/工具脚本，不进小程序包，但接手者需要知道它们存在（都在 `D:\个人文件\_tools\`）：

| 文件 | 用途 |
|---|---|
| `check.js` | 文件结构检查（必需文件是否存在、JSON 是否合法） |
| `bind-check.js` | 扫描 wxml 里所有 `bindtap` 等事件，确认 page js 里有对应方法（防「点了没反应」） |
| `text-check.js` | 扫描 wxml 里被误写入的 `` ` `` / `\n` 转义字面量（防乱码） |
| `tmpl-check.js` | 扫描 wxml `{{}}` 引用的字段是否在 data 里存在（防空白） |
| `logic-test.js` | 52 项业务规则断言（跑在 Node 里，直接 require `utils/constants.js`） |
| `audit-1-rules.js` ~ `audit-10-donebox.js` | 在模拟器内运行的断言脚本（需要 MCP 注入执行） |
| `seed-2.js` / `seed-3.js` / `seed-test-data.js` | 生成测试订单的脚本 |
| `mcp-*.js` / `plan-*.json` | 我用来自动操作微信开发者工具的命令行工具和任务计划（依赖 `wechatide.cmd mcp`，换机器要重新配 token） |

用法示例（需要一个 Node 可执行文件）：

```
node D:\个人文件\_tools\check.js D:\个人文件\miniprogram-1
node D:\个人文件\_tools\bind-check.js D:\个人文件\miniprogram-1
node D:\个人文件\_tools\text-check.js D:\个人文件\miniprogram-1
node D:\个人文件\_tools\tmpl-check.js D:\个人文件\miniprogram-1
node D:\个人文件\_tools\logic-test.js D:\个人文件\miniprogram-1
```

五个都应输出 `✓`，任何一项报 ✗ 都不要上传。

---

## 3. 数据与协议变更（最重要）

### 3.1 storage key 变化

对比 v93_195（经代码 grep 得出）：

**新增 3 个**

| key | 用途 | 写入位置 | 老数据影响 |
|---|---|---|---|
| `pending_push` | 待补推的订单号数组（最多 200） | `app.markPendingPush / clearPendingPush` | 无（读不到就当空数组） |
| `orders_sync_at` | 上次增量同步到的云端 `updatedAt`（毫秒数） | `app.syncOrdersFromCloud` | 无（读不到 = 0 = 触发一次全量） |
| `subs_merged_v1` | 「旧子单已合并」的一次性标记 | `app.migrateOldSubs` | 无（第一次启动会跑一次合并） |

**删除 2 个**

| key | 原因 |
|---|---|
| `ledger_list` | 对账功能删除 |
| `settle_list` | 结算功能删除 |

**保留未动的**：`factory_data`（订单/订单序号/版本标记）、`product_archive`、`customer_list`、`supplier_list`、`sample_drafts`、`stock_alerts`、`work_years`、`factory_list`、`font_level`、`role`、`cloud_env`、`sync_updated_at`、`auto_backup_1..3`、`auto_backup_date`、`last_backup_at`、`order_migrate_backup`（迁移前的整包快照）、`pending_order_filter` / `pending_product_id` / `pending_customer_filter`（跨页传参）。

**结论**：老用户本地数据**不需要手工迁移**，启动时 `migrate()` 会自动处理（见 3.3）。但有两点要注意：
- `factory_data` 里的 `v`（结构版本）从 1 升到 2，`stepv` 升到 8（我在 `seed-3.js` 里写的是 8，而 `migrateOrderSteps` 判定用的是 `stepv === 7`）。**这里有个不一致**：迁移函数判断 `if (data.stepv === 7) return`，也就是说 `stepv=8` 的老数据会被反复执行一次迁移（幂等，无副作用，但属于代码瑕疵）。
- `order_migrate_backup` 只在 `migrateOrders`（v1→v2）时写一次，覆盖式写入，之后不再更新。

### 3.2 数据结构字段变化

**订单 order**

新增（含默认值处理）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `status` | string | `'active'` | 取值：`active` / `paused` / `stocked`（已入库未送完）/ `done`（全部送完）/ `deleted`（软删除） |
| `isSub` | bool | `false` | 是否子单 |
| `parentId` | string | `''` | 子单指向母单 |
| `urgent` | bool | `false` | 加急 |
| `shipments[].items[].addrIndex` | number | `0` | 送货到第几个地址（老记录没有此字段时按 0 处理） |
| `stockedAt` / `deliveredAt` | string | 当天日期 | 入库/送完日期 |
| `earlyFinish` / `earlyReason` / `shortQty` | - | - | 提前完成标记与欠数，早期需求留下的字段，现在基本不用 |

**订单明细 item**

新增：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `originalQty` | number | `quantity` | 拆子单后母单原始数量 |
| `producedQty` | number | `0` | 实际入库数量（可超过 `quantity`，上限 1.1 倍） |
| `shortQty` | number | 无 | 欠数 = 订单数 − 入库数（入库少于订单时才有） |
| `splitQty` | number | `0` | 已拆到子单的数量；母单这一款不再重复送货 |
| `stocked` | bool | `false` | 这一款是否已入库 |
| `finished` | bool | `false` | 这一款是否完成 |
| `deliveredQty` | number | `0` | 已送数量 |
| `addrList` | array | `[]` | `[{address, contact, phone, qty}]`，各地址分配数量之和必须等于 `quantity` |

删除（迁移代码里会 `delete`，老数据自动清理）：`deliveryDate`、`productionDays`、`factoryDeliveryDate`、`colorText`、`difficulty`、`difficultyValues`、`paperLayers`、`paperText`、`nailCount`、`materialText`、`layers`、`purchases[].promiseDate`。

**产品 product**

- 新增 `addrPreset = {address, contact, phone}`（默认收货地址），没有则为空对象/不存。
- 新增 `outsource = { mode: '代印' | '成品箱' }`（外发类型），与本项目前存在但语义收敛。
- 删除 `difficulty` / `difficultyValues` / `layers` / `materialText` / `paperText` / `nailCount`。

**客户 customer**

- `addresses = [{address, contact, phone}]`（多地址）。老数据可能是 `[]`，`migrate()` 会把纯字符串客户升级成对象但**不会补地址**，地址为空时下单不会出现地址选择。

**供应商 supplier**

- `types = ['代印' | '成品箱']`，用于筛选代工厂。

### 3.3 迁移代码位置

全部在 `D:\个人文件\miniprogram-1\app.js`：

- `migrate()`（第 330 行起）：客户字符串→对象、代工厂迁到供应商、调用下面四个
- `migrateOrders()`（362）：订单 v1→v2（单产品→items 数组），写 `order_migrate_backup` 快照，`data.v = 2`
- `migrateProducts()`（420）：工序规范化、纸板尺寸重算、删难度字段
- `migrateOrderSteps()`（459）：删交期/质量字段、工序规范化，`data.stepv = 7`
- `migrateOldSubs()`（507）：合并旧「分批完成」遗留子单，写 `subs_merged_v1`
- `migrateStepQty()`（520）：给已完成的工序补 `doneQty`

### 3.4 同步逻辑改动（变化很大，务必看完）

**改动前**（v93_195 及更早）：整包（含全部订单）双向同步，`push` 一次传全部内容。

**改动后**：

1. **上行**：
   - 整包 `factory_data` **不再包含 orders**（`collectPayload` 里 `delete slim.orders`），整包只有产品/客户/供应商/草稿/预警/工作年/代工厂，约 4KB。
   - 订单走**单条文档**：`utils/cloudOrders.js` → 云函数 `orderSave`，同一单 600ms 内合并、逐单推送。
   - 失败或未联网：订单号进 `pending_push`，`flushPendingPush()` 在云端就绪后按 300ms 间隔补推。
   - 整包 `push` 带 `_baseAt`，云函数发现云端更新过就返回 `CONFLICT` + 最新数据，客户端 `cloudPush(force)` 合并后重推。

2. **下行**：
   - `cloudPull` → `pull` 拿整包 → `applyCloudPayload` 合并（列表按 id 合并，本地独有时保留）→ 然后调用 `syncOrdersFromCloud()`。
   - `syncOrdersFromCloud()` **默认增量**：只拉 `updatedAt > orders_sync_at` 的单；首次（`orders_sync_at` 不存在）或距上次 > 6 小时才全量；单次最多翻 20 页 × 100 条。
   - 拉回来的单：`status === 'deleted'` 的从本地删除，其余按 id 覆盖；**`updatedAt` 没变就跳过**（不写盘不渲染）。
   - 云端为准，但要保留「还没推上去的单」：`pending_push` 里的单号不会被云端版本覆盖。
   - 设置页「从云端拉取最新数据」= `syncOrdersFromCloud(true)` 强制全量。

3. **节流**：订单页 `refreshFromCloud` 10 秒一次；`app.onShow` 的 `cloudPull` 60 秒一次；单条订单推送 600ms 去抖。

### 3.5 云函数

- **action 列表没有增删**（对比 v93_195 完全一致）：`pull` / `push` / `whoami` / `listUsers` / `setAllowed` / `removeUser` / `collList` / `collBulkSave` / `orderSave` / `orderGet` / `orderDelete` / `orderBulkSave` / `ordersList` / `ordersCounts` / `ordersYears` / `archiveYear` / `clearData` / `clearTest`。
- **`ordersList` 参数变化**：新增 `keyword`（空格分词，多词时服务端 JS 过滤）和 `since`（增量）。
- **`push` 行为变化**：新增 `_baseAt` 冲突检测。
- **必须重新部署云端**：本地代码已改，云端还是旧版（除非接手者自己部署）。不部署的后果：多词搜索仍返回 0 条、增量参数被忽略（客户端有兜底，见 6.2）。

---

## 4. 未完成项与临时方案

| # | 项 | 现状 | 原计划 / 建议 |
|---|---|---|---|
| 1 | 「90% 提前入库」门槛 | `canStockItem` 仍判断 `itemRatio >= 0.9`。新工序体系下（只有纸板到货/面纸印刷填数量），这个门槛与「全部工序完成」基本等价，但不完全等价（例如 3 道工序做完 2 道 + 基数刚好 90% 也会放行） | 厂主已确认「所有工序做完才能入库」，建议把条件改成「所有工序 `status === 'done'`」并删掉 0.9 常量 |
| 2 | `pages/orders/orders.js` 的 `preloadCommonPages()` | `wx.preloadPage` 在当前基础库是 `undefined`，整个函数是死代码 | 要么删掉，要么等基础库支持后再用 |
| 3 | 常备预警指标卡的数量口径 | 用 `app.getStockAlerts().length`（全量），不受月份/年份筛选影响；其他卡片都基于当前筛选范围 | 厂主没提，未改。要统一的话在 `loadLocal` 里按 `base` 过滤 |
| 4 | 详情页「进行中」不显示地址明细 | 只有入库后才显示「按地址送货」区块 | 厂主没要求，未做。若需要，在 `detail.wxml` 里把 `addrList` 区块的条件从「已入库」放宽 |
| 5 | 云函数 `since` 参数 | **已部署并验证**（2026-10-24 09:49） | — |
| 6 | 软删除文档在云端累积 | 删除订单是 `status='deleted'`，云端文档仍在，`ordersList` 会返回它们（客户端跳过） | 长期需要定期清理 `status: 'deleted'` 的文档，或加 `T` 字段过滤 |
| 7 | 一键清空测试数据没有 UI | 我都是通过 MCP 脚本直接删云端 collection 完成的 | 厂主需要的话，在设置页加「清空云端订单」按钮（`clearCloud` 现在清的是整包，不是订单集合） |
| 8 | `stepv` 版本号不一致 | `migrateOrderSteps` 判断 `stepv === 7`，但种子脚本写的是 `8` | 把判断改成 `>= 7`，或统一常量 |
| 9 | 导入导出未做往返验证 | 只确认模板 17 列、导出带默认地址列 | 建议补一次「导出→手改两格→导入→字段核对」 |
| 10 | `project.config.json` 的 `es6: false` | 不确定来源 | 确认后改回 `true` |
| 11 | 多款订单全部入库后子单合并 | `autoMerge` 已实现，测过 | — |

---

## 5. 测试情况

### 5.1 测试环境

- **微信开发者工具**：`D:\BaiduNetdiskDownload\微信web开发者工具\微信开发者工具.exe`（版本 2.02.2608080），模拟器基础库 3.17.4
- **操作方式**：通过 `wechatide mcp`（MCP server）+ 我写的 `_tools/mcp-batch.js` 批量执行导航和 `evaluate`，不是手工点
- **云端**：`cloud1-d5gv2u5lo1ad3e74a`，AppID `wx79ba09ee803ec4f6`，云函数 `data` 我部署过一次（2026-10-24 凌晨）
- **真机**：**完全没测**。厂主的手机我碰不到

### 5.2 测过的场景与结果

| 轮次 | 内容 | 结果 |
|---|---|---|
| 静态 | `check.js` 文件结构 | 100 个必需文件全在，JSON 合法 |
| 静态 | `bind-check.js` 事件绑定 | 155 处绑定全部有对应方法 |
| 静态 | `text-check.js` wxml 转义 | 无乱码 |
| 静态 | `tmpl-check.js` 模板字段 | 全部有来源 |
| 静态 | `logic-test.js` 业务规则 | 52 项通过 |
| 静态 | 20 个页面全遍历（`plan-06-smoke.json`） | 20/20 打开成功 |
| 断言 1 | 数据自洽（状态/库存标/完成度/地址分配和/子单孤儿/工序名） | 137 项通过 |
| 断言 2 | 操作边界（单款入库→子单→合并、撤销、删除恢复、负数入库、超量送货截断、空 items、连点工序、特殊字符搜索） | 23 项通过 |
| 断言 3 | 11 张订单逐个加载详情页 + 复制按钮 | 通过（**期间发现 `shippableQty` 对未入库的款返回订单数量的 bug，已修**） |
| 断言 4 | 指标卡数量 vs 实际列表条数 | 10/10（`alerts` 是跳转页而非筛选，我脚本一开始误判） |
| 断言 5 | 新建订单校验（空单、缺数量、缺单价、换客户重建地址、地址未分配、删产品） | 9/9 |
| 断言 6 | 超量规则（110% 上限、库存标出现条件、可送数量） | 50 项通过 |
| 断言 8 | 新工序流程（只有数量工序弹输入、生产自动跟随、彩箱面纸 780→出箱 780） | 13 项通过 |
| 断言 9 | 单款入库（拆子单、母单卡片过滤、全部入库后合并） | 10 项通过 |
| 断言 10 | 成品箱（只有代工一道工序、填 480、欠数 20、可入库） | 9 项通过 |
| 云端 | `pull` / `ordersList` / `listUsers` / `push` 冲突返回 `CONFLICT` / 客户端合并后重推 | 全部 ok |
| 云端 | 多词搜索 `测试 宏达` → 3 单 | 部署后 ok（部署前返回 0，因为云数据库同一字段不支持多次 where） |
| 云端 | 断网入队 `pending_push` → 恢复后清空 | ok |

### 5.3 没测的 / 有隐患的

- **真机、iOS、Android、弱网**：全没测
- **导入导出往返**、**备份恢复**：没测
- **300+ 单的大数据量**：没测（当前只有 14 张测试单）
- **多设备同时改同一单**：只测了「冲突返回 CONFLICT + 客户端合并重推」这一条链路，没有两台真实设备并发
- **手机端「页面不存在」白屏**：厂主在手机上（体验版）反复出现，我这边模拟器复现不了。已做的处理：加 `entryPagePath`（1.9.34）、加启动异常展示、加订单页加载兜底。**根因未确认**。我怀疑过：① 从桌面快捷方式/最近使用进入带着旧路径（`pages/board` 已被删）② 体验版指向旧版本 ③ 手机上 `onLaunch` 抛错导致 `initCloud` 未执行（已加 try/catch 逐步骤兜底）。**三者都未证实**
- **控制台唯一残留报错**：`inspectee MPPage.getCurrent error: Cannot destructure property 'rawPath'...` —— 只在自动化快速跳页时出现，判断是开发者工具调试器自身的噪音，不是业务代码问题（**不确定**，没有深究）
- **模拟器里页面创建耗时约 1.5 秒**（连 619 字节样式的空白页也一样），判断是开发者工具创建 WebView 的固定开销，真机应该快得多（**未在真机验证**）

---

## 6. 已知风险与回滚方式

### 6.1 我认为最可能出问题的地方

1. **云函数未部署 + 客户端已用新参数**：`ordersList` 会忽略 `since`，每次增量同步实际都返回该年全部订单（客户端逐条比对 `updatedAt` 后跳过，功能正确但白耗流量）。多词搜索会返回 0 条。
2. **`project.config.json` 的 `es6: false`**：如果厂主手机微信很旧，`const`/箭头函数可能直接语法报错 → 白屏。这与「页面不存在」的症状不同，但风险更高。
3. **`stepBaseQty` 依赖工序顺序**：如果用户先点「生产」完成（纸板到货还没做），会提示「先完成纸板到货」并拒绝。如果用户从「产品档案」里把工序顺序改乱（比如把生产排在纸板到货前面），`stepBaseQty` 会取不到基数（返回 0），导致入库 0。
4. **`addrList` 与 `quantity` 必须相等**：手工改过 `factory_data`（或用备份恢复旧数据）后，地址分配之和不等于数量时，详情页会显示不完整，提交时会拦截。
5. **软删除文档**：`status: 'deleted'` 的订单永远留在云端，`ordersList` 每次都要传回来（有 `renderLimit` 挡着，不影响渲染，但数据在涨）。
6. **6 小时全量刷新**：`orders_sync_at` 超过 6 小时后下次进入会全量拉一次，订单多时首屏会慢一拍。

### 6.2 最小回滚步骤

**代码回滚**（假设回到 1.9.36 附近，即最后一个上传版本）：

```
1. 从 D:\个人文件\_backup\miniprogram-1_v93_1936_20261024_0802.zip 解压
2. 覆盖回 D:\个人文件\miniprogram-1（该包里 pages/board 已被删除，若需要看板页要另外从更早的包恢复）
3. 恢复 project.config.json 的 es6/enhance 为 true（如果要彻底回滚配置）
```

更近的备份点：
- `miniprogram-1_v93_195_20261023_2138.zip`（最早的本地备份，含 `pages/board`）
- `miniprogram-1_v93_1936_20261024_0802.zip`（最后上传到后台的版本对应代码）
- 完整备份列表在 `D:\个人文件\_backup\`（35 个 zip，按时间排序）

**数据清理**（回滚代码后建议做，否则新字段会残留在 localStorage）：

```
wx.removeStorageSync('pending_push')
wx.removeStorageSync('orders_sync_at')
wx.removeStorageSync('subs_merged_v1')
```
不删也能跑（旧代码读不到这些 key 就当没有），但 `factory_data` 里订单对象仍带 `addrList` / `producedQty` 等新字段，旧代码会忽略它们——**不会崩，但会丢地址分配信息**。

**云端回滚**：把 `cloudfunctions/data/index.js` 恢复成 v93_195 版本后重新部署。若不回滚云函数，新云函数对老客户端是兼容的（`since`、`keyword`、`_baseAt` 都是可选参数），**可以只回滚小程序不回滚云函数**。

### 6.3 回滚需要注意的

- `factory_data` 里 `v=2`、`stepv=7/8` 这两个标记不会因为回滚代码而还原，旧代码看到 `v=2` 会跳过迁移（正确），看到 `stepv=8` 会重复执行一次 `migrateOrderSteps`（幂等）。
- 如果已经产生了子单（`isSub: true`），回滚到不支持子单的版本会导致子单变成孤儿单（列表里显示但母单不存在）。回滚前先执行一次「全部入库」，让 `autoMerge` 把子单合并掉。

---

## 7. 其他备注

### 7.1 当前代码与数据状态（2026-10-24 09:50）

- 版本号：`1.9.43`（本地 = 已上传到微信后台）
- 本地 102 个文件（其中 `HANDOVER.md` 是本文档，不进小程序包；`check.js` 只校验 100 个必需文件，另外 2 个是本文档和 `project.private.config.json`），打包约 245KB
- 订单 14 张（`ORD-001` ~ `ORD-012` 是我用 `seed-3.js` 生成的测试单，`ORD-015` 是示例多款单，`ORD-016` 是 `ORD-015` 拆出来的子单）
- 产品 7 个（`HRS8812`、`TEST01` ~ `TEST06`），客户 4 个（3 个带「【测试】」前缀 + 美的），供应商 3 个（全带「【测试】」）
- 客户地址：宏达 2 个（广州仓 / 佛山厂）、金泰 1 个、远洋 1 个、美的 1 个
- 云端 `orders` 集合与本地大致同步；`app_data` 整包也已同步

**这些全是测试数据，厂主明确说过「数据不重要，功能做好就行」**。正式使用前应该清空所有测试客户/产品/订单。

### 7.2 版本号与上传

- 版本号在 `utils/constants.js` 的 `APP_VERSION`，每次上传前必须改
- 上传工具：微信开发者工具的 MCP（`upload` 命令，参数 `project` / `upload-version` / `desc`），或手动在开发者工具点「上传」
- 上传后还要在微信后台「版本管理」里设为体验版才算生效
- 已上传：1.9.43（最新）。1.9.36 及更早也在后台，**别把体验版指到旧版本上**

### 7.3 厂商业务规则（厂主口述确认过的，代码按这个实现）

- 工序只有 6 个：纸板到货、面纸印刷、裱纸、生产、代印刷、代工
- **只有「纸板到货」「面纸印刷」「代工」填数量**，其余工序点「开始/完成」即可，数量自动跟随
- 不存在「纸板到货 550、生产 500」这种分批，纸板回来多少就出多少箱；彩箱取纸板与面纸的较小值
- 超量上限是订单数量的 1.1 倍
- 入库必须手动点（整单或单款），不自动入库
- 单款订单不出现「入库这一款」按钮；多款订单可以单独入库做完的那一款，入库后该款仍显示在母单卡片上但标注「已入库 N」
- 全部款入库后母单变「已入库」，子单自动合并
- 「进行中」只放在做的单（`status === 'active'`）；暂缓单只在「暂缓」tab；已完成 = 全部送完
- 生产模式两种：本厂生产 / 外协代工（下单时选，要填代工厂和代工价）；产品上另外配「代印 / 成品箱」类型，两处并存
- 彩箱不能选代印刷（代码强制互斥）
- 卡片数量显示「完成量 / 订单量」，超量红色，已入库标绿
- 订单卡片颜色按天数从蓝到红

### 7.4 给接手者的提醒

- 厂主不是程序员，沟通时用「能/不能、做完/没做完」这种话，别讲术语；他反复强调过「拿不准就问，不要自己拍板」
- 他非常反感两件事：① 改完不问就上传 ② 反复跟他解释「本地数据还在」（他认为一切以云端为准）
- 他的测试环境是华为手机 + 微信（体验版），以及这台 Windows 上的开发者工具
- 改代码前先跑那五个静态检查；改完先在模拟器把 20 个页面过一遍，再上传
- `D:\个人文件\_backup` 里有 35 个历史备份，出问题先找最近的备份，别试图逐行回退
