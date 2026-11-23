const app = getApp()
const C = require('../../utils/constants.js')

Page({
  data: {
    fontClass: '',
    keyword: '',
    list: [],
    groups: [],
    seriesOpen: {},
    customer: ''
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    const customer = wx.getStorageSync('pending_customer_filter') || ''
    wx.removeStorageSync('pending_customer_filter')
    if (customer) {
      wx.setNavigationBarTitle({ title: customer + ' 的产品' })
    }
    this.setData({ customer })
    this.load()
  },

  load() {
    const kw = this.data.keyword
    const customer = this.data.customer
    const list = app.getProducts()
      .filter(p => !customer || (p.customers || []).indexOf(customer) > -1)
      .filter(p => app.matchKeywords(app.productSearchText(p), kw))
      .map(p => {
        const size = p.sizeL ? p.sizeL + '×' + p.sizeW + '×' + p.sizeH + 'mm' : ''
        return Object.assign({}, p, {
          summary: [p.craft || '草箱', p.boxType, p.flute, size].filter(Boolean).join(' · ')
        })
      })
      // 默认按「客户-系列」排序：同客户下按系列聚在一起
      .sort((a, b) => app.compareProductCustomerSeries(a, b))

    // 按系列分组：默认只展开到系列层，点系列才看到具体产品
    const open = this.data.seriesOpen || {}
    const map = {}
    const order = []
    list.forEach(p => {
      const sr = p.series || ''
      if (!(sr in map)) { map[sr] = []; order.push(sr) }
      map[sr].push(p)
    })
    order.sort((a, b) => {
      if (!a !== !b) return a ? -1 : 1
      return String(a).localeCompare(String(b), 'zh-Hans-CN')
    })
    // 搜索时直接展开，避免搜到了却看不见
    const groups = order.map(sr => {
      const key = 's:' + sr
      return { title: sr || '【散单】', key, items: map[sr], collapsed: kw ? false : !open[key] }
    })

    this.setData({ list, groups })
  },

  toggleSeriesGroup(e) {
    const key = e.currentTarget.dataset.key
    const seriesOpen = Object.assign({}, this.data.seriesOpen)
    seriesOpen[key] = !seriesOpen[key]
    this.setData({ seriesOpen }, () => this.load())
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.load())
  },

  choose(e) {
    const id = e.currentTarget.dataset.id
    wx.setStorageSync('pending_product_id', id)
    wx.navigateBack()
  },

  goArchive() {
    wx.switchTab({ url: '/pages/product/product' })
  }
})
