const app = getApp()
const C = require('../../utils/constants.js')
const T = require('../../utils/product-template.js')

const HEADER = T.HEADER
const SAMPLE_ROWS = T.SAMPLE_ROWS

Page({
  data: {
    fontClass: '',
    text: '',
    result: '',
    savedPath: ''
  },

  onShow() {
    this.setData({ fontClass: app.getFontClass() })
  },

  buildTemplate() {
    return [HEADER.join('\t')].concat(SAMPLE_ROWS.map(r => r.join('\t'))).join('\n')
  },

  copyTemplate() {
    wx.setClipboardData({
      data: this.buildTemplate(),
      success: () => wx.showModal({
        title: '模板已复制',
        content: '到 Excel 选中 A1 单元格粘贴即可分列。填好后可以①另存为 xlsx 直接导入，②或把内容粘回下面输入框。',
        showCancel: false
      })
    })
  },

  saveTemplate() {
    const fs = wx.getFileSystemManager()
    const path = wx.env.USER_DATA_PATH + '/产品导入模板.csv'
    const csv = [HEADER.join(',')].concat(SAMPLE_ROWS.map(r => r.join(','))).join('\n')
    try {
      fs.writeFileSync(path, csv, 'utf8')
      this.setData({ savedPath: path })
      wx.showModal({
        title: '模板已生成',
        content: '文件已保存。真机上可以用「转发文件」发到电脑，用 Excel 打开填写。',
        showCancel: false
      })
    } catch (e) {
      wx.showToast({ title: '生成失败：' + e.message, icon: 'none' })
    }
  },

  // 生成带下拉的 .xlsx（工艺/箱型/楞型/面纸颜色/代工模式可下拉选择，也能手填；工序列已去掉）
  saveTemplateXlsx() {
    const fs = wx.getFileSystemManager()
    const path = wx.env.USER_DATA_PATH + '/产品导入模板(带下拉).xlsx'
    try {
      const bytes = T.buildProductTemplateXlsx()
      // 微信 writeFileSync 接受 ArrayBuffer/Uint8Array 作为二进制写入
      fs.writeFileSync(path, bytes.buffer)
      this.setData({ savedPath: path })
      wx.showModal({
        title: '模板已生成（带下拉）',
        content: '已保存为 xlsx：工艺/箱型/楞型/面纸颜色/代工模式这几列在 Excel/WPS 里可直接下拉选择，也能自己打字填新值；工序列已去掉，会按箱型/代工方式自动生成。可转发到电脑填写，或在手机上用 Excel 打开。',
        showCancel: false
      })
    } catch (e) {
      wx.showToast({ title: '生成失败：' + (e.message || e.errMsg || e), icon: 'none' })
    }
  },

  onText(e) {
    this.setData({ text: e.detail.value })
  },

  // ---------- 选择文件 ----------
  chooseExcel() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx'],
      success: res => this.importXlsx(res.tempFiles[0].path),
      fail: () => wx.showToast({ title: '未选择文件', icon: 'none' })
    })
  },

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt'],
      success: res => {
        const fs = wx.getFileSystemManager()
        fs.readFile({
          filePath: res.tempFiles[0].path,
          encoding: 'utf8',
          success: r => this.doImport(r.data),
          fail: e => wx.showToast({ title: '读取失败：' + e.errMsg, icon: 'none' })
        })
      }
    })
  },

  importText() {
    this.doImport(this.data.text)
  },

  // ---------- xlsx 解析 ----------
  importXlsx(filePath) {
    wx.showLoading({ title: '解析中', mask: true })
    const fs = wx.getFileSystemManager()
    const target = wx.env.USER_DATA_PATH + '/xlsx_' + Date.now()

    fs.unzip({
      zipFilePath: filePath,
      targetPath: target,
      success: () => {
        try {
          const rows = this.readXlsx(target + '/xl/worksheets/sheet1.xml',
            target + '/xl/sharedStrings.xml')
          wx.hideLoading()
          if (!rows.length) {
            wx.showToast({ title: '表格里没有数据', icon: 'none' })
            return
          }
          this.applyRows(rows)
        } catch (e) {
          wx.hideLoading()
          wx.showModal({ title: '解析失败', content: '请确认是 Excel 的 .xlsx 文件（不是 .xls 或加密文件）。', showCancel: false })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '解压失败，可改存 csv 再导', icon: 'none' })
      }
    })
  },

  readXlsx(sheetPath, sharedPath) {
    const fs = wx.getFileSystemManager()
    let shared = []
    try {
      const sx = fs.readFileSync(sharedPath, 'utf8')
      shared = this.parseSharedStrings(sx)
    } catch (e) {}

    const xml = fs.readFileSync(sheetPath, 'utf8')
    return this.parseSheet(xml, shared)
  },

  parseSharedStrings(xml) {
    const out = []
    const items = xml.match(/<si>[\s\S]*?<\/si>/g) || []
    items.forEach(si => {
      const ts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
      out.push(ts.map(t => this.decodeXml(t.replace(/<[^>]+>/g, ''))).join(''))
    })
    return out
  },

  parseSheet(xml, shared) {
    const rows = []
    const rowBlocks = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []
    rowBlocks.forEach(rb => {
      const cells = []
      const cBlocks = rb.match(/<c[^>]*>[\s\S]*?<\/c>/g) || []
      cBlocks.forEach(cb => {
        const ref = (cb.match(/r="([A-Z]+)\d+"/) || [])[1] || ''
        const type = (cb.match(/t="([^"]+)"/) || [])[1] || ''
        let text = ''
        if (type === 's') {
          const v = (cb.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
          text = shared[parseInt(v, 10)] || ''
        } else if (type === 'inlineStr') {
          text = this.decodeXml((cb.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '')
        } else {
          const v = (cb.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
          text = v == null ? '' : this.decodeXml(v)
        }
        cells[this.colIndex(ref)] = String(text).trim()
      })
      rows.push(cells)
    })
    return rows
  },

  colIndex(letters) {
    let n = 0
    for (let i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64)
    }
    return n - 1
  },

  decodeXml(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
  },

  // ---------- 文本 / CSV 导入 ----------
  doImport(text) {
    const raw = String(text || '').trim()
    if (!raw) {
      wx.showToast({ title: '先粘内容或选文件', icon: 'none' })
      return
    }
    const rows = raw.split(/\r?\n/).filter(l => l.trim() !== '')
      .map(line => line.split(/\t|,/).map(s => s.replace(/^"|"$/g, '').trim()))
    this.applyRows(rows)
  },

  // ---------- 统一入库 ----------
  applyRows(rows) {
    const items = []
    let skipped = 0

    rows.forEach((cells, idx) => {
      const c = cells.map(x => (x == null ? '' : String(x).trim()))
      if (idx === 0 && c.join('').indexOf('编号') > -1) return

      const id = c[0]
      const name = c[1]
      if (!id || !name) { skipped++; return }

      // 这几项是「可下拉选择，也可手动输入」：填了就用填的（即使是表外自定义值），空才回退默认
      const craft = (c[2] || '').trim() || '草箱'
      const boxType = (c[3] || '').trim() || C.BOX_TYPES[0]
      const flute = (c[4] || '').trim() || C.FLUTES[0]
      const tang = C.defaultTang(boxType)
      const sizeL = parseInt(c[5]) || 0
      const sizeW = parseInt(c[6]) || 0
      const sizeH = parseInt(c[7]) || 0
      const board = C.calcBoard(sizeL, sizeW, sizeH, tang, craft)

      const split = v => String(v || '').split(/[、；;|]/).map(s => s.trim()).filter(Boolean)

      // 垫片：5层 500×300×2（删除工序列后，垫片前移到第 10 列 = c[9]）
      const pads = []
      split(c[9]).forEach(seg => {
        const m = seg.match(/(\d+层)\s*(\d+)\s*[×xX*]\s*(\d+)(?:\s*[×xX*]\s*(\d+))?/)
        if (m) pads.push({ type: m[1], L: Number(m[2]) || 0, W: Number(m[3]) || 0, qty: Number(m[4]) || 1 })
      })

      // 代工（工序列已从模板删除，统一按箱型/代工方式自动生成）
      const rawMode = (c[10] || '').trim()
      const outMode = rawMode === '代印' ? '代印' : (rawMode === '成品箱' || rawMode === '代工成品箱' ? '成品箱' : '')
      const outsource = { mode: craft === '彩箱' && outMode === '代印' ? '' : outMode, supplier: (c[11] || '').trim() }

      // 工序：永远按规则自动生成（草箱→纸板到货/生产；彩箱→纸板到货/面纸印刷/裱纸；代印/成品箱另算）
      const steps = C.buildSteps({ craft, boxType, outsource })

      items.push({
        id,
        name,
        craft,
        boxType,
        flute,
        sizeL,
        sizeW,
        sizeH,
        tang,
        boardL: board.length,
        boardW: board.width,
        twoPiece: board.twoPiece,
        paperColor: (c[8] || '').trim() || '黄面',
        steps,
        outsource,
        customers: split(c[12]),
        addrPreset: (function() {
          const raw = String(c[13] || '').trim()
          if (!raw) return null
          const parts = raw.split('|')
          const customer = parts.length > 1 ? parts[0].trim() : ''
          const address = (parts.length > 1 ? parts[1] : parts[0]).trim()
          return address ? { customer, address, contact: '', phone: '' } : null
        })(),
        price: Number(c[14]) || 0,
        note: c[15] || '',
        pads,
        materials: [],
        updatedAt: app.now()
      })
    })

    if (!items.length) {
      this.setData({ result: '没有解析到有效数据：每行至少要有编号和名称，且第 1 行是表头。' })
      return
    }

    // 客户自动补全
    const known = app.getCustomers()
    const names = known.map(x => x.name)
    let added = 0
    items.forEach(it => it.customers.forEach(cn => {
      if (names.indexOf(cn) === -1) { names.push(cn); added++ }
    }))
    if (added) app.saveCustomers(names.map(n => ({ name: n, contact: '', phone: '', addresses: [] })))

    const r = app.upsertProducts(items)
    const msg = '新增 ' + r.added + ' 款，更新 ' + r.updated + ' 款，共 ' + r.total + ' 款' +
      (skipped ? '；跳过 ' + skipped + ' 行' : '') +
      (added ? '；新增客户 ' + added + ' 个' : '')
    this.setData({ result: msg })
    wx.showToast({ title: '导入完成', icon: 'success' })
  },

  exportAll() {
    const list = app.getProducts()
    if (!list.length) {
      wx.showToast({ title: '还没有产品', icon: 'none' })
      return
    }
    const lines = [HEADER.join('\t')]
    list.forEach(p => {
      const pads = (p.pads || []).map(x => x.type + ' ' + x.L + '×' + x.W + '×' + x.qty).join('、')
      const outMode = (p.outsource && p.outsource.mode) || ''
      const outSup = (p.outsource && p.outsource.supplier) || ''
      lines.push([
        p.id, p.name, p.craft || '草箱', p.boxType || '', p.flute || '',
        p.sizeL || '', p.sizeW || '', p.sizeH || '',
        p.paperColor || '',
        pads, outMode, outSup,
        (p.customers || []).join('、'),
        (p.addrPreset && p.addrPreset.address) ? ((p.addrPreset.customer || '') + '|' + p.addrPreset.address) : '',
        p.price || '', p.note || ''
      ].join('\t'))
    })
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showModal({
        title: '已复制',
        content: '已复制 ' + list.length + ' 款产品，粘到 Excel 就是新的模板格式。',
        showCancel: false
      })
    })
  }
})
