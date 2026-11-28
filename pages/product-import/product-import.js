const app = getApp()
const C = require('../../utils/constants.js')
const T = require('../../utils/product-template.js')

const HEADER = T.HEADER
const SAMPLE_ROWS = T.SAMPLE_ROWS

Page({
  data: {
    fontClass: '',
    text: '',
    result: ''
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

  // 生成后直接发到微信聊天（选「文件传输助手」）。
  // 注意：安卓上 wx.shareFileMessage 的 success 回调可能比「文件真正发出去」更早触发，
  // 此时立刻删临时文件，微信就会显示「红色感叹号、传送中断」（iOS 不复现）。
  // 所以这里不主动删文件：文件名固定，下次生成直接覆盖同名文件，不会越积越多。
  shareTemplateFile(filePath, fileName) {
    const fs = wx.getFileSystemManager()

    // 发之前先确认文件真的写进去了（0 字节会导致发送中断）
    try {
      const st = fs.statSync(filePath)
      if (!st || !st.size) throw new Error('empty')
    } catch (e) {
      wx.showToast({ title: '文件生成失败，请重试', icon: 'none' })
      return
    }

    if (!wx.shareFileMessage) {
      wx.showModal({
        title: '当前微信不支持发文件',
        content: '这个功能需要较新版本的微信。请把微信更新到最新版，在手机上再试一次。',
        showCancel: false
      })
      return
    }

    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => {
        wx.showToast({ title: '已发送到微信', icon: 'none' })
      },
      fail: () => {
        // 不删文件：用户可能只是取消了，保留下来可以再点一次
        wx.showToast({ title: '未发送，可再点一次', icon: 'none' })
      }
    })
  },

  saveTemplate() {
    const fs = wx.getFileSystemManager()
    const fileName = '产品导入模板.csv'
    const path = wx.env.USER_DATA_PATH + '/' + fileName
    const csv = [HEADER.join(',')].concat(SAMPLE_ROWS.map(r => r.join(','))).join('\n')
    try {
      fs.writeFileSync(path, csv, 'utf8')
    } catch (e) {
      wx.showToast({ title: '生成失败：' + e.message, icon: 'none' })
      return
    }
    this.shareTemplateFile(path, fileName)
  },

  // 生成带下拉的 .xlsx（工艺/箱型/楞型/面纸颜色/代工模式可下拉选择，也能手填；工序列已去掉）
  saveTemplateXlsx() {
    const fs = wx.getFileSystemManager()
    const fileName = '产品导入模板(带下拉).xlsx'
    const path = wx.env.USER_DATA_PATH + '/' + fileName
    try {
      const bytes = T.buildProductTemplateXlsx()
      // 微信 writeFileSync 接受 ArrayBuffer/Uint8Array 作为二进制写入
      fs.writeFileSync(path, bytes.buffer)
    } catch (e) {
      wx.showToast({ title: '生成失败：' + (e.message || e.errMsg || e), icon: 'none' })
      return
    }
    this.shareTemplateFile(path, fileName)
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

    // 兼容旧模板：1.9.101 之前是 16 列，第 14 列是「默认收货地址」（已废弃）。
    // 按表头判断，整表统一去掉那一列；新模板 15 列不受影响。
    const headText = String((rows[0] || []).join(''))
    const legacyWithAddr = headText.indexOf('默认收货地址') > -1
    // 1.9.125 起模板加了「系列」列（第 14 列），旧模板没有这一列，按表头判断
    const hasSeries = headText.indexOf('系列') > -1
    // 1.9.135 起模板加了「品牌」列（在系列之前）
    const hasBrand = headText.indexOf('品牌') > -1

    // 去重索引：已有产品的编号/名称 + 本次文件里已出现的编号/名称
    const existed = app.getProducts()
    const existName = {}
    existed.forEach(p => { if (p && p.id && p.name) existName[p.name] = p.id })
    const idPos = {}
    const seenName = {}
    let dupRows = 0
    let nameRows = 0

    rows.forEach((cells, idx) => {
      const c = cells.map(x => (x == null ? '' : String(x).trim()))
      if (legacyWithAddr && c.length >= 16) c.splice(13, 1)
      if (idx === 0 && c.join('').indexOf('编号') > -1) return

      const id = c[0]
      const name = c[1]
      if (!id || !name) { skipped++; return }

      // 同名不同编号：会建出两款重名产品，直接跳过（和产品编辑页的校验一致）
      if ((existName[name] && existName[name] !== id) ||
          (seenName[name] && seenName[name] !== id)) { nameRows++; return }
      seenName[name] = id

      // 这几项是「可下拉选择，也可手动输入」：填了就用填的（即使是表外自定义值），空才回退默认
      const craft = (c[2] || '').trim() || '草箱'
      const boxType = (c[3] || '').trim() || C.BOX_TYPES[0]
      const flute = (c[4] || '').trim() || C.FLUTES[0]
      const tang = C.defaultTang(boxType)
      let sizeL = parseInt(c[5]) || 0
      let sizeW = parseInt(c[6]) || 0
      let sizeH = parseInt(c[7]) || 0
      // 兼容「长」列直接写成 765*435*430、宽高留空：自动拆成三维
      if (!sizeW && !sizeH) {
        const mSize = String(c[5] || '').match(/^\s*(\d+)\s*[×xX*]\s*(\d+)\s*[×xX*]\s*(\d+)\s*$/)
        if (mSize) {
          sizeL = Number(mSize[1]) || 0
          sizeW = Number(mSize[2]) || 0
          sizeH = Number(mSize[3]) || 0
        }
      }
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

      const item = {
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
        brand: hasBrand ? (c[13] || '').trim() : '',
        series: hasBrand ? (c[14] || '').trim() : (hasSeries ? (c[13] || '').trim() : ''),
        note: c[hasBrand ? 15 : (hasSeries ? 14 : 13)] || '',
        pads,
        materials: [],
        updatedAt: app.now()
      }
      // 文件内同编号重复：保留最后一次，不产生两条记录
      if (idPos[id] !== undefined) {
        const prev = items[idPos[id]]
        if (prev && prev.name !== name && seenName[prev.name] === id) delete seenName[prev.name]
        items[idPos[id]] = item
        dupRows++
      }
      else { idPos[id] = items.length; items.push(item) }
    })

    if (!items.length) {
      this.setData({ result: '没有解析到有效数据：每行至少要有编号和名称，且第 1 行是表头。' })
      return
    }

    // 导入前记撤销点：产品档案顶部会出现「撤销：导入产品」，点一下整体回滚
    // （先记客户再记产品，撤销时先还原产品、再还原客户）
    app.recordUndo('customers', app.getCustomers(), '导入产品（客户）')
    app.recordUndo('products', app.getProducts(), '导入产品')

    // 客户自动补全
    const known = app.getCustomers()
    const names = known.map(x => x.name)
    let added = 0
    items.forEach(it => it.customers.forEach(cn => {
      if (names.indexOf(cn) === -1) { names.push(cn); added++ }
    }))
    if (added) app.saveCustomers(names.map(n => ({ name: n, contact: '', phone: '' })))

    const r = app.upsertProducts(items)
    const msg = '新增 ' + r.added + ' 款，更新 ' + r.updated + ' 款，共 ' + r.total + ' 款' +
      (dupRows ? '；合并重复编号 ' + dupRows + ' 行' : '') +
      (nameRows ? '；跳过重名 ' + nameRows + ' 行' : '') +
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
        p.brand || '', p.series || '', p.note || ''
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
