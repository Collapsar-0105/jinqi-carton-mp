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
    const list = app.getDrafts().map(d => Object.assign({}, d, {
      _statusText: d.status === 'converted' ? '已转产品' : '草稿',
      _statusColor: d.status === 'converted' ? 'tag-done' : 'tag-progress',
      _size: d.sizeL ? d.sizeL + '×' + d.sizeW + '×' + d.sizeH : '尺寸未定'
    }))
    this.setData({ list })
  },

  goNew() {
    wx.navigateTo({ url: '/pages/product-edit/product-edit?mode=sample' })
  },

  goEdit(e) {
    wx.navigateTo({ url: '/pages/product-edit/product-edit?mode=sample&draftId=' + e.currentTarget.dataset.id })
  },

  remove(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除草稿',
      content: '确定删除这份打样草稿吗？',
      confirmColor: '#e94560',
      success: res => {
        if (res.confirm) {
          app.removeDraft(id)
          this.load()
        }
      }
    })
  }
})
