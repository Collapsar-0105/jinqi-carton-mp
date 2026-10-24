const ADMIN_LIST = [
  { pagePath: '/pages/orders/orders', text: '订单' },
  { pagePath: '/pages/purchase/purchase', text: '采购' },
  { pagePath: '/pages/product/product', text: '产品档案' },
  { pagePath: '/pages/directory/directory', text: '往来单位' }
]

Component({
  data: {
    selected: 0,
    list: ADMIN_LIST
  },
  attached() {
    const role = wx.getStorageSync('role') || 'admin'
    if (role === 'worker') {
      this.setData({ list: [{ pagePath: '/pages/orders/orders', text: '订单' }] })
    }
  },
  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      const item = this.data.list[index]
      this.setData({ selected: index })
      wx.switchTab({ url: item.pagePath })
    }
  }
})
