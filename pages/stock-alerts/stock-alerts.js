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
        _date: a.date || '',
        // 现有库存 = 该产品所有已入库未送完的可发数量（与新建订单时「该产品有 N 个库存」同口径）
        stockQty: app.productStockQty(a.productId)
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

  // 复制产品信息
  // 规则（按是否代工-成品箱分两种）：
  //   非代工 / 代工-代印：产品编号、产品名称、工艺、面纸颜色、箱型、楞型、纸板尺寸、箱舌、数量(留空)、送货(留空)
  //   代工-成品箱      ：产品编号、产品名称、工艺、面纸颜色、箱型、楞型、PO(留空)、数量(留空)、送货(留空)
  copyInfo(e) {
    const pid = e.currentTarget.dataset.id
    const p = app.getProduct(pid)
    if (!p) {
      wx.showToast({ title: '产品不存在', icon: 'none' })
      return
    }
    const mode = (p.outsource && p.outsource.mode) || ''
    const lines = [
      '产品：' + p.id + ' ' + p.name,
      '工艺：' + (p.craft || ''),
      '面纸颜色：' + (p.paperColor || ''),
      '箱型：' + (p.boxType || ''),
      '楞型：' + (p.flute || '')
    ]
    if (mode === '成品箱') {
      lines.push('PO：')
    } else {
      lines.push('纸板尺寸：' + (p.boardL || 0) + '×' + (p.boardW || 0) + 'mm')
      lines.push('箱舌：' + (p.tang || 0) + 'mm')
    }
    lines.push('数量：', '送货：')
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '产品信息已复制', icon: 'success' })
    })
  },

  goOrder(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.order })
  }
})
