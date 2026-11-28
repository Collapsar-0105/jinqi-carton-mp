const app = getApp()
const C = require('../../utils/constants.js')

Page({
  data: {
    fontClass: '',
    keyword: '',
    list: [],
    groups: [],
    brandOpen: {},
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

    // 品牌 → 系列 → 产品：默认只展开到品牌层
    const brandOpen = this.data.brandOpen || {}
    const seriesOpen = this.data.seriesOpen || {}
    const bmap = {}
    const border = []
    list.forEach(p => {
      const b = p.brand || ''
      if (!(b in bmap)) { bmap[b] = []; border.push(b) }
      bmap[b].push(p)
    })
    border.sort((a, b) => {
      if (!a !== !b) return a ? -1 : 1
      return String(a).localeCompare(String(b), 'zh-Hans-CN')
    })
    const groups = border.map(b => {
      const bkey = 'b:' + b
      const items = bmap[b]
      const smap = {}
      const sorder = []
      items.forEach(p => {
        const sr = p.series || ''
        if (!(sr in smap)) { smap[sr] = []; sorder.push(sr) }
        smap[sr].push(p)
      })
      sorder.sort((x, y) => {
        if (!x !== !y) return x ? -1 : 1
        return String(x).localeCompare(String(y), 'zh-Hans-CN')
      })
      const series = sorder.map(sr => {
        const skey = bkey + '|s:' + sr
        return {
          title: sr || '【散单】',
          key: skey,
          items: smap[sr],
          collapsed: kw ? false : !seriesOpen[skey]
        }
      })
      return {
        title: b || '【未分品牌】',
        key: bkey,
        series,
        count: items.length,
        collapsed: kw ? false : !brandOpen[bkey]
      }
    })

    this.setData({ list, groups })
  },

  toggleBrandGroup(e) {
    const key = e.currentTarget.dataset.key
    const open = Object.assign({}, this.data.brandOpen)
    this.setData({ brandOpen: open[key] ? (delete open[key], open) : { [key]: true }, seriesOpen: {} }, () => this.load())
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
