const app = getApp()

// 身份卡：微信官方「头像昵称填写能力」的标准卡片。
//  - <button open-type="chooseAvatar"> → 点一下弹微信自带的头像选择器
//  - <input type="nickname">        → 聚焦时微信把「你微信里的昵称」带出来（昵称小卡片）
// 昵称不是强制的：确认一下就能进系统（不填昵称只是管理员那边少个昵称参考）。
// 用整页 reLaunch 实现（不是每页塞弹层），没有返回键，绕不过去。
Page({
  data: {
    fontClass: '',
    nickname: '',
    avatar: '',
    needPrivacy: false,
    autoFocus: true
  },

  onLoad() {
    this.setData({
      fontClass: app.getFontClass(),
      nickname: app.getUserNickname(),
      avatar: app.getUserAvatar()
    })
    this.checkPrivacy()
  },

  checkPrivacy() {
    app.checkPrivacySetting().then(r => {
      this.setData({ needPrivacy: !!r.needAuthorization })
    })
  },

  onChange(e) {
    this.setData({ nickname: e.detail.value || '' })
  },

  onBlur(e) {
    const v = e.detail.value || ''
    if (v) this.setData({ nickname: v })
  },

  // 选完头像是临时文件路径，要传到云存储才能长期保存
  onChooseAvatar(e) {
    const temp = e.detail.avatarUrl
    if (!temp) return
    this.setData({ avatar: temp })
    if (!wx.cloud) return
    const openid = (app.globalData.cloud && app.globalData.cloud.openid) || 'anon'
    wx.cloud.uploadFile({
      cloudPath: 'avatars/' + openid + '_' + Date.now() + '.png',
      filePath: temp,
      success: res => this.setData({ avatar: res.fileID }),
      fail: () => {}
    })
  },

  onAgree() {
    this.checkPrivacy()
    wx.showToast({ title: '已同意', icon: 'success' })
  },

  openPrivacy() {
    app.openPrivacyContract()
  },

  confirm() {
    const v = String(this.data.nickname || '').trim()
    app.setUserNickname(v, this.data.avatar || '')
    app.markIdentityDone()
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/orders/orders' })
    }, 400)
  }
})
