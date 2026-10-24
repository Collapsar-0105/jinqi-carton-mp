const app = getApp()

Page({
  data: {
    fontClass: '',
    customerCount: 0,
    supplierCount: 0
  },

  onShow() {
    if (wx.getStorageSync('role') === 'worker') { wx.switchTab({ url: '/pages/orders/orders' }); return } // __workerGuard
    const tb = this.getTabBar && this.getTabBar()
    if (tb) tb.setData({ selected: 3 })
    this.setData({ fontClass: app.getFontClass() })
    this.refresh()
  },

  refresh() {
    this.setData({
      customerCount: app.getCustomers().length,
      supplierCount: app.getSuppliers().length
    })
  },

  goCustomers() {
    wx.navigateTo({ url: '/pages/customers/customers' })
  },

  goSuppliers() {
    wx.navigateTo({ url: '/pages/suppliers/suppliers' })
  }
})
