const app = getApp()
const C = require('../../utils/constants.js')

const GROUP_MODES = ['按客户', '按工艺', '按箱型', '不分类']
const SORT_MODES = ['客户-品牌-系列', '编号', '名称', '销量（高→低）', '最近下单', '最近更新']

Page({
  data: {
    fontClass: '',
    keyword: '',
    total: 0,
    count: 0,
    sections: [],
    groupModes: GROUP_MODES,
    groupIndex: 0,
    sortModes: SORT_MODES,
    sortIndex: 0,
    openGroups: {},
    brandOpen: {},
    seriesOpen: {},
    dragging: false,
    dragIndex: -1,
    dragDelta: 0,
    dragTarget: -1
  },

  onShow() {
    if (wx.getStorageSync('role') === 'worker') { wx.switchTab({ url: '/pages/orders/orders' }); return } // __workerGuard
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ selected: 1 })
    this.setData({ fontClass: app.getFontClass(), undoLabel: app.undoLabel() })
    this.load()
  },

  // 统计每个产品的销量和最近下单
  buildStats() {
    const stat = {}
    app.getAllOrders().forEach(o => {
      (o.items || []).forEach(it => {
        const id = it.productId
        if (!id) return
        if (!stat[id]) stat[id] = { qty: 0, last: '' }
        // 销量只算已送货数量：没送出去的库存不算销量
        stat[id].qty += Number(it.deliveredQty) || 0
        const d = o.createdAt || ''
        if (d > stat[id].last) stat[id].last = d
      })
    })
    return stat
  },

  load() {
    const kw = this.data.keyword
    const all = app.getProducts()
    const stats = this.buildStats()

    const list = all
      .filter(p => app.matchKeywords(app.productSearchText(p), kw))
      .map(p => {
        const size = p.sizeL ? p.sizeL + '×' + p.sizeW + '×' + p.sizeH + 'mm' : ''
        const st = stats[p.id] || { qty: 0, last: '' }
        return Object.assign({}, p, {
          summary: [p.craft || '草箱', p.boxType, p.flute, size]
            .filter(Boolean).join(' · '),
          customerText: (p.customers && p.customers.length) ? p.customers.join('、') : '',
          outsourceLabel: (p.outsource && p.outsource.mode) ? (p.outsource.mode + (p.outsource.supplier ? ' · ' + p.outsource.supplier : '')) : '',
          salesQty: st.qty,
          lastOrder: st.last,
          idleWarn: st.last ? Math.floor((new Date(app.today()) - new Date(st.last)) / 86400000) > 365 : false,
          })
      })

    const sortIndex = this.data.sortIndex
    list.sort((a, b) => {
      if (sortIndex === 0) return app.compareProductCustomerSeries(a, b)
      if (sortIndex === 1) return String(a.id).localeCompare(String(b.id))
      if (sortIndex === 2) return String(a.name).localeCompare(String(b.name), 'zh')
      if (sortIndex === 3) return b.salesQty - a.salesQty
      if (sortIndex === 4) return String(b.lastOrder || '').localeCompare(String(a.lastOrder || ''))
      if (sortIndex === 5) return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      return String(a.id).localeCompare(String(b.id))
    })

    const groupIndex = this.data.groupIndex
    const openGroups = this.data.openGroups || {}
    const brandOpen = this.data.brandOpen || {}
    const seriesOpen = this.data.seriesOpen || {}
    // 搜索时自动展开，否则结果都被折叠着看不见
    const searching = !!String(this.data.keyword || '').trim()

    // 一组产品按系列分组：有系列的在前（按名称），没系列的归【散单】
    const splitSeries = (items, prefix) => {
      const map = {}
      const order = []
      items.forEach(p => {
        const s = p.series || ''
        if (!(s in map)) { map[s] = []; order.push(s) }
        map[s].push(p)
      })
      order.sort((a, b) => {
        if (!a !== !b) return a ? -1 : 1
        return String(a).localeCompare(String(b), 'zh-Hans-CN')
      })
      return order.map(s => {
        const key = prefix + '|s:' + s
        return { title: s || '【散单】', key, items: map[s], collapsed: searching ? false : !seriesOpen[key] }
      })
    }

    // 品牌层：有品牌的在前，没品牌归【未分品牌】；品牌下再按系列分
    const splitBrands = (items, prefix) => {
      const map = {}
      const order = []
      items.forEach(p => {
        const b = p.brand || ''
        if (!(b in map)) { map[b] = []; order.push(b) }
        map[b].push(p)
      })
      order.sort((a, b) => {
        if (!a !== !b) return a ? -1 : 1
        return String(a).localeCompare(String(b), 'zh-Hans-CN')
      })
      return order.map(b => {
        const key = prefix + '|b:' + b
        return {
          title: b || '【未分品牌】',
          key,
          series: splitSeries(map[b], key),
          count: map[b].length,
          collapsed: searching ? false : !brandOpen[key]
        }
      })
    }

    let sections = []

    if (groupIndex === 3) {
      // 不分类：保持扁平，不插品牌/系列层
      sections = [{
        title: '全部产品',
        key: 'all',
        brands: [{
          title: '',
          key: 'all',
          count: list.length,
          collapsed: false,
          series: [{ title: '', key: 'all|all', items: list, collapsed: false }]
        }]
      }]
    } else if (groupIndex === 0) {
      const rawCustomers = app.getCustomers().map(c => c.name)
      // 客户分组顺序：按用户长按拖拽保存的顺序排，没排过的接在后面
      const savedOrder = wx.getStorageSync('product_customer_order') || []
      const customers = rawCustomers.slice().sort((a, b) => {
        const ia = savedOrder.indexOf(a)
        const ib = savedOrder.indexOf(b)
        if (ia < 0 && ib < 0) return 0
        if (ia < 0) return 1
        if (ib < 0) return -1
        return ia - ib
      })
      const used = {}
      customers.forEach(name => {
        const items = list.filter(p => (p.customers || []).indexOf(name) > -1)
        if (items.length) {
          used[name] = true
          sections.push({ title: name, key: 'c:' + name, brands: splitBrands(items, 'c:' + name) })
        }
      })
      const orphans = list.filter(p => !p.customers || p.customers.length === 0 ||
        p.customers.every(c => !used[c]))
      if (orphans.length) sections.push({ title: '未挂客户', key: 'none', brands: splitBrands(orphans, 'none') })
    } else {
      const keyOf = groupIndex === 1
        ? (p => p.craft || '草箱')
        : (p => p.boxType || '未填箱型')
      const map = {}
      list.forEach(p => {
        const k = keyOf(p)
        if (!map[k]) map[k] = []
        map[k].push(p)
      })
      sections = Object.keys(map).sort().map(k => ({
        title: k,
        key: k,
        brands: [{
          title: '',
          key: k + '|all',
          count: map[k].length,
          collapsed: false,
          series: [{ title: '', key: k + '|all|all', items: map[k], collapsed: false }]
        }]
      }))
    }

    sections = sections.map(s => {
      const count = (s.brands || []).reduce((n, b) => n + (b.count || 0), 0)
      return Object.assign({}, s, { collapsed: searching ? false : !openGroups[s.key], count })
    })

    this.setData({ sections, count: list.length, total: all.length })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.load())
  },

  onGroup(e) {
    this.setData({ groupIndex: Number(e.detail.value) }, () => this.load())
  },

  onSort(e) {
    this.setData({ sortIndex: Number(e.detail.value) }, () => this.load())
  },

  // ===== 客户大标题：长按拖拽排序 =====
  onDragStart(e) {
    const index = Number(e.currentTarget.dataset.index)
    const touch = (e.touches && e.touches[0]) || {}
    if (!Number.isFinite(index) || index < 0) return
    this._suppressTap = true
    // 拖拽时先全部收起并重新渲染，保证每个标题等高，位移计算才准
    this.setData({ openGroups: {}, brandOpen: {}, seriesOpen: {} }, () => {
      this.load()
      setTimeout(() => {
        wx.createSelectorQuery()
          .selectAll('.group-title')
          .boundingClientRect(rects => {
            if (!rects || rects.length < 2) { this._suppressTap = false; return }
            const pitch = rects[1].top - rects[0].top || 0
            if (!pitch) { this._suppressTap = false; return }
            this._drag = { index, pitch, startY: touch.clientY || 0 }
            this.setData({ dragging: true, dragIndex: index, dragDelta: 0, dragTarget: index })
          })
          .exec()
      }, 60)
    })
  },

  onDragMove(e) {
    const d = this._drag
    if (!d) return
    const y = (e.touches && e.touches[0] && e.touches[0].clientY) || 0
    const delta = y - d.startY
    let target = Math.round(d.index + delta / d.pitch)
    target = Math.max(0, Math.min(this.data.sections.length - 1, target))
    this.setData({ dragDelta: delta, dragTarget: target })
  },

  onDragEnd() {
    const d = this._drag
    if (!d) { this._suppressTap = false; return }
    const target = this.data.dragTarget
    const arr = this.data.sections.slice()
    const moved = arr.splice(d.index, 1)[0]
    arr.splice(target, 0, moved)
    this._drag = null
    // 只保存客户组（c: 开头）；落位后写本机，下次进来保持这个顺序
    const keys = arr.filter(s => String(s.key).indexOf('c:') === 0).map(s => String(s.key).slice(2))
    try { wx.setStorageSync('product_customer_order', keys) } catch (e) {}
    this.setData({ dragging: false, dragIndex: -1, dragDelta: 0, dragTarget: -1 }, () => this.load())
    setTimeout(() => { this._suppressTap = false }, 300)
  },

  toggleGroup(e) {
    if (this._suppressTap) return
    const key = e.currentTarget.dataset.key
    const open = Object.assign({}, this.data.openGroups)
    // 客户层也是手风琴：开一个客户，其它客户全部收起；关的时候只关自己
    const openGroups = open[key] ? (delete open[key], open) : { [key]: true }
    // 切换客户时把上一组的系列一起收起，避免下次打开直接弹出一堆产品
    this.setData({ openGroups, seriesOpen: {} }, () => this.load())
  },

  toggleBrandGroup(e) {
    const key = e.currentTarget.dataset.key
    const open = Object.assign({}, this.data.brandOpen)
    // 品牌层手风琴：开一个品牌，其它品牌收起；关的时候只关自己
    const brandOpen = open[key] ? (delete open[key], open) : { [key]: true }
    this.setData({ brandOpen, seriesOpen: {} }, () => this.load())
  },

  toggleSeriesGroup(e) {
    const key = e.currentTarget.dataset.key
    const open = Object.assign({}, this.data.seriesOpen)
    // 手风琴：开一个系列，其它系列全部收起；关的时候只关自己
    const seriesOpen = open[key] ? (delete open[key], open) : { [key]: true }
    this.setData({ seriesOpen }, () => this.load())
  },

  expandAll() {
    // 全部展开：客户、品牌、系列都打开
    const openGroups = {}
    const brandOpen = {}
    const seriesOpen = {}
    ;(this.data.sections || []).forEach(s => {
      openGroups[s.key] = true
      ;(s.brands || []).forEach(b => {
        if (b.title) brandOpen[b.key] = true
        ;(b.series || []).forEach(ser => { if (ser.title) seriesOpen[ser.key] = true })
      })
    })
    this.setData({ openGroups, brandOpen, seriesOpen }, () => this.load())
  },

  collapseAll() {
    this.setData({ openGroups: {}, brandOpen: {}, seriesOpen: {} }, () => this.load())
  },

  goNew() {
    wx.navigateTo({ url: '/pages/product-edit/product-edit' })
  },

  goEdit(e) {
    wx.navigateTo({ url: '/pages/product-edit/product-edit?id=' + e.currentTarget.dataset.id })
  },

  goImport() {
    wx.navigateTo({ url: '/pages/product-import/product-import' })
  },

  undoLast() {
    const item = app.undoLast()
    if (!item) { this.setData({ undoLabel: '' }); return }
    wx.showToast({ title: '已撤销', icon: 'success' })
    this.setData({ undoLabel: app.undoLabel() })
    this.load()
  }
})
