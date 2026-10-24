const app = getApp()

Page({
  data: {
    fontClass: '',
    list: []
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    this.load()
  },

  load() {
    this.setData({
      list: app.getStockAlerts().map(a => Object.assign({}, a, {
        _date: a.date || ''
      }))
    })
  },

  remove(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '取消预警',
      content: '确定取消这条常备预警吗？',
      success: res => {
        if (!res.confirm) return
        app.removeStockAlert(id)
        this.load()
      }
    })
  },

  goOrder(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.order })
  },

  goProduct(e) {
    wx.navigateTo({ url: '/pages/product-edit/product-edit?id=' + e.currentTarget.dataset.product })
  }
})
