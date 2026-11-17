const app = getApp()
const C = require('../../utils/constants.js')

const GROUP_MODES = ['按客户', '按工艺', '按箱型', '不分类']
const SORT_MODES = ['客户-系列', '编号', '名称', '单价（高→低）', '销量（高→低）', '最近下单', '最近更新']

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
    collapsed: {},
    seriesOpen: {}
  },

  onShow() {
    if (wx.getStorageSync('role') === 'worker') { wx.switchTab({ url: '/pages/orders/orders' }); return } // __workerGuard
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ selected: 2 })
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
          priceText: p.price ? '¥' + p.price : '未定价',
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
      if (sortIndex === 3) return (Number(b.price) || 0) - (Number(a.price) || 0)
      if (sortIndex === 4) return b.salesQty - a.salesQty
      if (sortIndex === 5) return String(b.lastOrder || '').localeCompare(String(a.lastOrder || ''))
      if (sortIndex === 6) return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      return String(a.id).localeCompare(String(b.id))
    })

    const groupIndex = this.data.groupIndex
    const collapsed = this.data.collapsed || {}
    const seriesOpen = this.data.seriesOpen || {}

    // 一组产品按系列再分组：有系列的在前（按名称），没系列的放最后
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
        // 没有系列的产品不折叠、也不显示系列头，直接挂在客户下面
        const named = !!s
        return { title: named ? s : '', key, items: map[s], collapsed: named ? !seriesOpen[key] : false }
      })
    }

    let sections = []

    if (groupIndex === 3) {
      sections = [{ title: '全部产品', key: 'all', series: [{ title: '', key: 'all|all', items: list, collapsed: false }] }]
    } else if (groupIndex === 0) {
      const customers = app.getCustomers().map(c => c.name)
      const used = {}
      customers.forEach(name => {
        const items = list.filter(p => (p.customers || []).indexOf(name) > -1)
        if (items.length) {
          used[name] = true
          sections.push({ title: name, key: 'c:' + name, series: splitSeries(items, 'c:' + name) })
        }
      })
      const orphans = list.filter(p => !p.customers || p.customers.length === 0 ||
        p.customers.every(c => !used[c]))
      if (orphans.length) sections.push({ title: '未挂客户', key: 'none', series: splitSeries(orphans, 'none') })
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
        series: [{ title: '', key: k + '|all', items: map[k], collapsed: false }]
      }))
    }

    sections = sections.map(s => {
      const count = (s.series || []).reduce((n, ser) => n + (ser.items || []).length, 0)
      return Object.assign({}, s, { collapsed: !!collapsed[s.key], count })
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

  toggleGroup(e) {
    const key = e.currentTarget.dataset.key
    const collapsed = Object.assign({}, this.data.collapsed)
    collapsed[key] = !collapsed[key]
    this.setData({ collapsed }, () => this.load())
  },

  toggleSeriesGroup(e) {
    const key = e.currentTarget.dataset.key
    const seriesOpen = Object.assign({}, this.data.seriesOpen)
    seriesOpen[key] = !seriesOpen[key]
    this.setData({ seriesOpen }, () => this.load())
  },

  expandAll() {
    // 全部展开：客户和系列都打开
    const seriesOpen = {}
    ;(this.data.sections || []).forEach(s => (s.series || []).forEach(ser => {
      if (ser.title) seriesOpen[ser.key] = true
    }))
    this.setData({ collapsed: {}, seriesOpen }, () => this.load())
  },

  collapseAll() {
    const collapsed = {}
    this.data.sections.forEach(s => { collapsed[s.key] = true })
    this.setData({ collapsed }, () => this.load())
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
