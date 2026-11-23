const app = getApp()

Page({
  data: {
    fontClass: '',
    name: '',
    supplier: null,
    typeText: '',
    orders: []
  },

  onLoad(options) {
    this.setData({
      name: decodeURIComponent(options.name || '')
    })
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    this.load()
  },

  load() {
    const name = this.data.name
    const supplier = app.getSupplier(name)
    const orders = app.getAllOrders()
      .filter(o => app.factoryItems(o, name).length > 0)
      .map(o => {
        const fItems = app.factoryItems(o, name)
        const qty = (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)
        return Object.assign({}, o, {
          _qty: fItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0) || qty,
          _date: o.createdAt,
          _isFactory: true,
          _factoryProducts: fItems.map(it => it.productName).join('、')
        })
      })

    this.setData({
      supplier,
      typeText: supplier ? (supplier.types || []).join('、') : '',
      orders
    })
  },

  goOrder(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  edit() {
    wx.navigateTo({ url: '/pages/supplier-edit/supplier-edit?name=' + encodeURIComponent(this.data.name) })
  }
})
