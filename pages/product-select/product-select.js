const app = getApp()
const C = require('../../utils/constants.js')

Page({
  data: {
    fontClass: '',
    keyword: '',
    list: [],
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
          summary: [p.craft || '草箱', p.boxType, p.flute, size].filter(Boolean).join(' · '),
          priceText: p.price ? '¥' + p.price : '未定价'
        })
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))

    this.setData({ list })
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
