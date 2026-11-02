// 产品导入模板：表头 + 示例行 + 生成带下拉的 xlsx（纯 JS 手写 zip，零依赖）
// 微信小程序只提供「解压」zip 的 API，没有「生成」zip 的 API，
// 所以这里自己写一个最小化的 store 模式 zip 打包器（含 CRC32），产出标准 .xlsx。
const C = require('./constants.js')

// ===== 模板内容（已删除「工序」列，改为按箱型/代工方式自动生成）=====
const HEADER = [
  '编号', '产品名称', '工艺', '箱型', '楞型', '长(mm)', '宽(mm)', '高(mm)',
  '面纸颜色',
  '垫片(层数 长×宽×数量，顿号分隔)', '代工模式(代印/成品箱)',
  '代工方', '客户(顿号分隔)', '默认收货地址(客户|地址)', '参考单价', '备注'
]

const SAMPLE_ROWS = [
  ['P001', '美的 KFR-35W 彩箱', '彩箱', '普通方箱', '五层 BC 瓦', '520', '380', '300',
    '',
    '5层 500×300×2、3层 550×350×1', '', '', '美的', '', '3.50', '示例行，可删除'],
  ['P002', '格力挂机箱', '草箱', '普通方箱', '三层 A 瓦', '600', '400', '350',
    '黄面',
    '', '代印', '金彩印务', '格力', '格力|珠海市香洲区XX仓', '4.20', '']
]

// ===== 迷你 zip 打包器（store 模式 + CRC32）=====
function strBytes(s) {
  const out = []
  s = String(s)
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const c2 = s.charCodeAt(i + 1)
      if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
        const cp = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF)
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F))
        i++
        continue
      }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F))
    else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F))
  }
  return out
}

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      CRC_TABLE[n] = c >>> 0
    }
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = (CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function push16(arr, v) { arr.push(v & 0xFF, (v >> 8) & 0xFF) }
function push32(arr, v) { arr.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF) }

function buildZip(files) {
  const out = []
  const central = []
  let offset = 0
  files.forEach(f => {
    const nameBytes = strBytes(f.name)
    const data = strBytes(f.data)
    const crc = crc32(data)
    const size = data.length
    const lh = []
    push32(lh, 0x04034b50)
    push16(lh, 20)
    push16(lh, 0x0800)        // 文件名/内容 UTF-8
    push16(lh, 0)             // 压缩方法：store
    push16(lh, 0)             // 时间
    push16(lh, 0)             // 日期
    push32(lh, crc)
    push32(lh, size)
    push32(lh, size)
    push16(lh, nameBytes.length)
    push16(lh, 0)             // 扩展字段长度
    for (let i = 0; i < lh.length; i++) out.push(lh[i])
    for (let i = 0; i < nameBytes.length; i++) out.push(nameBytes[i])
    for (let i = 0; i < data.length; i++) out.push(data[i])
    const localOffset = offset
    offset += lh.length + nameBytes.length + data.length

    const cd = []
    push32(cd, 0x02014b50)
    push16(cd, 20)
    push16(cd, 20)
    push16(cd, 0x0800)
    push16(cd, 0)
    push16(cd, 0)
    push16(cd, 0)
    push32(cd, crc)
    push32(cd, size)
    push32(cd, size)
    push16(cd, nameBytes.length)
    push16(cd, 0)
    push16(cd, 0)
    push16(cd, 0)
    push16(cd, 0)
    push32(cd, 0)
    push32(cd, localOffset)
    for (let i = 0; i < cd.length; i++) central.push(cd[i])
    for (let i = 0; i < nameBytes.length; i++) central.push(nameBytes[i])
  })
  const centralBytes = central.length
  const centralOffset = offset
  for (let i = 0; i < central.length; i++) out.push(central[i])
  offset += centralBytes
  const ed = []
  push32(ed, 0x06054b50)
  push16(ed, 0)
  push16(ed, 0)
  push16(ed, files.length)
  push16(ed, files.length)
  push32(ed, centralBytes)
  push32(ed, centralOffset)
  push16(ed, 0)
  for (let i = 0; i < ed.length; i++) out.push(ed[i])
  return new Uint8Array(out)
}

// ===== xlsx 内部 XML 构造 =====
function colLetter(idx) {
  let s = ''
  idx++
  while (idx > 0) {
    const m = (idx - 1) % 26
    s = String.fromCharCode(65 + m) + s
    idx = Math.floor((idx - 1) / 26)
  }
  return s
}

function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function cellXml(ref, value) {
  const v = String(value)
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    return '<c r="' + ref + '"><v>' + v + '</v></c>'
  }
  return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>'
}

function buildSheetXml() {
  let rows = ''
  HEADER.forEach((h, i) => {
    rows += '<row r="1"><c r="' + colLetter(i) + '1" t="inlineStr"><is><t>' + xmlEsc(h) + '</t></is></c></row>'
  })
  SAMPLE_ROWS.forEach((row, ri) => {
    const r = ri + 2
    let cells = ''
    row.forEach((v, i) => { cells += cellXml(colLetter(i) + r, v) })
    rows += '<row r="' + r + '">' + cells + '</row>'
  })

  // 下拉校验：这几列可下拉选择，也允许手填（showErrorMessage=0 不拦截非列表值）
  const dvs = [
    { col: 2, list: C.CRAFTS.join(',') },
    { col: 3, list: C.BOX_TYPES.join(',') },
    { col: 4, list: C.FLUTES.join(',') },
    { col: 8, list: C.PAPER_COLORS.join(',') },
    { col: 10, list: '代印,成品箱' }
  ]
  const dvXml = dvs.map(d =>
    '<dataValidation type="list" allowBlank="1" showErrorMessage="0" showInputMessage="0" sqref="' +
    colLetter(d.col) + '2:' + colLetter(d.col) + '1001"><formula1>"' + d.list + '"</formula1></dataValidation>'
  ).join('')

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + rows + '</sheetData>' +
    '<dataValidations count="' + dvs.length + '">' + dvXml + '</dataValidations>' +
    '</worksheet>'
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  '</Types>'

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
  '</Relationships>'

const CORE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>产品导入模板</dc:title></cp:coreProperties>'

const APP = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>金淇纸箱</Application></Properties>'

const WORKBOOK = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="产品导入模板" sheetId="1" r:id="rId1"/></sheets></workbook>'

const WB_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'

function buildProductTemplateXlsx() {
  const files = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'docProps/core.xml', data: CORE },
    { name: 'docProps/app.xml', data: APP },
    { name: 'xl/workbook.xml', data: WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', data: WB_RELS },
    { name: 'xl/worksheets/sheet1.xml', data: buildSheetXml() }
  ]
  return buildZip(files)
}

module.exports = { HEADER, SAMPLE_ROWS, buildProductTemplateXlsx }
