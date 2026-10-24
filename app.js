const cloudApi = require('./utils/cloud.js')
const cloudOrders = require('./utils/cloudOrders.js')
const cloudColl = require('./utils/cloudColl.js')
const C = require('./utils/constants.js')

const SYNC_KEYS = [
  'factory_data', 'product_archive', 'customer_list', 'supplier_list',
  'sample_drafts', 'stock_alerts',
  'work_years', 'factory_list'
]

App({
  globalData: {
    cloud: { ready: false, allowed: false, openid: '', lastSync: 0, error: '', mode: 'local' }
  },

  onShow() {
    const now = Date.now()
    if (now - (this._lastPullAt || 0) < 60000) return
    this._lastPullAt = now
    this.cloudPull(true)
  },

  onLaunch() {
    // 每一步单独兜底：任何一步出错都不能拖累云端初始化，否则整台设备会像"崩了"
    this._launchErrors = []
    const step = (name, fn) => {
      try { fn.call(this) } catch (e) {
        const msg = name + '：' + ((e && e.message) || e)
        this._launchErrors.push(msg)
        try { console.error('[启动异常]', msg) } catch (e2) {}
      }
    }
    step('自动备份', this.autoBackup)
    step('数据迁移', this.migrate)
    step('云初始化', this.initCloud)
    step('网络监听', this.watchNetwork)
    this.globalData.launchErrors = this._launchErrors
  },

  // 页面通过 app.cloudOrders() 直接拿到订单云读写模块（年结存、详情拉单、订单分页都靠它）
  cloudOrders() {
    return cloudOrders
  },

  collectPayload() {
    const out = {}
    SYNC_KEYS.forEach(k => {
      try { out[k] = wx.getStorageSync(k) || '' } catch (e) { out[k] = '' }
    })
    // 订单已经一单一个云端文档，整包里不必再塞一份（否则每次上传都是几十上百 KB）
    try {
      const d = this._safeParse(out.factory_data, null)
      if (d && d.orders) {
        const slim = Object.assign({}, d)
        delete slim.orders
        out.factory_data = JSON.stringify(slim)
      }
    } catch (e) {}
    // 告诉云端「我是基于哪个版本改的」，云端发现别人改过就回 CONFLICT
    out._baseAt = this._cloudBaseAt || 0
    return out
  },

  // ===== 合并工具（多端同时改不要互相覆盖）=====
  _safeParse(raw, fallback) {
    if (!raw) return fallback
    if (typeof raw === 'object') return raw
    try { return JSON.parse(raw) } catch (e) { return fallback }
  },

  _numOrZero(v) { return Number(v) || 0 },

  // 按 key 合并两个数组：同 key 取 updatedAt 新的；本地独有的保留
  mergeList(localList, remoteList, keyFn, timeFn) {
    const map = {}
    const order = []
    ;(localList || []).forEach(x => {
      const k = keyFn(x)
      if (!k) return
      if (!map[k]) order.push(k)
      map[k] = x
    })
    ;(remoteList || []).forEach(r => {
      const k = keyFn(r)
      if (!k) return
      const l = map[k]
      if (!l) { map[k] = r; order.push(k); return }
      const lt = timeFn ? timeFn(l) : 0
      const rt = timeFn ? timeFn(r) : 0
      // 云端更新（或本地没有时间戳）才覆盖
      if (rt > lt) map[k] = Object.assign({}, l, r)
    })
    return order.map(k => map[k])
  },

  // 合并整包 factory_data：订单按 id+updatedAt，其余字段本地有就用本地
  mergeFactoryJSON(localRaw, remoteRaw) {
    const local = this._safeParse(localRaw, null)
    const remote = this._safeParse(remoteRaw, null)
    if (!remote) return localRaw
    if (!local) return JSON.stringify(remote)
    const orders = this.mergeList(local.orders || [], remote.orders || [],
      o => o && o.id, o => this._numOrZero(o && o.updatedAt))
    return JSON.stringify(Object.assign({}, remote, local, {
      orders,
      seq: Math.max(this._numOrZero(local.seq), this._numOrZero(remote.seq)) || 1
    }))
  },

  // 合并集合型数据（产品按 id、客户供应商按名字）
  mergeCollJSON(localRaw, remoteRaw, key) {
    const local = this._safeParse(localRaw, [])
    const remote = this._safeParse(remoteRaw, [])
    if (!Array.isArray(remote)) return localRaw
    if (!Array.isArray(local) || !local.length) return JSON.stringify(remote)
    const merged = this.mergeList(local, remote,
      x => x && (key === 'name' ? x.name : x.id),
      x => this._numOrZero(x && x.updatedAt))
    return JSON.stringify(merged)
  },

  applyCloudPayload(payload) {
    if (!payload) return false
    this._applying = true
    SYNC_KEYS.forEach(k => {
      if (payload[k] === undefined) return
      try {
        const localRaw = wx.getStorageSync(k)
        let next = payload[k]
        if (k === 'factory_data') {
          next = this.mergeFactoryJSON(localRaw, payload[k])
        } else if (k === 'product_archive') {
          next = this.mergeCollJSON(localRaw, payload[k], 'id')
        } else if (k === 'customer_list' || k === 'supplier_list') {
          next = this.mergeCollJSON(localRaw, payload[k], 'name')
        } else if (localRaw) {
          // 打样草稿 / 常备预警 / 工作年：本地有就保留本地，别被云端空值冲掉
          next = localRaw
        }
        wx.setStorageSync(k, next)
      } catch (e) {}
    })
    const at = Number(payload._updatedAt) || Date.now()
    wx.setStorageSync('sync_updated_at', at)
    this._cloudBaseAt = at
    this.clearCache()
    this._applying = false
    return true
  },

  setCloud(patch) {
    this.globalData.cloud = Object.assign({}, this.globalData.cloud, patch)
  },

  watchNetwork() {
    if (!wx.onNetworkStatusChange) return
    wx.onNetworkStatusChange(res => {
      if (!res.isConnected) return
      this.cloudPull(true)
      this.cloudPush(true)
    })
  },

  initCloud() {
    const env = wx.getStorageSync('cloud_env') || 'cloud1-d5gv2u5lo1ad3e74a'
    if (!env) {
      this.setCloud({ error: '未配置云环境（在备份页填写环境 ID）', mode: 'local' })
      return
    }
    if (!wx.cloud) {
      this.setCloud({ error: '当前基础库不支持云开发', mode: 'local' })
      return
    }
    try {
      wx.cloud.init({ env, traceUser: true })
    } catch (e) {
      this.setCloud({ error: '云初始化失败', mode: 'local' })
      return
    }
    this.cloudPull(true)
  },

  cloudCall(action, payload) {
    return cloudApi.call(action, payload)
  },

  cloudPull(silent, force) {
    return cloudApi.call('pull').then(res => {
      if (!res || !res.ok) {
        if (res && res.error === 'NOT_ALLOWED') {
          this.setCloud({ mode: 'pending', allowed: false, openid: res.openid || '', error: '等待管理员授权' })
        } else {
          this.setCloud({ error: (res && res.error) || '未授权', mode: 'local' })
        }
        return null
      }
      this.setCloud({ ready: true, allowed: true, admin: !!res.admin, role: res.role || (res.admin ? 'admin' : 'worker'), openid: res.openid || '', error: '', mode: 'cloud' })
      this._cloudBaseAt = Number(res.updatedAt) || 0
      this.flushPendingPush()
      // 云端为准：订单集合全量覆盖本地
      this.syncOrdersFromCloud().then(() => { try { this.reloadCurrentPage() } catch (e) {} })
      try { wx.setStorageSync('role', res.role || (res.admin ? 'admin' : 'worker')) } catch (e) {}
      this.backfillOrders()
      const localAt = Number(wx.getStorageSync('sync_updated_at')) || 0
      const remoteAt = Number(res.updatedAt) || 0
      let localCount = 0
      try { localCount = (this.getData().orders || []).length } catch (e) {}
      const remoteByOther = !!(res.updatedBy && res.updatedBy !== (this.globalData.cloud.openid || ''))
      const remoteHasOrders = !!(res.payload && res.payload.factory_data &&
        (JSON.parse(res.payload.factory_data || '{}').orders || []).length > 0)
      const localEmpty = localCount === 0 && remoteHasOrders

      if (!res.payload) {
        // 云端为空：把本机数据推上去
        return this.cloudPush(true)
      }
      if (force || remoteAt > localAt || localEmpty || remoteByOther) {
        const payload = Object.assign({}, res.payload, { _updatedAt: remoteAt })
        this.applyCloudPayload(payload)
    this.refreshCollFromCloud()
        this.setCloud({ lastSync: remoteAt })
        this.reloadCurrentPage()
        return res
      }
      if (localAt > remoteAt) {
        return this.cloudPush(true)
      }
      this.setCloud({ lastSync: remoteAt })
      return res
    }).catch(err => {
      this.setCloud({ error: (err && err.errMsg) || '云函数未部署', mode: 'local' })
      return null
    })
  },

  cloudPush(force) {
    const c = this.globalData.cloud
    if (!c.ready) {
      if (force) return Promise.resolve(null)
      return Promise.resolve(null)
    }
    if (this._pushTimer) clearTimeout(this._pushTimer)
    const run = () => {
      const payload = this.collectPayload()
      const send = () => cloudApi.call('push', this.collectPayload()).then(res => {
        // 别人先改过：先合并云端，再把这个合并结果推上去
        if (res && res.error === 'CONFLICT' && res.payload) {
          this.applyCloudPayload(Object.assign({}, res.payload, { _updatedAt: res.updatedAt }))
          return cloudApi.call('push', this.collectPayload()).then(r2 => {
            if (r2 && r2.ok) {
              this._cloudBaseAt = r2.updatedAt
              wx.setStorageSync('sync_updated_at', r2.updatedAt)
              this.setCloud({ lastSync: r2.updatedAt, error: '' })
            }
            return r2
          })
        }
        if (res && res.ok) {
          this._cloudBaseAt = res.updatedAt
          wx.setStorageSync('sync_updated_at', res.updatedAt)
          this.setCloud({ lastSync: res.updatedAt, error: '' })
        }
        return res
      }).catch(() => null)
      return send()
    }
    if (force) return run()
    return new Promise(resolve => {
      this._pushTimer = setTimeout(() => { this._pushTimer = null; run().then(resolve) }, 800)
    })
  },

  // 云数据落地后刷新当前页：优先让页面自己重载数据，避免整页 reLaunch 的闪白和重建
  reloadCurrentPage() {
    try {
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1]
      if (!cur) return
      if (typeof cur.loadOrder === 'function') return cur.loadOrder()
      if (typeof cur.load === 'function') return cur.load()
      if (typeof cur.loadLocal === 'function') return cur.loadLocal()
      if (cur.route) wx.reLaunch({ url: '/' + cur.route })
    } catch (e) {
      try {
        const pages = getCurrentPages()
        const cur = pages[pages.length - 1]
        if (cur && cur.route) wx.reLaunch({ url: '/' + cur.route })
      } catch (e2) {}
    }
  },

  // 每天首次启动自动快照，保留 3 份
  autoBackup() {
    try {
      const today = this.now()
      if (wx.getStorageSync('auto_backup_date') === today) return
      const snapshot = {
        date: today,
        factory_data: wx.getStorageSync('factory_data') || '',
        product_archive: wx.getStorageSync('product_archive') || '',
        customer_list: wx.getStorageSync('customer_list') || '',
        supplier_list: wx.getStorageSync('supplier_list') || '',
            sample_drafts: wx.getStorageSync('sample_drafts') || ''
      }
      for (let i = 3; i > 1; i--) {
        const prev = wx.getStorageSync('auto_backup_' + (i - 1))
        if (prev) wx.setStorageSync('auto_backup_' + i, prev)
      }
      wx.setStorageSync('auto_backup_1', JSON.stringify(snapshot))
      wx.setStorageSync('auto_backup_date', today)
    } catch (e) {}
  },

  // 云端订单集合缺单时，把本地订单整体补推一次（只在云上更少时触发，每次启动最多一次）
  backfillOrders() {
    const c = this.globalData.cloud
    if (!c || !c.ready || this._backfillDone) return
    this._backfillDone = true
    const local = this.getAllOrders()
    if (!local.length) return
    cloudOrders.list({ size: 1 }).then(res => {
      if (!res || !res.ok) return
      if ((Number(res.total) || 0) >= local.length) return
      return cloudOrders.migrate(local)
    }).catch(() => {})
  },

  // 老数据兼容
  migrate() {
    try {
      const raw = wx.getStorageSync('customer_list')
      if (raw) {
        const list = JSON.parse(raw)
        if (Array.isArray(list) && list.some(c => typeof c === 'string')) {
          this.saveCustomers(list.map(c => (typeof c === 'string'
            ? { name: c, contact: '', phone: '', addresses: [] }
            : c)))
        }
      }

      const factories = this.getFactories()
      if (factories.length) {
        const suppliers = this.getSuppliers()
        factories.forEach(name => {
          if (!suppliers.find(s => s.name === name)) {
            suppliers.push({ name, types: ['成品箱'], note: '由代工厂迁移', contact: '', phone: '' })
          }
        })
        this.saveSuppliers(suppliers)
        this.saveFactories([])
      }

      this.migrateOrders()
      this.migrateStepQty()
      this.migrateProducts()
      this.migrateOrderSteps()
    } catch (e) {}
  },

  // 订单升级到 v2：一单多产品、工期、暂缓、入库、分批送货
  migrateOrders() {
    const data = this.getData()
    if (data.v === 2) return
    try { wx.setStorageSync('order_migrate_backup', JSON.stringify(data)) } catch (e) {}

    data.orders = (data.orders || []).map(o => {
      if (o.items) return o
      const qty = Number(o.quantity) || 0
      const item = {
        productId: o.productId || '',
        productName: o.productName || o.product || '',
        craft: o.craft || '草箱',
        paperColor: o.paperColor || '',
        boxType: o.boxType || '',
        flute: o.flute || '',
        sizeL: o.sizeL || 0,
        sizeW: o.sizeW || 0,
        sizeH: o.sizeH || 0,
        tang: o.tang || 0,
        boardL: o.boardL || 0,
        boardW: o.boardW || 0,
        twoPiece: !!o.twoPiece,
        pads: o.pads || [],
        quantity: qty,
        price: Number(o.price) || 0,
        steps: (o.steps || [])
          .map(s => ({
            name: s.name,
            status: s.status,
            doneQty: s.status === 'done' ? qty : 0
          }))
          .filter(s => ['压痕', '烫金', 'UV', '压纹', '送货'].indexOf(s.name) === -1),
        purchases: o.purchases || [],
        factoryMode: o.factoryMode || '本厂生产',
        factoryName: o.factoryName || '',
        factoryPrice: o.factoryPrice || 0,
        stocked: o.status === 'done',
        deliveredQty: o.status === 'done' ? qty : 0
      }
      return {
        id: o.id,
        customer: o.customer || '',
        orderNo: o.orderNo || '',
        status: o.status === 'done' ? 'done' : 'active',
        isSample: !!o.isSample,
        createdAt: o.createdAt || '',
        deliveredAt: o.deliveredAt || '',
        items: [item],
        shipments: (o.status === 'done' && qty)
          ? [{ date: o.deliveredAt || o.createdAt || '', amount: (Number(o.price) || 0) * qty, items: [{ index: 0, qty }] }]
          : []
      }
    })
    data.v = 2
    this.saveData(data)
  },

  // 产品老数据兼容：工序规范化、纸板尺寸按公式刷新
  migrateProducts() {
    const list = this.getProducts()
    if (!list.length) return
    let changed = false
    const next = list.map(p => {
      let q = p
      const steps = C.normalizeSteps(p.steps || [])
      const hadDiff = (p.difficulty && p.difficulty.length) || (p.difficultyValues && Object.keys(p.difficultyValues).length)

      const tang = p.tang != null ? Number(p.tang) : ((p.boxType === '水箱' || p.boxType === '小盒') ? 38 : 48)
      let boardL = p.boardL || 0
      let boardW = p.boardW || 0
      let twoPiece = !!p.twoPiece
      if (!p.boardManual && p.sizeL && p.sizeW && p.sizeH) {
        const r = C.calcBoard(p.sizeL, p.sizeW, p.sizeH, tang, p.craft)
        boardL = r.length
        boardW = r.width
        twoPiece = r.twoPiece
      }

      if (JSON.stringify(steps) !== JSON.stringify(p.steps || []) || hadDiff ||
          boardL !== p.boardL || boardW !== p.boardW || twoPiece !== !!p.twoPiece) {
        changed = true
        q = Object.assign({}, p, { steps, tang, boardL, boardW, twoPiece })
        delete q.difficulty
        delete q.difficultyValues
        delete q.layers
        delete q.materialText
        delete q.paperText
        delete q.nailCount
        delete q.color
        delete q.files
      }
      return q
    })
    if (changed) this.saveProducts(next)
  },

  // 订单老数据：工序规范化（水印→生产，删掉已取消的工序）
  migrateOrderSteps() {
    const data = this.getData()
    // 用 >= 不用 ===：seed 脚本/备份里出现过 stepv=8，=== 判断会让这些数据每次启动都重跑一遍迁移
    if (Number(data.stepv) >= 7) return
    let changed = false
    ;(data.orders || []).forEach(o => {
      // 交期 / 工期 整块删除（1.9.10）
      if (o.deliveryDate != null || o.productionDays != null) {
        delete o.deliveryDate
        delete o.productionDays
        changed = true
      }
      ;(o.items || []).forEach(it => {
        const next = C.normalizeSteps(it.steps || [])
        if (JSON.stringify(next) !== JSON.stringify(it.steps || [])) {
          it.steps = next
          changed = true
        }
        if (it.factoryDeliveryDate != null) {
          delete it.factoryDeliveryDate
          changed = true
        }
        ;(it.purchases || []).forEach(p => {
          if (p.promiseDate != null) { delete p.promiseDate; changed = true }
        })
        if (it.colorText != null) { delete it.colorText; changed = true }
        if (it.difficulty || it.difficultyValues || it.paperLayers || it.paperText || it.nailCount != null) {
          delete it.difficulty
          delete it.difficultyValues
          delete it.paperLayers
          delete it.paperText
          delete it.nailCount
          changed = true
        }
      })
    })
    // 打样草稿里的「要求交期」
    const drafts = this.getDrafts()
    let draftChanged = false
    ;(drafts || []).forEach(d => {
      if (d.deliveryDate != null) { delete d.deliveryDate; draftChanged = true }
    })
    if (draftChanged) this.saveDrafts(drafts)
    data.stepv = 7
    if (changed) this.saveData(data)
    this.migrateOldSubs()
  },

  // 老数据的子单（旧「分批完成」留下的）：母单已经全部入库/拆完的，收回成一个母单
  migrateOldSubs() {
    if (wx.getStorageSync('subs_merged_v1')) return
    const orders = this.getAllOrders()
    const parents = orders.filter(o => !o.isSub && orders.some(s => s.isSub && s.parentId === o.id))
    parents.forEach(p => {
      const allGone = (p.items || []).every(it =>
        it.stocked || it.finished || Number(it.quantity) === 0)
      if (!allGone) return
      try { this.mergeSubOrders(p.id) } catch (e) {}
    })
    wx.setStorageSync('subs_merged_v1', '1')
  },
  // 历史订单：已完成的工序补记完成数量
  migrateStepQty() {
    const data = this.getData()
    let changed = false
    ;(data.orders || []).forEach(o => {
      (o.items || []).forEach(it => {
        const total = Number(it.originalQty) || Number(it.quantity) || 0
        ;(it.steps || []).forEach(s => {
          if (s.status === 'done' && !Number(s.doneQty) && total) {
            s.doneQty = total
            changed = true
          }
        })
      })
    })
    if (changed) this.saveData(data)
  },

  // ================= 订单 =================
  // ===== 本地存储缓存（1.9.22）=====
  // 以前 getData() 每次都 JSON.parse 整包，渲染列表时被调用几百次 → 点击明显卡顿。
  // 现在读走内存缓存，写时同步回 storage。
  _kvRead(key, fallback) {
    const c = this._kv || (this._kv = {})
    if (Object.prototype.hasOwnProperty.call(c, key)) return c[key]
    let v = fallback
    try {
      const raw = wx.getStorageSync(key)
      if (raw) v = JSON.parse(raw)
    } catch (e) {}
    c[key] = v
    return v
  },

  _kvWrite(key, value) {
    const c = this._kv || (this._kv = {})
    c[key] = value
    try { wx.setStorageSync(key, JSON.stringify(value)) } catch (e) {}
    // 订单数据变了，子单索引作废
    if (key === 'factory_data') this._subsCache = null
  },

  // 外部直接改过 storage 时调用（比如导入备份）
  clearCache() {
    this._kv = {}
    this._subsCache = null
  },

  getData() {
    const d = this._kvRead('factory_data', null)
    return d || { orders: [], seq: 1, v: 2 }
  },

  saveData(data) {
    // 订单改动只走 pushOrderCloud（一单一个文档）；整包推送很重，改由产品/客户等操作显式触发
    this._kvWrite('factory_data', data)
  },

  // 只写本地，不触发全量云推送（订单类操作改用 pushOrderCloud 按单推）
  persistLocal(data) {
    this._kvWrite('factory_data', data)
  },

  addOrder(order) {
    const data = this.getData()
    order.id = 'ORD-' + String(data.seq || 1).padStart(3, '0')
    data.seq = (data.seq || 1) + 1
    order.createdAt = order.createdAt || this.today()
    order.status = order.status || 'active'
    order.items = order.items || []
    order.shipments = order.shipments || []
    order.updatedAt = Date.now()
    data.orders.unshift(order)
    this.saveData(data)
    this.pushOrderCloud(order.id)
    return order
  },

  // 加急状态按整棵订单树共享：母单、子单、同根的所有单
  setUrgentTree(orderId, urgent, label) {
    const data = this.getData()
    const target = data.orders.find(o => o.id === orderId)
    if (!target) return
    const rootId = target.isSub && target.parentId ? target.parentId : target.id
    const snaps = []
    data.orders.forEach(o => {
      const sameTree = o.id === rootId || (o.isSub && o.parentId === rootId)
      if (sameTree) {
        try { snaps.push({ id: o.id, order: JSON.parse(JSON.stringify(o)) }) } catch (e) {}
        o.urgent = !!urgent
        o.updatedAt = Date.now()
      }
    })
    this.recordUndo('orders', snaps, label || (urgent ? '标记加急' : '取消加急'))
    this.saveData(data)
    snaps.forEach(s => this.pushOrderCloud(s.id))
  },

  updateOrder(orderId, updater, label) {
    const data = this.getData()
    const order = data.orders.find(o => o.id === orderId)
    if (order) {
      try {
        const snap = JSON.parse(JSON.stringify(order))
        this._undo = this._undo || []
        this._undo.push({ kind: 'order', orderId, order: snap, label: label || '订单操作', at: Date.now() })
        if (this._undo.length > 30) this._undo.shift()
      } catch (e) {}
      updater(order)
      order.updatedAt = Date.now()
      this.saveData(data)
      this.pushOrderCloud(orderId)
    }
    return order
  },

  recordUndo(kind, data, label) {
    this._undo = this._undo || []
    this._undo.push({ kind, data, label, at: Date.now() })
    if (this._undo.length > 20) this._undo.shift()
  },

  setLastUndoLabel(label) {
    const u = this._undo && this._undo[this._undo.length - 1]
    if (u) u.label = label
  },

  undoLabel() {
    const u = this._undo && this._undo[this._undo.length - 1]
    return u ? (u.label || '') : ''
  },

  canUndo() {
    return !!(this._undo && this._undo.length)
  },

  saveOrderLocal(order) {
    if (!order || !order.id) return
    const data = this.getData()
    const i = data.orders.findIndex(o => o.id === order.id)
    if (i > -1) data.orders[i] = Object.assign({}, data.orders[i], order)
    else data.orders.unshift(order)
    this._kvWrite('factory_data', data)
  },

  setCollLocal(coll, items) {
    const key = { products: 'product_archive', customers: 'customer_list', suppliers: 'supplier_list' }[coll]
    if (!key) return
    this._kvWrite(key, items || [])
  },

  refreshCollFromCloud() {
    const c = this.globalData.cloud
    if (!c || !c.ready) return
    ;['products', 'customers', 'suppliers'].forEach(coll => {
      cloudColl.list(coll).then(res => {
        if (!res || !res.ok || !res.list || !res.list.length) return
        const remote = res.list.map(x => {
          const o = Object.assign({}, x)
          delete o._id
          return o
        })
        // 合并而不是整体替换，避免把本机刚建、还没推上去的条目冲掉
        const key = coll === 'products' ? 'id' : 'name'
        const localList = coll === 'products' ? this.getProducts()
          : (coll === 'customers' ? this.getCustomers() : this.getSuppliers())
        const merged = this.mergeList(localList, remote,
          x => x && (key === 'name' ? x.name : x.id),
          x => this._numOrZero(x && x.updatedAt))
        this.setCollLocal(coll, merged)
      }).catch(() => {})
    })
  },


  syncColl(coll, list) {
    const c = this.globalData.cloud
    if (!c || !c.ready) return
    try { cloudColl.bulkSave(coll, list || []) } catch (e) {}
  },

  // ===== 云端为准，但只做「增量」同步 =====
  // 记录上次同步到的时间点，之后只拉改动过的单；首次或超过 6 小时才全量
  syncOrdersFromCloud(forceFull) {
    const c = this.globalData.cloud
    if (!c || !c.ready) return Promise.resolve(0)
    let pending = []
    try { pending = this._kvRead('pending_push', []) || [] } catch (e) { pending = [] }

    const lastAt = Number(this._kvRead('orders_sync_at', 0)) || 0
    const stale = !lastAt || (Date.now() - lastAt > 6 * 3600 * 1000)
    const since = (forceFull || stale) ? 0 : lastAt

    const loadPage = (page, acc) => cloudOrders.list({ page, size: 100, since }).then(res => {
      if (!res || !res.ok) return acc
      const list = (res.list || []).map(o => Object.assign({}, o, { id: o._id || o.id }))
      const all = acc.concat(list)
      if (list.length === 100 && page < 20) return loadPage(page + 1, all)
      return all
    }).catch(() => acc)

    return loadPage(1, []).then(all => {
      const data = this.getData()
      let changed = 0
      const map = {}
      ;(data.orders || []).forEach(o => { if (o && o.id) map[o.id] = o })
      all.forEach(o => {
        if (!o || !o.id) return
        if (o.status === 'deleted') { if (map[o.id]) { delete map[o.id]; changed++ } return }
        if (pending.indexOf(o.id) > -1) return   // 还没推上去的，先别覆盖
        const old = map[o.id]
        // 内容没变就不算改动，避免重复写盘、重复渲染（云函数就算没升级 since 也不会白跑）
        if (old && Number(old.updatedAt) === Number(o.updatedAt)) return
        map[o.id] = Object.assign({}, old || {}, o)
        changed++
      })
      if (since === 0 && !all.length) return 0
      data.orders = Object.keys(map).map(k => map[k])
      const maxAt = all.reduce((m, o) => Math.max(m, Number(o.updatedAt) || 0), since)
      this._kvWrite('orders_sync_at', maxAt || Date.now())
      if (changed) {
        const maxSeq = data.orders.reduce((m, o) => {
          const n = parseInt(String(o.id || '').replace(/\D/g, ''), 10) || 0
          return n > m ? n : m
        }, 0)
        data.seq = Math.max(maxSeq + 1, Number(data.seq) || 1)
        this._kvWrite('factory_data', data)
        this._subsCache = null
      }
      return changed
    })
  },
  // ===== 待补推队列：断网/云函数失败时先把单号记下来，联网后自动补推 =====
  markPendingPush(orderId) {
    if (!orderId) return
    try {
      const list = this._kvRead('pending_push', [])
      if (list.indexOf(orderId) === -1) {
        list.push(orderId)
        this._kvWrite('pending_push', list.slice(-200))
      }
    } catch (e) {}
  },

  clearPendingPush(orderId) {
    try {
      const list = this._kvRead('pending_push', [])
      const next = list.filter(x => x !== orderId)
      if (next.length !== list.length) this._kvWrite('pending_push', next)
    } catch (e) {}
  },

  // 云端就绪后，把之前没推上去的单子补推一遍
  flushPendingPush() {
    const c = this.globalData.cloud
    if (!c || !c.ready) return
    let list = []
    try { list = this._kvRead('pending_push', []).slice(-200) } catch (e) {}
    if (!list.length) return
    list.forEach((id, i) => {
      setTimeout(() => { this._doPushOrder(id, 1, true) }, i * 300)
    })
  },

  pushOrderCloud(orderId, retry) {
    const c = this.globalData.cloud
    if (!c || !c.ready) {
      // 云端没连上：先记账，等连上再补推
      this.markPendingPush(orderId)
      return
    }
    // 同一单 600ms 内的多次改动合并成一次推送（连续点工序时别每次都打云函数）
    this._pushTimers = this._pushTimers || {}
    clearTimeout(this._pushTimers[orderId])
    this._pushTimers[orderId] = setTimeout(() => {
      delete this._pushTimers[orderId]
      this._doPushOrder(orderId, retry)
    }, 600)
  },

  _doPushOrder(orderId, retry, fromQueue) {
    const c = this.globalData.cloud
    if (!c || !c.ready) { this.markPendingPush(orderId); return }
    const o = this.getOrder(orderId)
    if (!o) { this.clearPendingPush(orderId); return }
    // 连续操作时云函数偶发超时，失败自动重试一次，避免云端停在旧版本
    const attempt = n => {
      try {
        cloudOrders.save(o).then(res => {
          if (res && res.ok) { this.clearPendingPush(orderId); return }
          if (n > 0) setTimeout(() => attempt(n - 1), 1200)
          else this.markPendingPush(orderId)
        }).catch(() => {
          if (n > 0) setTimeout(() => attempt(n - 1), 1200)
          else this.markPendingPush(orderId)
        })
      } catch (e) { this.markPendingPush(orderId) }
    }
    attempt(retry == null ? 1 : retry)
  },

  removeOrderCloud(orderId) {
    const c = this.globalData.cloud
    if (!c || !c.ready) return
    try { cloudOrders.remove(orderId) } catch (e) {}
  },

  undoLast() {
    if (!this._undo || !this._undo.length) return null
    const item = this._undo.pop()
    if (item.kind === 'order') {
      const data = this.getData()
      const i = data.orders.findIndex(o => o.id === item.orderId)
      if (i < 0) return null
      data.orders[i] = Object.assign({}, item.order, { updatedAt: Date.now() })
      this.saveData(data)
      // 撤销也要同步到云端，否则其他手机还是撤销前的状态
      this.pushOrderCloud(item.orderId)
      this._subsCache = null
    } else if (item.kind === 'orders') {
      const data = this.getData()
      ;(item.data || []).forEach(s => {
        const i = data.orders.findIndex(o => o.id === s.id)
        if (i > -1) data.orders[i] = Object.assign({}, s.order, { updatedAt: Date.now() })
      })
      this.saveData(data)
      ;(item.data || []).forEach(s => this.pushOrderCloud(s.id))
      this._subsCache = null
    } else if (item.kind === 'stockItem') {
      const data = this.getData()
      const i = data.orders.findIndex(o => o.id === item.orderId)
      if (i > -1) data.orders[i] = item.order
      if (item.subId) data.orders = data.orders.filter(o => o.id !== item.subId)
      this.saveData(data)
      this._subsCache = null
      this.pushOrderCloud(item.orderId)
      if (item.subId) this.removeOrderCloud(item.subId)
      return item
    } else if (item.kind === 'products') {
      this.saveProducts(item.data)
    } else if (item.kind === 'customers') {
      this.saveCustomers(item.data)
    } else if (item.kind === 'suppliers') {
      this.saveSuppliers(item.data)
    }
    return item
  },

  getOrder(orderId) {
    return this.getData().orders.find(o => o.id === orderId)
  },

  getAllOrders() {
    return this.getData().orders.filter(o => o.status !== 'deleted')
  },

  orderQty(order) {
    return (order.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  },


  // 某张单自己的送货总数（不含子单）
  ownShippedQty(order) {
    if (order.shipments && order.shipments.length) {
      return order.shipments.reduce((s, x) =>
        s + (x.items || []).reduce((t, i) => t + (Number(i.qty) || 0), 0), 0)
    }
    const byItem = (order.items || []).reduce((s, it) => s + (Number(it.deliveredQty) || 0), 0)
    if (byItem > 0) return byItem
    return order.status === 'done' ? this.orderQty(order) : 0
  },

  // 送货总数：母单要把已入库子单送掉的数量也算进去
  shippedQty(order) {
    let total = this.ownShippedQty(order)
    if (order && !order.isSub) {
      this.getSubs(order.id).forEach(s => { total += this.ownShippedQty(s) })
    }
    return total
  },

  // 某款产品的已送数量（母单要累加子单上同款产品的送货）
  deliveredOf(order, item) {
    if (!item) return 0
    let n = Number(item.deliveredQty) || 0
    if (order && !order.isSub) {
      this.getSubs(order.id).forEach(s => {
        (s.items || []).forEach(si => {
          if (si.productId === item.productId) n += Number(si.deliveredQty) || 0
        })
      })
    }
    return n
  },

  // 拆出去的子单（未删除）
  // 子单按母单建索引（每单渲染会查很多次，别每次都遍历全部订单）
  subsByParent() {
    if (this._subsCache) return this._subsCache
    const map = {}
    this.getAllOrders().forEach(o => {
      if (o.isSub && o.parentId && o.status !== 'deleted') {
        (map[o.parentId] = map[o.parentId] || []).push(o)
      }
    })
    this._subsCache = map
    return map
  },

  getSubs(parentId) {
    return this.subsByParent()[parentId] || []
  },

  // 这单从下单到现在持续了几天（下单当天算第 1 天）
  elapsedDays(order) {
    const start = order && order.createdAt
    if (!start) return 0
    const s = new Date(start + 'T00:00:00')
    const t = new Date(this.today() + 'T00:00:00')
    const diff = Math.floor((t - s) / 86400000)
    return Math.max(1, diff + 1)
  },


  // ===== 入库数量规则 =====
  // 工序实际完成数量（各工序做到的最少量）
  // 这一道工序要不要填数量（只有纸板到货、面纸印刷要）
  stepNeedsQty(name) {
    return C.QTY_STEPS.indexOf(name) > -1
  },

  // 本批的"基数"：纸板回来多少就出多少箱；彩箱还要看面纸印刷了多少，取小的
  // 代工类没有「纸板到货」这道工序，直接按订单数量
  stepBaseQty(item) {
    const steps = item.steps || []
    // 成品箱 / 代工：没有纸板到货，代工厂回来多少就是多少
    const dai = steps.filter(s => s.name === '代工')[0]
    if (dai) return Number(dai.doneQty) || 0
    const board = steps.filter(s => s.name === '纸板到货')[0]
    const paper = steps.filter(s => s.name === '面纸印刷')[0]
    if (!board && !paper) return Number(item.quantity) || 0
    let base = board ? (Number(board.doneQty) || 0) : (Number(paper.doneQty) || 0)
    if (paper) {
      const p = Number(paper.doneQty) || 0
      base = base ? Math.min(base, p || base) : p
    }
    return base
  },

  // 已完工数量：基数 × 工序完成比例（工序全部完成时就是基数本身）
  completedQtyOf(item) {
    if (!item) return 0
    const steps = item.steps || []
    if (!steps.length) return Number(item.quantity) || 0
    const base = this.stepBaseQty(item)
    if (!base) return 0
    const doneCount = steps.filter(s => s.status === 'done').length
    const cap = this.stockLimitOf(item)
    return Math.min(cap, Math.round(base * (doneCount / steps.length)))
  },

  // 实际入库数量（老数据没有这个字段时回落到订单数量）
  producedQtyOf(item) {
    if (!item) return 0
    const p = Number(item.producedQty)
    if (p > 0) return p
    // 没入库就是 0（以前回落成订单数量，导致"没入库也显示入库 500"）
    if (!item.stocked) return 0
    return Number(item.quantity) || 0
  },

  // 允许超量 10%：订单 1000 最多能入 1100
  // 注意：不能写 Math.ceil(qty * 1.1)，浮点会翻车（100*1.1=110.00000000000001，ceil 变 111）
  // 先乘 11（整数乘法）再除 10 取整，整百整千的数量也不会多算 1 个
  stockLimitOf(item) {
    return Math.ceil((Number(item.quantity) || 0) * 11 / 10)
  },

  // 整单工序完成比例（用于 90% 提前入库）
  completedRatio(order) {
    const items = order.items || []
    let ordered = 0
    let done = 0
    items.forEach(it => {
      const q = Number(it.quantity) || 0
      ordered += q
      done += Math.min(this.completedQtyOf(it), q)
    })
    return ordered > 0 ? done / ordered : 0
  },

  // 单款能否入库：这一款的工序完成 ≥90%，且还没入库
  itemRatio(item) {
    const q = Number(item.quantity) || 0
    if (!q) return 1
    return Math.min(this.completedQtyOf(item), q) / q
  },

  canStockItem(item) {
    if (!item) return false
    if (item.stocked) return false
    if (item.finished) return false
    return this.itemRatio(item) >= 0.9
  },

  // 整单入库：所有还没入库的款都达到 90%
  canStockIn(order) {
    if (!order || order.status === 'done' || order.status === 'deleted') return false
    if (!(order.items || []).length) return false
    if (this.allStocked(order)) return false
    return order.items.every(it => it.stocked || this.canStockItem(it))
  },

  // 入库后的状态：全部送完才算 done，否则 stocked
  applyStockStatus(order) {
    const items = order.items || []
    if (!items.length) return
    const allDelivered = items.every(it => this.deliveredOf(order, it) >= this.producedQtyOf(it))
    order.status = allDelivered ? 'done' : 'stocked'
    order.stockedAt = order.stockedAt || this.today()
    if (allDelivered) order.deliveredAt = order.deliveredAt || this.today()
    else delete order.deliveredAt
  },

  // 所有款都入库了，就把子单自动收回母单（方案甲：整款拆走）
  autoMerge(orderId) {
    const data = this.getData()
    const order = data.orders.find(o => o.id === orderId)
    if (!order || order.isSub) return 0
    if (!(order.items || []).length) return 0
    if (!this.allStocked(order)) return 0
    if (!this.getSubs(orderId).length) return 0
    return this.mergeSubOrders(orderId)
  },

  // 单款入库：把这一款拆成子单入库（母单这款标记为已入库、数量归到子单）
  stockItemIn(orderId, index, qty) {
    const data = this.getData()
    const parent = data.orders.find(o => o.id === orderId)
    if (!parent) return null
    if (parent.status === 'done' || parent.status === 'deleted') return null
    const it = (parent.items || [])[index]
    if (!it || it.stocked) return null
    // 入库前拍个快照，填错数量能撤销
    let parentSnap = null
    try { parentSnap = JSON.parse(JSON.stringify(parent)) } catch (e) {}

    const ordered = Number(it.quantity) || 0
    const limit = this.stockLimitOf(it)
    let n = (qty == null) ? this.completedQtyOf(it) : Number(qty)
    if (!n || n < 0) n = 0
    if (n > limit) n = limit
    if (n <= 0) return null

    // 只剩这一款没入库，就直接整单入库，不拆子单
    const left = (parent.items || []).filter(x => !x.stocked)
    if (left.length <= 1) {
      const qtys = {}
      const i = (parent.items || []).indexOf(it)
      qtys[i] = n
      this.stockIn(orderId, qtys)
      return null
    }

    let sub = data.orders.find(o => o.isSub && o.parentId === parent.id &&
      o.status !== 'deleted' && (o.items || []).some(x => x.productId === it.productId))
    const now = Date.now()

    if (!sub) {
      const copy = JSON.parse(JSON.stringify(it))
      copy.quantity = n
      copy.originalQty = n
      copy.stocked = true
      copy.producedQty = n
      copy.deliveredQty = 0
      copy.splitQty = 0
      copy.finished = false
      if (n < ordered) copy.shortQty = ordered - n
      else delete copy.shortQty
      copy.steps = (copy.steps || []).map(s => Object.assign({}, s, { status: 'done', doneQty: Math.min(n, ordered) }))
      const id = 'ORD-' + String(data.seq || 1).padStart(3, '0')
      data.seq = (data.seq || 1) + 1
      sub = {
        id,
        customer: parent.customer,
        orderNo: parent.orderNo || '',
        status: 'stocked',
        isSub: true,
        parentId: parent.id,
        createdAt: this.today(),
        stockedAt: this.today(),
        items: [copy],
        shipments: [],
        updatedAt: now
      }
      data.orders.unshift(sub)
    } else {
      const si = sub.items.find(x => x.productId === it.productId)
      si.producedQty = (Number(si.producedQty) || 0) + n
      if (si.producedQty < ordered) si.shortQty = ordered - si.producedQty
      else delete si.shortQty
      sub.status = 'stocked'
      sub.updatedAt = now
    }

    // 母单这一款：整款拆走 → 货记在子单里，母单不再重复送货
    it.splitQty = (Number(it.splitQty) || 0) + n
    it.producedQty = n
    it.stocked = true
    it.finished = false
    it.deliveredQty = Number(it.deliveredQty) || 0
    it.steps = (it.steps || []).map(s => Object.assign({}, s, { status: 'done', doneQty: Math.min(n, ordered) }))
    if (n < ordered) it.shortQty = ordered - n
    else delete it.shortQty

    parent.updatedAt = now
    if (parentSnap) {
      this.recordUndo('stockItem', { orderId: parent.id, order: parentSnap, subId: sub && sub.id }, '单款入库')
    }
    this.persistLocal(data)
    this.pushOrderCloud(parent.id)
    if (sub && sub.id) this.pushOrderCloud(sub.id)
    this.autoMerge(parent.id)
    return sub
  },

  // 整单入库：所有还没入库的款一起入库
  stockIn(orderId, qtys) {
    const changed = this.updateOrder(orderId, order => {
      ;(order.items || []).forEach((it, i) => {
        // 已经入过库的（含刚合并进来的子单）不再改数量
        if (it.stocked && Number(it.producedQty) > 0) return
        const ordered = Number(it.quantity) || 0
        const limit = this.stockLimitOf(it)
        let qty = (qtys && qtys[i] != null) ? Number(qtys[i]) : this.completedQtyOf(it)
        if (!qty || qty < 0) qty = 0
        if (qty > limit) qty = limit
        it.stocked = true
        it.producedQty = qty
        if (qty < ordered) it.shortQty = ordered - qty
        else delete it.shortQty
      })
      this.applyStockStatus(order)
    })
    this.autoMerge(orderId)
    return changed
  },

  // 超量生产且订单要求已送完、还剩超量的货 → 卡片标「库存」
  hasStockExtra(order) {
    // 订单要的送完了、还剩下多做的货，才显示「库存」
    return (order.items || []).some(it => {
      const ordered = Number(it.quantity) || 0
      const produced = this.producedQtyOf(it)
      const sent = this.deliveredOf(order, it)
      return produced > ordered && sent >= ordered && sent < produced
    })
  },

  allStocked(order) {
    return (order.items || []).length > 0 && order.items.every(it => it.stocked)
  },

  // 是否还有拆出去的子单
  hasSubOrders(orderId) {
    return this.getAllOrders().some(o => o.isSub && o.parentId === orderId && o.status !== 'deleted')
  },

  // 把子单合并回母单：一款一个数量，入库数按实际做的算（方案甲）
  mergeSubOrders(parentId) {
    const data = this.getData()
    const parent = data.orders.find(o => o.id === parentId)
    if (!parent) return 0
    const subs = data.orders.filter(o => o.isSub && o.parentId === parentId && o.status !== 'deleted')
    if (!subs.length) return 0

    ;(parent.items || []).forEach(it => {
      const ordered = Number(it.originalQty) || Number(it.quantity) || 0
      const subItems = []
      subs.forEach(s => {
        (s.items || []).forEach(si => {
          if (si.productId === it.productId) subItems.push(si)
        })
      })
      const subProduced = subItems.reduce((t, si) => t + this.producedQtyOf(si), 0)
      const subDelivered = subItems.reduce((t, si) => t + (Number(si.deliveredQty) || 0), 0)
      // 这款是被整款拆走的（splitQty>0），货全在子单里；否则货在母单自己身上
      const ownProduced = Number(it.splitQty) > 0 ? 0 : (it.stocked ? this.producedQtyOf(it) : 0)
      const produced = subProduced > 0 ? subProduced : ownProduced

      it.quantity = ordered
      it.originalQty = ordered
      it.splitQty = 0
      it.stocked = true
      it.producedQty = produced
      it.deliveredQty = (Number(it.deliveredQty) || 0) + subDelivered
      it.finished = false
      if (produced < ordered) it.shortQty = ordered - produced
      else delete it.shortQty
      it.steps = (it.steps || []).map(s => Object.assign({}, s, { status: 'done', doneQty: Math.min(produced, ordered) }))
    })

    const mergedShipments = []
    subs.forEach(s => {
      (s.shipments || []).forEach(sh => {
        const items = (sh.items || []).map(row => {
          const si = (s.items || [])[row.index]
          const pi = (parent.items || []).findIndex(x => x.productId === (si && si.productId))
          if (pi < 0) return null
          return { index: pi, qty: row.qty }
        }).filter(Boolean)
        if (items.length) mergedShipments.push({ date: sh.date, amount: sh.amount, items, merged: true })
      })
    })
    parent.shipments = (parent.shipments || []).concat(mergedShipments)

    const subIds = subs.map(s => s.id)
    parent.updatedAt = Date.now()
    data.orders = data.orders.filter(o => !(o.isSub && o.parentId === parentId))
    this.applyStockStatus(parent)
    this.persistLocal(data)
    // 合并后：母单推云，子单从云上删掉，避免别的手机还看到残留子单
    this.pushOrderCloud(parent.id)
    subIds.forEach(id => this.removeOrderCloud(id))
    return subs.length
  },

  // ===== 收货地址（1.9.20）=====
  // 某客户的全部收货地址
  customerAddresses(name) {
    const c = this.getCustomer(name)
    return (c && Array.isArray(c.addresses)) ? c.addresses.filter(a => a && a.address) : []
  },

  // 产品档案里预设的地址，只有和订单客户一致才用；否则退回该客户第一个地址
  defaultAddrFor(product, customerName) {
    const list = this.customerAddresses(customerName)
    if (!list.length) return null
    const preset = product && product.addrPreset
    if (preset && preset.address) {
      if (!preset.customer || preset.customer === customerName) {
        const same = list.find(a => a.address === preset.address)
        if (same) return same
        // 客户地址改过名字也认，直接用预设的
        return { address: preset.address, contact: preset.contact || '', phone: preset.phone || '' }
      }
    }
    return list[0]
  },

  // 订单明细的地址明细（老订单没有 addrList → 用客户第一个地址兜底，数量=订单数量）
  itemAddrList(order, item) {
    if (!item) return []
    if (Array.isArray(item.addrList) && item.addrList.length) {
      return item.addrList.map((a, i) => Object.assign({}, a, {
        index: i,
        qty: Number(a.qty) || 0,
        delivered: this.deliveredOfAddr(order, item, i)
      }))
    }
    const def = this.customerAddresses(order && order.customer)
    const a = def.length ? def[0] : {}
    return [{
      index: 0,
      address: a.address || '',
      contact: a.contact || '',
      phone: a.phone || '',
      qty: Number(item.quantity) || 0,
      delivered: this.deliveredOf(order, item)
    }]
  },

  // 某一款送到某个地址的数量
  deliveredOfAddr(order, item, addrIndex) {
    const idx = (order.items || []).indexOf(item)
    if (idx < 0) return 0
    let n = 0
    let found = false
    ;(order.shipments || []).forEach(s => {
      (s.items || []).forEach(r => {
        if (Number(r.index) !== idx) return
        const ai = (r.addrIndex == null) ? 0 : Number(r.addrIndex)
        if (ai !== addrIndex) return
        found = true
        n += Number(r.qty) || 0
      })
    })
    if (found) return n
    // 老数据：没有地址的送货记录，全部算在第一个地址
    if (addrIndex === 0) return Number(item.deliveredQty) || 0
    return 0
  },
  // 这款还能送多少：被整款拆到子单里的，母单这边可送量为 0
  shippableQty(order, item) {
    if (!item) return 0
    // 没入库就不能送货（以前这里会回落成订单数量，导致"未入库也能送"）
    if (!item.stocked) return 0
    // 整款拆到子单里的，母单这边可送量为 0
    if (!order.isSub && Number(item.splitQty) > 0) return 0
    return Math.max(0, this.producedQtyOf(item) - this.deliveredOf(order, item))
  },
  addShipment(orderId, rows, label) {
    const order = this.updateOrder(orderId, o => {
      const items = o.items || []
      let amount = 0
      const list = []
      rows.forEach(r => {
        const it = items[r.index]
        if (!it || !r.qty) return
        // 送货上限 = 实际入库数量（超量生产的也能送）；拆到子单的部分不在母单送
        const left = this.shippableQty(o, it)
        const qty = Math.min(Number(r.qty), left)
        if (qty <= 0) return
        it.deliveredQty = (Number(it.deliveredQty) || 0) + qty
        amount += qty * (Number(it.price) || 0)
        list.push({ index: r.index, qty, addrIndex: (r.addrIndex == null ? 0 : Number(r.addrIndex)) })
      })
      if (!list.length) return
      o.shipments = o.shipments || []
      o.shipments.push({ date: this.today(), amount, items: list })
      // 实际入库的全部送完才算完成（超量的也要送完）
      if (items.every(it => (Number(it.deliveredQty) || 0) >= this.producedQtyOf(it))) {
        o.status = 'done'
        o.deliveredAt = this.today()
      }
    }, label || '送货')
    // 子单送了货，母单的送货状态跟着更新
    if (order && order.isSub && order.parentId) this.refreshParentStatus(order.parentId)
    return order
  },

  // 子单送货后，重算母单状态（全部送完才是已完成）
  refreshParentStatus(parentId) {
    const data = this.getData()
    const parent = data.orders.find(o => o.id === parentId)
    if (!parent || parent.isSub) return
    if (!this.allStocked(parent)) return
    this.applyStockStatus(parent)
    parent.updatedAt = Date.now()
    this.persistLocal(data)
    this.pushOrderCloud(parent.id)
  },

  // 最近一次该产品的成交价
  getLastPrice(productId) {
    if (!productId) return null
    const priced = []
    this.getAllOrders().forEach(o => (o.items || []).forEach(it => {
      if (it.productId === productId && Number(it.price) > 0) {
        priced.push({
          price: Number(it.price),
          date: o.createdAt || '',
          orderId: o.id,
          customer: o.customer,
          delivered: o.status === 'done'
        })
      }
    }))
    if (!priced.length) return null
    priced.sort((a, b) => {
      if (a.date !== b.date) return String(a.date).localeCompare(String(b.date))
      return String(a.orderId).localeCompare(String(b.orderId))
    })
    const last = priced[priced.length - 1]
    return { price: last.price, date: last.date, orderId: last.orderId, customer: last.customer, delivered: last.delivered }
  },

  // 历史成交价（去重，最近在前）
  getPriceHistory(productId) {
    const map = {}
    this.getAllOrders().forEach(o => {
      (o.items || []).forEach(it => {
        if (it.productId !== productId) return
        const price = Number(it.price) || 0
        if (!price) return
        const key = String(price)
        const rec = { price, date: o.createdAt || '', orderId: o.id }
        if (!map[key] ||
            rec.date > map[key].date ||
            (rec.date === map[key].date && String(rec.orderId) > String(map[key].orderId))) {
          map[key] = rec
        }
      })
    })
    return Object.keys(map).map(k => map[k]).sort((a, b) => {
      if (a.date !== b.date) return String(b.date).localeCompare(String(a.date))
      return String(b.orderId).localeCompare(String(a.orderId))
    })
  },

  // ================= 产品 =================
  getProducts() {
    return this._kvRead('product_archive', [])
  },

  saveProducts(list) {
    this._kvWrite('product_archive', list || [])
    this.syncColl('products', list)
    this.cloudPush()
  },

  getProduct(id) {
    return this.getProducts().find(p => p.id === id) || null
  },

  upsertProducts(items) {
    const list = this.getProducts()
    const map = new Map(list.map(p => [p.id, p]))
    let added = 0
    let updated = 0
    items.forEach(it => {
      if (!it || !it.id) return
      if (map.has(it.id)) {
        map.set(it.id, Object.assign({}, map.get(it.id), it))
        updated++
      } else {
        map.set(it.id, it)
        added++
      }
    })
    this.saveProducts(Array.from(map.values()))
    return { added, updated, total: map.size }
  },

  removeProduct(id) {
    this.saveProducts(this.getProducts().filter(p => p.id !== id))
  },

  // ================= 打样草稿 =================
  getDrafts() {
    return this._kvRead('sample_drafts', [])
  },

  saveDrafts(list) {
    this._kvWrite('sample_drafts', list || [])
    this.syncColl('drafts', list)
    this.cloudPush()
  },

  getDraft(id) {
    return this.getDrafts().find(d => d.id === id) || null
  },

  upsertDraft(draft) {
    const list = this.getDrafts()
    const idx = list.findIndex(d => d.id === draft.id)
    if (idx > -1) list[idx] = draft
    else list.unshift(draft)
    this.saveDrafts(list)
    return draft
  },

  removeDraft(id) {
    this.saveDrafts(this.getDrafts().filter(d => d.id !== id))
  },

  // ================= 客户 =================
  getCustomers() {
    let list = []
    try {
      const raw = wx.getStorageSync('customer_list')
      if (raw) list = JSON.parse(raw)
    } catch (e) {}
    return (list || []).map(c => (typeof c === 'string'
      ? { name: c, contact: '', phone: '', addresses: [] }
      : Object.assign({ addresses: [] }, c)))
  },

  getCustomer(name) {
    return this.getCustomers().find(c => c.name === name) || null
  },

  saveCustomers(list) {
    this._kvWrite('customer_list', (list || []).map(c =>
      (typeof c === 'string'
        ? { name: c, contact: '', phone: '', addresses: [] }
        : c)))
    this.syncColl('customers', list)
    this.cloudPush()
  },

  // ================= 供应商 =================
  getSuppliers() {
    return this._kvRead('supplier_list', [])
  },

  saveSuppliers(list) {
    this._kvWrite('supplier_list', list || [])
    this.syncColl('suppliers', list)
    this.cloudPush()
  },

  getSupplier(name) {
    return this.getSuppliers().find(s => s.name === name) || null
  },

  getServiceSuppliers() {
    const SERVICE = ['代印', '成品箱']
    return this.getSuppliers().filter(s => (s.types || []).some(t => SERVICE.indexOf(t) > -1))
  },

  // 代工厂（老数据）
  getFactories() {
    try {
      const raw = wx.getStorageSync('factory_list')
      if (raw) return JSON.parse(raw)
    } catch (e) {}
    return []
  },

  saveFactories(list) {
    wx.setStorageSync('factory_list', JSON.stringify(list || []))
    this.cloudPush()
  },

  // 代工信息记在订单明细上（item.factoryName/factoryPrice），
  // 所以统计某代工厂一律按明细汇总，不要读订单层
  factoryItems(order, name) {
    return (order.items || []).filter(it => it.factoryName === name)
  },

  factoryAmount(order, name) {
    return this.factoryItems(order, name).reduce((s, it) =>
      s + (Number(it.factoryPrice) || 0) * (Number(it.quantity) || 0), 0)
  },


  // ================= 常备预警 =================
  getStockAlerts() {
    return this._kvRead('stock_alerts', [])
  },

  saveStockAlerts(list) {
    this._kvWrite('stock_alerts', list || [])
    this.cloudPush()
  },

  hasStockAlert(productId) {
    return this.getStockAlerts().some(a => a.productId === productId)
  },

  addStockAlert(productId, orderId, qty) {
    const p = this.getProduct(productId)
    if (!p || !p.stockItem) return
    const alerts = this.getStockAlerts()
    if (alerts.some(a => a.productId === productId)) return
    alerts.unshift({
      id: 'A' + Date.now(),
      productId,
      productName: p.name,
      orderId,
      qty: Number(qty) || 0,
      date: this.today()
    })
    this.saveStockAlerts(alerts)
  },

  removeStockAlert(id) {
    this.saveStockAlerts(this.getStockAlerts().filter(a => a.id !== id))
  },

  // ===== 搜索（1.9.16）=====
  // 空格分词，每个词都要命中；忽略大小写。空关键词视为命中
  matchKeywords(text, keyword) {
    const kw = String(keyword || '').trim().toLowerCase()
    if (!kw) return true
    const t = String(text || '').toLowerCase()
    return kw.split(/\s+/).filter(Boolean).every(w => t.indexOf(w) > -1)
  },

  // 订单的搜索文本：单号、客户、加急、产品编号/名称/PO
  orderSearchText(o) {
    if (!o) return ''
    return [
      o.id, o.orderNo, o.customer, o.urgent ? '加急' : '',
      (o.items || []).map(it => [it.productId, it.productName, it.po].filter(Boolean).join(' ')).join(' ')
    ].filter(Boolean).join(' ')
  },

  // 产品的搜索文本：编号、名称、工艺、箱型、楞型、面纸、客户、备注
  productSearchText(p) {
    if (!p) return ''
    return [
      p.id, p.name, p.craft, p.boxType, p.flute, p.paperColor, p.note,
      (p.customers || []).join(' ')
    ].filter(Boolean).join(' ')
  },
  // 订单卡片视图（订单页与看板共用）
  orderCardData(o) {
    // 母单把每一款都显示出来，已经入库的款单独标注，别让人以为还在做
    const items = o.items || []
    const qty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
    const shipped = this.shippedQty(o)
    const days = this.elapsedDays(o)

    let cls = ''
    // 文案要短，太长了会把单号挤到第二行
    let statusText = '已持续 ' + days + ' 天'
    if (o.status === 'paused') { cls = 'paused'; statusText = '暂缓 ' + days + ' 天' }
    else if (o.status === 'done') { cls = 'done'; statusText = '已完成 ' + days + ' 天' }
    else if (o.status === 'stocked') { cls = 'stocked'; statusText = '已入库 ' + days + ' 天' }

    return {
      id: o.id,
      orderNo: o.orderNo || '',
      customer: o.customer || '其他',
      createdAt: o.createdAt || '',
      elapsedDays: days,
      // 卡片模板要按订单状态决定显隐（如已完成的单不再显示加急标签），
      // 以前漏了这个字段，模板里 item.status 恒为 undefined
      status: o.status || '',
      isSub: !!o.isSub,
      parentId: o.parentId || '',
      earlyFinish: !!o.earlyFinish,
      earlyReason: o.earlyReason || '',
      shortQty: o.shortQty || 0,
      stockTag: this.hasStockExtra(o),
      items: items.map(it => {
        const q = Number(it.quantity) || 0
        const d = Number(it.deliveredQty) || 0
        const p = this.getProduct(it.productId)
        const totalQty = Number(it.originalQty) || q
        const doneQty = Math.min(totalQty, (Number(it.splitQty) || 0) + d)
        if (o.isSub) {
          return {
            productId: it.productId || '',
            productName: it.productName || '',
            quantity: q,
            totalQty: q,
            doneQty: q,
            splitQty: 0,
            finished: !!it.finished,
            showProgress: false,
            lowStock: false
          }
        }
        const doneProd = this.completedQtyOf(it)   // 已做完多少个（纸板/面纸定的基数 × 工序进度）
        return {
          productId: it.productId || '',
          productName: it.productName || '',
          quantity: q,
          totalQty,
          doneQty,
          doneQtyProd: doneProd,
          producedQty: this.producedQtyOf(it),
          stockedTag: !!it.stocked,
          stockedQty: Number(it.producedQty) || 0,
          overQty: Math.max(0, doneProd - q),
          splitQty: Number(it.splitQty) || 0,
          finished: !!it.finished,
          showProgress: false,
          lowStock: !!(p && p.stockItem) && q > 0 && d / q >= 0.8 && d < q
        }
      }),
      qty,
      shipped,
      urgent: !!o.urgent,
      poText: items.map(it => it.po).filter(Boolean).join('、'),
      // 加急优先（红）> 已完成（绿）> 按天数渐变
      ageStyle: '--age:' + (o.urgent ? '#e94560' : (o.status === 'done' ? '#2ecc71' : this.ageColor(days))) + ';',
      cls,
      statusText
    }
  },

  // 订单卡颜色：越久越红（1 天蓝 → 12 天以上红，中间过渡紫/玫红）
  ageColor(days) {
    const t = Math.min(1, Math.max(0, (Number(days) - 1) / 11))
    const hue = Math.round(205 + (355 - 205) * t)
    return 'hsl(' + hue + ', 70%, 50%)'
  },
  // ================= 字体大小 =================
  // 0 标准 / 1 大 / 2 特大。没手动选过时：管理员标准，其他人都默认特大（车间看得清）
  getFontLevel() {
    const raw = wx.getStorageSync('font_level')
    if (raw === '' || raw === null || raw === undefined) {
      return wx.getStorageSync('role') === 'admin' ? 0 : 2
    }
    const v = parseInt(raw, 10)
    return (v === 1 || v === 2) ? v : 0
  },

  getFontClass() {
    const lv = this.getFontLevel()
    return lv === 2 ? 'fs-2' : (lv === 1 ? 'fs-1' : '')
  },

  // ================= 工作年 =================
  getWorkYears() {
    return this._kvRead('work_years', {})
  },

  saveWorkYears(obj) {
    this._kvWrite('work_years', obj || {})
    this.cloudPush()
  },

  workYearRange(year) {
    const cfg = this.getWorkYears()[String(year)] || {}
    return {
      start: cfg.start || (String(year) + '-01-01'),
      end: cfg.end || this.today()
    }
  },

  // ================= 日期 =================
  now() {
    const d = new Date()
    const pad = n => (n < 10 ? '0' + n : '' + n)
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  },

  today() {
    return this.now()
  },

  month() {
    return this.now().slice(0, 7)
  }
})
