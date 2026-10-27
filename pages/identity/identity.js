const app = getApp()

// 扫码进入时让使用者取一下微信昵称。
// 这里只用微信官方组件：
//   <input type="nickname">  → 聚焦时微信自动弹出昵称小卡片（带出你微信里的昵称），点一下即填入
//   <button open-type="chooseAvatar"> → 点开是微信自带的头像选择器
// 没有自造的弹窗样式，普通页面而已。
Page({
  data: {
    fontClass: '',
    nickname: '',
    avatar: ''
  },

  onLoad() {
    this.setData({
      fontClass: app.getFontClass(),
      nickname: app.getUserNickname(),
      avatar: app.getUserAvatar()
    })
  },

  // 昵称确认后自动保存并进入系统
  onNickname(e) {
    const v = String(e.detail.value || '').trim()
    if (!v) return
    this.setData({ nickname: v })
    app.setUserNickname(v, this.data.avatar || '')
    setTimeout(() => this.enter(), 200)
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
      success: res => {
        this.setData({ avatar: res.fileID })
        app.setUserNickname(this.data.nickname || '', res.fileID)
      },
      fail: () => {}
    })
  },

  // 不想填也能进；点过就不再拦
  skip() {
    try { wx.setStorageSync('identity_skipped', 1) } catch (e) {}
    this.enter()
  },

  enter() {
    wx.reLaunch({ url: '/pages/orders/orders' })
  }
})
