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
      .filter(o => app.factoryItems(o, name).length > 0 || (o.purchases || []).some(p => p.supplier === name))
      .map(o => {
        const fItems = app.factoryItems(o, name)
        const isFactory = fItems.length > 0
        const factoryAmount = app.factoryAmount(o, name)
        const items = (o.purchases || []).filter(p => p.supplier === name)
        const materialAmount = items.reduce((s, p) =>
          s + (Number(p.price) || 0) * (parseFloat(p.quantity) || 0), 0)
        const amount = factoryAmount + materialAmount
        const qty = (o.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)
        return Object.assign({}, o, {
          _amount: amount ? amount.toFixed(2) : '',
          _qty: isFactory ? fItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : qty,
          _date: o.createdAt,
          _isFactory: isFactory,
          _items: items.map(p => p.type + '：' + p.name).join('、'),
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
