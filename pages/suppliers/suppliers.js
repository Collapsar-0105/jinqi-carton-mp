const app = getApp()

Page({
  data: {
    fontClass: '',
    list: []
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
    this.refresh()
  },

  refresh() {
    const list = app.getSuppliers().map(s => Object.assign({}, s, {
      typeText: (s.types || []).join('、') || '未分类'
    }))
    this.setData({ list })
  },

  goNew() {
    wx.navigateTo({ url: '/pages/supplier-edit/supplier-edit' })
  },

  goDetail(e) {
    const name = e.currentTarget.dataset.name
    wx.navigateTo({ url: '/pages/supplier-detail/supplier-detail?name=' + encodeURIComponent(name) })
  },

  remove(e) {
    const name = e.currentTarget.dataset.name
    wx.showModal({
      title: '删除供应商',
      content: '确定删除「' + name + '」吗？',
      confirmColor: '#e94560',
      success: res => {
        if (res.confirm) {
          app.saveSuppliers(app.getSuppliers().filter(s => s.name !== name))
          this.refresh()
        }
      }
    })
  }
})
