const app = getApp()

Page({
  data: {
    fontClass: '',
    list: [],
    today: ''
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
  },

  onLoad() {
    const now = new Date().getFullYear()
    const cfg = app.getWorkYears()
    const list = []
    for (let y = now + 1; y >= now - 3; y--) {
      const c = cfg[String(y)] || {}
      list.push({ year: y, start: c.start || '', end: c.end || '' })
    }
    this.setData({ list, today: app.today() })
  },

  onStart(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = this.data.list.slice()
    list[idx].start = e.detail.value
    this.setData({ list })
    this.save()
  },

  onEnd(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = this.data.list.slice()
    list[idx].end = e.detail.value
    this.setData({ list })
    this.save()
  },

  clearEnd(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const list = this.data.list.slice()
    list[idx].end = ''
    this.setData({ list })
    this.save()
  },

  save() {
    const cfg = {}
    this.data.list.forEach(x => {
      if (x.start || x.end) cfg[String(x.year)] = { start: x.start, end: x.end }
    })
    app.saveWorkYears(cfg)
  }
})
