/* Statement → Xero converter. Pure logic, no DOM, no storage, no network. */
(function (root) {
  'use strict';

  // ---------- CSV parsing ----------
  function detectDelimiter(text) {
    const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 25);
    const cands = [',', ';', '\t', '|'];
    let best = ',', bestScore = -1;
    for (const d of cands) {
      let score = 0;
      for (const line of lines) {
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') inQ = !inQ;
          else if (c === d && !inQ) score++;
        }
      }
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"' && field === '') {
        inQ = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(r => r.map(c => c.replace(/\s+/g, ' ').trim()));
  }

  const isBlankRow = r => !r || r.every(c => c === '');

  // ---------- Header detection ----------
  const HEADER_WORDS = /date|desc|detail|narrat|particular|amount|debit|credit|withdraw|deposit|balance|ref|payee|memo|type|currency|status|transaction|cheque|check|remark|merchant/i;

  function detectHeaderRow(rows) {
    let best = 0, bestScore = 0;
    const lim = Math.min(rows.length, 30);
    for (let i = 0; i < lim; i++) {
      const r = rows[i];
      if (isBlankRow(r)) continue;
      let score = 0;
      for (const c of r) if (c && !/^[-+\d.,\s]+$/.test(c) && HEADER_WORDS.test(c)) score++;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  // ---------- Dates ----------
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function validYMD(y, m, d) {
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return { y, m, d };
  }
  const fullYear = y => (y < 100 ? 2000 + y : y);

  // order: 'DMY' | 'MDY' | 'YMD'  (used only for ambiguous numeric dates)
  function parseDate(str, order) {
    if (!str) return null;
    let s = String(str).trim();
    let m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?=$|[\sT])/))) return validYMD(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{8})(?=$|[\sT])/))) {
      const t = m[1];
      if (+t.slice(0, 4) >= 1900) return validYMD(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8));
      return order === 'MDY'
        ? validYMD(+t.slice(4, 8), +t.slice(0, 2), +t.slice(2, 4))
        : validYMD(+t.slice(4, 8), +t.slice(2, 4), +t.slice(0, 2));
    }
    if ((m = s.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2}|\d{4})(?=$|[\sT,])/))) {
      const a = +m[1], b = +m[2], y = fullYear(+m[3]);
      if (order === 'MDY') return validYMD(y, a, b);
      return validYMD(y, b, a);
    }
    if ((m = s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3,9})\.?[-\/. ,]*(\d{2}|\d{4})(?=$|[\sT,])/))) {
      const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
      return mo ? validYMD(fullYear(+m[3]), mo, +m[1]) : null;
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})(?=$|[\sT,])/))) {
      const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
      return mo ? validYMD(+m[3], mo, +m[2]) : null;
    }
    return null;
  }

  function detectDateOrder(rows, headerRow, col) {
    if (col < 0) return 'DMY';
    let firstOver12 = false, secondOver12 = false;
    const end = Math.min(rows.length, headerRow + 400);
    for (let r = headerRow + 1; r < end; r++) {
      const v = (rows[r] && rows[r][col]) || '';
      const m = v.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2}|\d{4})/);
      if (m) { if (+m[1] > 12) firstOver12 = true; if (+m[2] > 12) secondOver12 = true; }
    }
    if (firstOver12) return 'DMY';
    if (secondOver12) return 'MDY';
    return 'DMY';
  }

  function formatDate(d, fmt) {
    const p = n => String(n).padStart(2, '0');
    if (fmt === 'MDY') return `${p(d.m)}/${p(d.d)}/${d.y}`;
    if (fmt === 'YMD') return `${d.y}-${p(d.m)}-${p(d.d)}`;
    return `${p(d.d)}/${p(d.m)}/${d.y}`;
  }

  // ---------- Amounts ----------
  // Returns a number, or null when the cell is empty / a placeholder.
  function parseAmount(str) {
    if (str == null) return null;
    let s = String(str).trim();
    if (s === '' || /^[-–—.]+$/.test(s)) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/\bDR\b\.?$/i.test(s) || /\d\s*DR$/i.test(s)) { neg = true; s = s.replace(/\s*DR\.?$/i, ''); }
    else if (/\d\s*CR$/i.test(s) || /\bCR\b\.?$/i.test(s)) { s = s.replace(/\s*CR\.?$/i, ''); }
    s = s.replace(/[^\d.,\-+]/g, '');
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
    s = s.replace(/^\+/, '');
    if (!/\d/.test(s)) return null;
    const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
    if (lastC > -1 && lastD > -1) {
      if (lastC > lastD) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastC > -1) {
      const commas = (s.match(/,/g) || []).length;
      if (commas === 1 && /,\d{1,2}$/.test(s)) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  // ---------- Auto column mapping ----------
  const norm = h => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function autoMap(rows, headerRow) {
    const headers = (rows[headerRow] || []).map(norm);
    const sample = [];
    for (let r = headerRow + 1; r < Math.min(rows.length, headerRow + 60); r++) if (!isBlankRow(rows[r])) sample.push(rows[r]);
    const share = (col, test) => {
      const vals = sample.map(r => r[col] || '').filter(v => v !== '' && !/^[-–—]$/.test(v));
      if (!vals.length) return 0;
      return vals.filter(test).length / vals.length;
    };
    const used = new Set();
    const find = (patterns, exclude, validator) => {
      for (const p of patterns) {
        for (let i = 0; i < headers.length; i++) {
          if (used.has(i) || !headers[i]) continue;
          if (!p.test(headers[i])) continue;
          if (exclude && exclude.test(headers[i])) continue;
          if (validator && !validator(i)) continue;
          used.add(i);
          return i;
        }
      }
      return -1;
    };
    const isDate = i => share(i, v => !!parseDate(v, 'DMY') || !!parseDate(v, 'MDY')) >= 0.5;
    const isNum = i => share(i, v => parseAmount(v) !== null) >= 0.5;
    const NOT_AMT = /total|count|balance|hold|fee|charge|rate/;

    let dateCol = find([/^date$/, /^(transaction|trans|txn|booking|posting|posted) date/, /^post date/, /value date/, /date/], null, isDate);
    if (dateCol < 0) {
      for (let i = 0; i < headers.length; i++) if (!used.has(i) && isDate(i)) { dateCol = i; used.add(i); break; }
    }
    const debitCol = find([/debit|withdraw|money out|paid out|^payments?$|^dr$/], /total|count|balance|hold/, isNum);
    const creditCol = find([/credit|deposit|money in|paid in|^receipts?$|^cr$/], /total|count|balance|hold/, isNum);
    let amountCol = -1, amountMode = 'single';
    if (debitCol >= 0 && creditCol >= 0) amountMode = 'split';
    else {
      amountCol = find([/^(transaction )?amount$/, /amount/], NOT_AMT, isNum);
      if (amountCol < 0 && (debitCol >= 0 || creditCol >= 0)) amountMode = 'split';
      if (amountCol >= 0 && (debitCol >= 0 || creditCol >= 0)) { /* prefer the amount column */ amountMode = 'single'; }
    }
    const payeeCol = find([/payee|beneficiar|merchant|counterpart|other party|^name$|payer|recipient|sender/], null);
    const descCol = find([/description|narrat|particulars|transaction details|details|memo|remarks?/], /date|amount|balance|supplementary|additional/);
    const descAppendCol = find([/note|memo|remark|supplementary|additional|comment|message/], /date|amount|balance/);
    const refCol = find([/transaction ref|txn ref|trans ref|transaction id|txn id/, /ref for|reference|^ref/, /ref/], /date|amount|balance/);
    const refFallbackCol = find([/reference|ref/], /date|amount|balance/);
    const checkCol = find([/cheque|check|chq/], /date|amount|balance/);

    const list = (...a) => a.filter(i => i >= 0);
    return {
      headerRow, dateCol, amountMode, amountCol, debitCol, creditCol,
      payeeCols: list(payeeCol), payeeJoin: ' - ',
      descCols: list(descCol, descAppendCol), descJoin: ' - ',
      refCols: list(refCol, refFallbackCol), refJoin: 'first',
      checkCols: list(checkCol), checkJoin: ' - '
    };
  }

  // ---------- Combining several columns into one field ----------
  // join: 'first' = first non-empty column only; otherwise the text placed between values.
  function combine(row, cols, join) {
    const vals = [];
    for (const i of cols || []) {
      const v = i >= 0 && i < row.length ? row[i] : '';
      if (v) vals.push(v);
    }
    if (!vals.length) return '';
    if (join === 'first') return vals[0];
    let text = vals[0];
    for (let k = 1; k < vals.length; k++) {
      if (!text.toLowerCase().includes(vals[k].toLowerCase())) text += join + vals[k];
    }
    return text;
  }

  // ---------- Conversion ----------
  function convert(rows, cfg) {
    const out = [], skipped = [];
    let inC = 0, outC = 0, zeroSkipped = 0, minD = null, maxD = null;
    const order = cfg.dateFmt && cfg.dateFmt !== 'auto' ? cfg.dateFmt : detectDateOrder(rows, cfg.headerRow, cfg.dateCol);
    const outFmt = cfg.outFmt || 'DMY';
    const dateKey = d => d.y * 10000 + d.m * 100 + d.d;

    for (let r = cfg.headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      if (isBlankRow(row)) continue;
      const get = i => (i >= 0 && i < row.length ? row[i] : '');

      const dateStr = get(cfg.dateCol);
      const d = parseDate(dateStr, order);

      let amt = null;
      if (cfg.amountMode === 'split') {
        const dv = parseAmount(get(cfg.debitCol)), cv = parseAmount(get(cfg.creditCol));
        if (dv !== null || cv !== null) amt = Math.abs(cv || 0) - Math.abs(dv || 0);
      } else {
        amt = parseAmount(get(cfg.amountCol));
      }
      if (amt !== null && cfg.invert) amt = -amt;

      if (!dateStr && amt === null) continue;            // spacer / summary row
      if (!d && amt === null) continue;                  // footer text
      if (!d) { skipped.push({ row: r + 1, reason: `Unrecognised date “${dateStr}”` }); continue; }
      if (amt === null) { skipped.push({ row: r + 1, reason: 'No amount found' }); continue; }
      amt = Math.round(amt * 100) / 100;
      if (amt === 0 && cfg.skipZero) { zeroSkipped++; continue; }

      out.push({
        date: formatDate(d, outFmt),
        amount: amt.toFixed(2),
        payee: combine(row, cfg.payeeCols, cfg.payeeJoin),
        description: combine(row, cfg.descCols, cfg.descJoin),
        reference: combine(row, cfg.refCols, cfg.refJoin),
        check: combine(row, cfg.checkCols, cfg.checkJoin)
      });
      const cents = Math.round(amt * 100);
      if (cents > 0) inC += cents; else outC += cents;
      const k = dateKey(d);
      if (minD === null || k < minD.k) minD = { k, d };
      if (maxD === null || k > maxD.k) maxD = { k, d };
    }
    return {
      out, skipped, zeroSkipped,
      moneyIn: inC / 100, moneyOut: outC / 100,
      from: minD ? formatDate(minD.d, outFmt) : '', to: maxD ? formatDate(maxD.d, outFmt) : ''
    };
  }

  // ---------- Xero CSV ----------
  const XERO_HEADER = ['*Date', '*Amount', 'Payee', 'Description', 'Reference', 'Check Number'];
  const esc = v => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

  function toXeroCSV(out) {
    const lines = [XERO_HEADER.join(',')];
    for (const o of out) lines.push([o.date, o.amount, o.payee, o.description, o.reference, o.check].map(esc).join(','));
    return lines.join('\r\n') + '\r\n';
  }

  const api = { parseCSV, detectHeaderRow, autoMap, convert, toXeroCSV, parseDate, parseAmount, isBlankRow, XERO_HEADER };
  root.Converter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
