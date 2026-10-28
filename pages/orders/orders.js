const app = getApp()
const THIS_YEAR = new Date().getFullYear()

Page({
  data: {
    fontClass: '',
    keyword: '',
    chipsTop: [],
    chipsMain: [],
    filterKey: 'active',
    sortKey: 'days',
    // 每种排序各自的方向：{ days:'desc', orderNo:'asc', customer:'asc', stock:'desc' }
    // 'desc' 倒序（多的在前） / 'asc' 正序
    sortDirs: {},
    sortOpen: false,
    sortOptions: [],
    sortLabel: '持续天数',
    // 标题上显示的方向箭头（↓ 倒序 / ↑ 正序）
    sortArrow: '↓',
    list: [],
    alertCount: 0,
    periodType: 0,
    monthValue: '',
    years: [],
    yearIndex: 0,
    yearRangeText: '',
    periodLabel: '',
    periodCount: 0
  },

  onLoad() {
    const years = []
    for (let y = THIS_YEAR + 1; y >= THIS_YEAR - 6; y--) years.push(y)
    let sortKey = 'days'
    let sortDirs = {}
    try {
      sortKey = wx.getStorageSync('order_sort_key') || 'days'
      sortDirs = wx.getStorageSync('order_sort_dirs') || {}
    } catch (e) {}
    if (!sortDirs || typeof sortDirs !== 'object') sortDirs = {}
    this.setData({ monthValue: app.month(), years, yearIndex: years.indexOf(THIS_YEAR), sortKey, sortDirs })
  },

  onShow() {
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ selected: 0 })
    this.setData({ fontClass: app.getFontClass(), undoLabel: app.undoLabel(), workerMode: wx.getStorageSync('role') === 'worker' })
    this.syncAuthState()
    if (!this.data.monthValue) this.setData({ monthValue: app.month() })
    const f = wx.getStorageSync('pending_order_filter')
    if (f) { wx.removeStorageSync('pending_order_filter') }
    this.load()
  },

  // 云端授权状态：没被授权时，订单会是空的，页面上要说清楚为什么
  // 关键：云端校验是异步的，刚进小程序时结果还没回来（checking=true），
  // 这时不能弹「等待授权」——已授权的用户每次进来都要点一下才能看到订单，太烦人。
  // 只有云端明确回了 NOT_ALLOWED（mode='pending'）才提示。
  syncAuthState() {
    const c = (app.globalData && app.globalData.cloud) || {}
    // mode='pending' = 云端已确认未授权；其余情况（还没查/已授权/本地模式）都不提示
    const pending = c.mode === 'pending'
    this.setData({ needAuth: !!pending, myOpenid: c.openid || '' })
    return !!pending
  },

  // 授权状态变化时的回调（app.js 在 pull 结束后会调）
  onAuthStateChanged() {
    const wasNeedAuth = this.data.needAuth
    const pending = this.syncAuthState()
    // 从「待授权」变成已授权：自动把订单拉出来，不用用户点「重新检查」
    if (wasNeedAuth && !pending) {
      this.load()
      return
    }
    if (pending !== wasNeedAuth) this.load()
  },

  // 管理员授权后点一下就能进，不用重启小程序
  recheck() {
    wx.showLoading({ title: '检查中' })
    app.cloudPull(true)
    setTimeout(() => {
      wx.hideLoading()
      this.syncAuthState()
      this.load()
    }, 900)
  },

  copyOpenid() {
    if (!this.data.myOpenid) return
    wx.setClipboardData({ data: this.data.myOpenid })
  },

  periodRange() {
    if (this.data.periodType === 0) {
      const m = this.data.monthValue
      return { start: m + '-01', end: m + '-31', label: m }
    }
    const y = this.data.years[this.data.yearIndex]
    const r = app.workYearRange(y)
    return { start: r.start, end: r.end, label: y + ' 工作年' }
  },

  load() {
    try {
      this.loadLocal()
      this.setData({ loadError: '' })
    } catch (e) {
      // 数据坏了也别白屏，给用户一条自救的路
      this.setData({ loadError: String((e && e.message) || e) })
      return
    }
    try { this.refreshFromCloud() } catch (e) {}
  },

  retryLoad() {
    this.setData({ loadError: '' })
    this.load()
  },


  refreshFromCloud(force) {
    if (app._ordersApiDown) return
    const c = app.globalData.cloud || {}
    if (!c.ready) return
    // 10 秒内不重复拉，避免来回切页卡顿
    const now = Date.now()
    if (!force && this._lastPull && now - this._lastPull < 10000) return
    this._lastPull = now
    // 云端为准：拉全量订单覆盖本地，然后重画
    app.syncOrdersFromCloud().then(n => {
      this._cloudOrders = null
      this.loadLocal()
    }).catch(() => {})
  },
  loadLocal() {
    const all = (this._cloudOrders || app.getAllOrders()).filter(o => o.status !== 'deleted')
    const range = this.periodRange()
    const inRange = d => d && d >= range.start && d <= range.end
    const base = all.filter(o => inRange(o.createdAt))
    // 「进行中」只放在做的单；暂缓有自己的 tab，不再混进来
    const isActive = o => o.status === 'active'

    // 第一行（概览，淡）：全部 / 暂缓 / 常备预警 / 已完成
    // 第二行（干活常点，重）：进行中 / 加急 / 已入库 —— 三个居中铺满
    const chipsTop = [
      { key: 'all', label: '全部', count: base.length },
      { key: 'paused', label: '暂缓', count: base.filter(o => o.status === 'paused').length },
      { key: 'alerts', label: '常备预警', count: app.getStockAlerts().length },
      { key: 'done', label: '已完成', count: base.filter(o => o.status === 'done').length }
    ]
    const chipsMain = [
      { key: 'active', label: '进行中', count: base.filter(isActive).length },
      // 已完成的单不再算加急：货都送完了，加急失去意义（厂主 2026-10-24 要求）
      { key: 'urgent', label: '加急', count: base.filter(o => o.urgent && o.status !== 'done').length },
      { key: 'stocked', label: '已入库', count: base.filter(o => o.status === 'stocked').length }
    ]

    const k = this.data.filterKey
    let list = base
    if (k === 'active') list = base.filter(isActive)
    else if (k === 'urgent') list = base.filter(o => o.urgent && o.status !== 'done')
    else if (k === 'paused') list = base.filter(o => o.status === 'paused')
    else if (k === 'stocked') list = base.filter(o => o.status === 'stocked')
    else if (k === 'done') list = base.filter(o => o.status === 'done')

    const kw = this.data.keyword
    if (String(kw || '').trim()) {
      list = list.filter(o => app.matchKeywords(app.orderSearchText(o), kw))
    }

    list = this.sortList(list)

    // 缓存「筛选+搜索+排序」后的源列表：showMore 据此增量追加，
    // 避免每次「显示更多」都把已渲染的卡片整片重建（1026 单曾达 ~1000ms）
    // 排序选项随板块变：已入库多一个「库存数量」
    // 每项带上各自的方向（↑正序 / ↓倒序），供选项上的箭头显示
    this.setData({
      sortOptions: this.sortOptionList().map(o => Object.assign({}, o, {
        dir: this.currentSortDir(o.key),
        isCur: o.key === this.data.sortKey
      })),
      sortLabel: this.sortLabel(),
      sortArrow: this.sortArrow()
    })
    this._srcList = list
    const lim = Number(this.data.renderLimit) || 120
    const shown = list.slice(0, lim)
    this.setData({
      chipsTop,
      chipsMain,
      list: shown.map(o => app.orderCardData(o)),
      shownCount: shown.length,
      totalCount: list.length,
      hasMore: list.length > shown.length,
      alertCount: app.getStockAlerts().length,
      periodLabel: range.label,
      periodCount: base.length,
      yearRangeText: this.data.periodType === 1 ? (range.start + ' 至 ' + range.end) : ''
    })
  },

  // 筛选/搜索/周期变化都重置 renderLimit=120，避免「先加载很多再切筛选」时重建大片卡片
  onSearch(e) { this.setData({ keyword: e.detail.value, renderLimit: 120 }, () => this.load()) },
  // ===== 排序 =====
  // 天数口径：进行中/加急/全部/已完成按「已持续天数」，
  // 已入库按「已入库天数」（和卡片上显示的数一致，1.9.53）
  sortDays(o) {
    return o && o.status === 'stocked' ? app.stockedDays(o) : app.elapsedDays(o)
  },

  // 库存数量：已入库但还没送出的数量（入库数 - 已送数）
  sortStockQty(o) {
    let n = 0
    ;((o && o.items) || []).forEach(it => {
      const made = Number(it.producedQty) || 0
      const sent = Number(it.deliveredQty) || 0
      n += Math.max(0, made - sent)
    })
    return n
  },

  // 排序选项：已入库板块多一个「库存数量」
  // 每种排序有自己的默认方向（第一次选中时用），之后用户可以自己切换正/倒序
  sortOptionList() {
    return this.sortOptionListFor(this.data.filterKey)
  },

  // 按指定板块算排序选项（切板块时要先算，不能用 data 里还没更新的 filterKey）
  sortOptionListFor(board) {
    const opts = [
      { key: 'days', label: this.daysLabelFor(board), defDir: 'desc' },
      { key: 'orderNo', label: '订单号', defDir: 'asc' },
      { key: 'customer', label: '客户', defDir: 'asc' }
    ]
    if (board === 'stocked') opts.push({ key: 'stock', label: '库存数量', defDir: 'desc' })
    return opts
  },

  // 天数那一档的名字，按板块说清楚是哪种天数
  daysLabel() {
    return this.daysLabelFor(this.data.filterKey)
  },

  daysLabelFor(board) {
    if (board === 'stocked') return '入库天数'
    if (board === 'done') return '完成天数'
    return '持续天数'
  },

  sortLabel() {
    const hit = this.sortOptionList().find(o => o.key === this.data.sortKey)
    return hit ? hit.label : this.daysLabel()
  },

  // 标题上的方向箭头
  sortArrow() {
    return this.currentSortDir() === 'asc' ? '↑' : '↓'
  },

  // 当前排序类型对应的方向
  // 每种排序的方向各自记（sortDirs），没记过就用该类型的默认方向
  currentSortDir(key) {
    const k = key || this.data.sortKey || 'days'
    const saved = (this.data.sortDirs || {})[k]
    if (saved === 'asc' || saved === 'desc') return saved
    const opt = this.sortOptionList().find(o => o.key === k)
    return opt ? opt.defDir : 'desc'
  },

  // 排序列表：按当前排序类型 + 当前方向
  sortList(list) {
    const key = this.data.sortKey || 'days'
    const asc = this.currentSortDir() === 'asc'
    const arr = list.slice()
    if (key === 'orderNo') {
      // 订单号：默认正序（ORD-001 在前），可切成倒序
      return arr.sort((a, b) => {
        const x = String((a && (a.orderNo || a.id)) || '')
        const y = String((b && (b.orderNo || b.id)) || '')
        const c = x.localeCompare(y)
        return asc ? c : -c
      })
    }
    if (key === 'customer') {
      return arr.sort((a, b) => {
        const x = String((a && a.customer) || '其他')
        const y = String((b && b.customer) || '其他')
        const c = x.localeCompare(y, 'zh-Hans-CN')
        if (c !== 0) return asc ? c : -c
        const t = String((a && a.id) || '').localeCompare(String((b && b.id) || ''))
        return asc ? t : -t
      })
    }
    if (key === 'stock') {
      // 库存数量：默认多的在前，可切成少的在前
      return arr.sort((a, b) => {
        const c = this.sortStockQty(a) - this.sortStockQty(b)
        return asc ? c : -c
      })
    }
    // 默认：天数。默认多的在前（最压手的排最前），可切成少的在前
    // 加急始终置顶（不管什么方向，加急的单都要在最上面）
    return arr.sort((a, b) => {
      const ua = (a.urgent && a.status !== 'done') ? 1 : 0
      const ub = (b.urgent && b.status !== 'done') ? 1 : 0
      if (ua !== ub) return ub - ua
      const d = this.sortDays(a) - this.sortDays(b)
      if (d !== 0) return asc ? d : -d
      const t = String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      return asc ? t : -t
    })
  },

  // 展开 / 收起排序条
  toggleSort() {
    this.setData({ sortOpen: !this.data.sortOpen })
  },

  setSort(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    // 换排序类型：这一项之前调过的方向继续用，没调过就用它的默认方向
    const dirs = Object.assign({}, this.data.sortDirs || {})
    if (dirs[key] !== 'asc' && dirs[key] !== 'desc') {
      const opt = this.sortOptionList().find(o => o.key === key)
      dirs[key] = opt ? opt.defDir : 'desc'
    }
    try {
      wx.setStorageSync('order_sort_key', key)
      wx.setStorageSync('order_sort_dirs', dirs)
    } catch (e) {}
    this.setData({ sortKey: key, sortDirs: dirs, sortOpen: false, renderLimit: 120 }, () => this.load())
  },

  // 点方向箭头：
  //   点当前项的箭头 → 只翻这一项的方向
  //   点别的项的箭头 → 先切到那一项，再翻它的方向
  toggleSortDir(e) {
    const key = (e && e.currentTarget && e.currentTarget.dataset.key) || this.data.sortKey
    const dirs = Object.assign({}, this.data.sortDirs || {})
    const cur = this.currentSortDir(key)
    dirs[key] = cur === 'asc' ? 'desc' : 'asc'
    try {
      wx.setStorageSync('order_sort_key', key)
      wx.setStorageSync('order_sort_dirs', dirs)
    } catch (e) {}
    this.setData({ sortKey: key, sortDirs: dirs, renderLimit: 120 }, () => this.load())
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'alerts') { this.goAlerts(); return }
    // 换板块后，当前排序类型可能在新板块里不存在
    //（比如在「已入库」选了「库存数量」，切到「进行中」就没这一项了），
    // 这时要回落成天数排序，不然标题显示的和实际排的不一致
    // 注意：sortOptionList() 读的是 this.data.filterKey，这里要按新板块算
    const opts = this.sortOptionListFor(key)
    let sortKey = this.data.sortKey
    if (!opts.some(o => o.key === sortKey)) {
      sortKey = 'days'
      try { wx.setStorageSync('order_sort_key', sortKey) } catch (e) {}
    }
    this.setData({ filterKey: key, sortKey, renderLimit: 120 }, () => this.load())
  },
  setPeriod(e) { this.setData({ periodType: Number(e.currentTarget.dataset.index), renderLimit: 120 }, () => this.load()) },
  onMonthChange(e) { this.setData({ monthValue: e.detail.value, renderLimit: 120 }, () => this.load()) },
  onYearChange(e) { this.setData({ yearIndex: Number(e.detail.value), renderLimit: 120 }, () => this.load()) },

  onPullDownRefresh() {
    app.cloudPull(true).then(() => { this.load(); wx.stopPullDownRefresh() })
      .catch(() => wx.stopPullDownRefresh())
  },

  goNew() { wx.navigateTo({ url: '/pages/order/order' }) },
  goSamples() { wx.navigateTo({ url: '/pages/samples/samples' }) },
  goAlerts() { wx.navigateTo({ url: '/pages/stock-alerts/stock-alerts' }) },
  goBackup() { wx.navigateTo({ url: '/pages/backup/backup' }) },

  undoLast() {
    const item = app.undoLast()
    if (!item) { this.setData({ undoLabel: app.undoLabel() }); return }
    const label = item.label || '上一步操作'
    this.setData({ undoLabel: app.undoLabel(), undoFlash: '已撤销：' + label })
    wx.showToast({ title: '已撤销：' + label, icon: 'none', duration: 2200 })
    clearTimeout(this._undoTimer)
    this._undoTimer = setTimeout(() => this.setData({ undoFlash: '' }), 2800)
    this.load()
  },

  // 一次多渲染 120 单：只对新增的这 120 单生成卡片，并用「路径式 setData」只追加
  // 这部分到视图，不把已渲染的整片列表重新传一遍 —— 数据量大时越点越卡的根因就在这
  showMore() {
    const src = this._srcList || []
    const oldLen = (this.data.list || []).length
    const lim = (Number(this.data.renderLimit) || 120) + 120
    // 源列表若是旧的（数据/筛选已变），回退到全量重建保证正确
    if (!src.length || oldLen > src.length) {
      this.setData({ renderLimit: lim }, () => this.loadLocal())
      return
    }
    const more = src.slice(oldLen, lim).map(o => app.orderCardData(o))
    const patch = {
      renderLimit: lim,
      shownCount: Math.min(lim, src.length),
      hasMore: src.length > lim
    }
    more.forEach((c, i) => { patch['list[' + (oldLen + i) + ']'] = c })
    this.setData(patch)
  },

  goDetail(e) { wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id }) }
})