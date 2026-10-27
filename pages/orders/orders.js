const app = getApp()
const THIS_YEAR = new Date().getFullYear()

Page({
  data: {
    fontClass: '',
    keyword: '',
    chipsTop: [],
    chipsMain: [],
    filterKey: 'active',
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
    this.setData({ monthValue: app.month(), years, yearIndex: years.indexOf(THIS_YEAR) })
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
  syncAuthState() {
    const c = (app.globalData && app.globalData.cloud) || {}
    const pending = c.mode === 'pending' || c.allowed === false
    this.setData({ needAuth: !!pending, myOpenid: c.openid || '' })
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

    list = list.slice().sort((a, b) => {
      // 加急置顶同样排除已完成
      const ua = (a.urgent && a.status !== 'done') ? 1 : 0
      const ub = (b.urgent && b.status !== 'done') ? 1 : 0
      if (ua !== ub) return ub - ua
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    })

    // 缓存「筛选+搜索+排序」后的源列表：showMore 据此增量追加，
    // 避免每次「显示更多」都把已渲染的卡片整片重建（1026 单曾达 ~1000ms）
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
  setFilter(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'alerts') { this.goAlerts(); return }
    this.setData({ filterKey: key, renderLimit: 120 }, () => this.load())
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