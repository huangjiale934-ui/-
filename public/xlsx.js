/* ==========================================================
   MPFXLSX —— 极简 XLSX 生成器（浏览器端，零依赖）
   2026-10-21：SpreadsheetML 无法内嵌图片，改为真 xlsx（zip + OOXML）。
   只实现本项目需要的子集：多工作表、列宽、合并单元格、4 类样式、一张内嵌 PNG。
   ========================================================== */
window.MPFXLSX = (function () {
  /* ---------- CRC32 ---------- */
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- ZIP（store，不压缩） ---------- */
  function zip(files) {
    var enc = new TextEncoder();
    var chunks = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var lh = new Uint8Array(30 + name.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
      lh.set(name, 30);
      chunks.push(lh, data);

      var cd = new Uint8Array(46 + name.length);
      var dv2 = new DataView(cd.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true); dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true); dv2.setUint16(10, 0, true);
      dv2.setUint16(12, 0, true); dv2.setUint16(14, 0, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, data.length, true); dv2.setUint32(24, data.length, true);
      dv2.setUint16(28, name.length, true);
      dv2.setUint16(30, 0, true); dv2.setUint16(32, 0, true);
      dv2.setUint16(34, 0, true); dv2.setUint16(36, 0, true);
      dv2.setUint32(38, 0, true); dv2.setUint32(42, offset, true);
      cd.set(name, 46);
      central.push(cd);
      offset += lh.length + data.length;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var eocd = new Uint8Array(22);
    var dv3 = new DataView(eocd.buffer);
    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(8, files.length, true); dv3.setUint16(10, files.length, true);
    dv3.setUint32(12, cdSize, true); dv3.setUint32(16, offset, true);
    var all = [];
    chunks.forEach(function (c) { all.push(c); });
    central.forEach(function (c) { all.push(c); });
    all.push(eocd);
    return new Blob(all, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- 工具 ---------- */
  function xesc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  }
  function colName(i) {
    var s = '';
    i = i + 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function dateSerial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000);
  }
  function b64ToU8(b64) {
    var bin = atob(b64.split(',').pop());
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  /* ---------- styles ---------- */
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="4">' +
      '<numFmt numFmtId="164" formatCode="+0.00%;-0.00%;0.00%"/>' +
      '<numFmt numFmtId="165" formatCode="0.0000"/>' +
      '<numFmt numFmtId="166" formatCode="0.00"/>' +
      '<numFmt numFmtId="167" formatCode="yyyy\\-mm\\-dd"/>' +
    '</numFmts>' +
    '<fonts count="5">' +
      '<font><sz val="11"/><name val="微软雅黑"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF1A1A1A"/><name val="微软雅黑"/></font>' +
      '<font><b/><sz val="14"/><color rgb="FF0F4C81"/><name val="微软雅黑"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF0F4C81"/><name val="微软雅黑"/></font>' +
      '<font><sz val="11"/><color rgb="FF1A1A1A"/><name val="微软雅黑"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F8"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE9F3"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFCFDCEA"/></left><right style="thin"><color rgb="FFCFDCEA"/></right>' +
      '<top style="thin"><color rgb="FFCFDCEA"/></top><bottom style="thin"><color rgb="FFCFDCEA"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
      /* 0 默认 */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      /* 1 标题 */ '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      /* 2 表头 */ '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      /* 3 键列 */ '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      /* 4 文本 */ '<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      /* 5 百分比 */ '<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      /* 6 四位小数 */ '<xf numFmtId="165" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      /* 7 两位小数 */ '<xf numFmtId="166" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      /* 8 日期 */ '<xf numFmtId="167" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      /* 9 文本（无边框，声明行） */ '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '</styleSheet>';

  /* ---------- sheet xml ---------- */
  function sheetXml(sheet) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    if (sheet.cols && sheet.cols.length) {
      x += '<cols>' + sheet.cols.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }
    x += '<sheetData>';
    (sheet.rows || []).forEach(function (row, ri) {
      x += '<row r="' + (ri + 1) + '"' + (row.h ? ' ht="' + row.h + '" customHeight="1"' : '') + '>';
      (row.cells || []).forEach(function (c, ci) {
        if (c == null || c.v == null || c.v === '') return;
        var ref = colName(ci) + (ri + 1);
        var st = c.s || 0;
        var isNum = typeof c.v === 'number' && isFinite(c.v);
        if (c.t === 'd') {
          var ds = dateSerial(c.v);
          if (ds != null) { x += '<c r="' + ref + '"' + (st ? ' s="' + st + '"' : '') + '><v>' + ds + '</v></c>'; return; }
        }
        x += '<c r="' + ref + '"' + (st ? ' s="' + st + '"' : '') + (isNum ? '' : ' t="inlineStr"') + '>' +
          (isNum ? '<v>' + c.v + '</v>' : '<is><t xml:space="preserve">' + xesc(c.v) + '</t></is>') + '</c>';
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (sheet.merges && sheet.merges.length) {
      x += '<mergeCells count="' + sheet.merges.length + '">' +
        sheet.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>';
    }
    if (sheet.drawing) x += '<drawing r:id="rId1"/>';
    x += '</worksheet>';
    return x;
  }

  /* ---------- build ---------- */
  function build(opt) {
    var sheets = opt.sheets || [];
    var files = [];
    var enc = new TextEncoder();
    function add(name, str) { files.push({ name: name, data: enc.encode(str) }); }

    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (opt.image ? '<Default Extension="png" ContentType="image/png"/>' : '') +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      (opt.image ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') +
      '</Types>';
    add('[Content_Types].xml', ct);

    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');

    add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) {
        return '<sheet name="' + xesc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>');

    add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');

    add('xl/styles.xml', STYLES);

    sheets.forEach(function (s, i) {
      add('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s));
      if (s.drawing) {
        add('xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
          '</Relationships>');
      }
    });

    if (opt.image) {
      add('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<xdr:twoCellAnchor editAs="oneCell">' +
        '<xdr:from><xdr:col>' + opt.image.col + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + opt.image.row + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
        '<xdr:to><xdr:col>' + opt.image.col2 + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + opt.image.row2 + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
        '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="走势图"/><xdr:cNvPicPr/></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
        '<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>');
      add('xl/drawings/_rels/drawing1.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' +
        '</Relationships>');
      files.push({ name: 'xl/media/image1.png', data: b64ToU8(opt.image.data) });
    }

    return zip(files);
  }

  return { build: build };
})();
