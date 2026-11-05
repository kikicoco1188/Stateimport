/* UI for Statement to Xero. All data lives in `session` (memory only) and is wiped by wipe(). */
(function () {
  'use strict';
  const C = window.Converter;
  const $ = id => document.getElementById(id);

  const COL_KEYS = ['dateCol', 'amountCol', 'debitCol', 'creditCol'];
  const MULTI = ['payee', 'desc', 'ref', 'check']; // cfg keys: <name>Cols (array of column numbers) and <name>Join
  const PREVIEW_ROWS = 8;
  let session = null; // { name, rows, cfg }

  const colLetter = i => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const money = n => n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- Loading ----------
  function showError(msg) { const e = $('error'); e.textContent = msg; e.hidden = !msg; }

  async function loadFile(file) {
    wipe(true);
    showError('');
    if (!file) return;
    if (/\.(xlsx|xls|xlsm|pdf|ods|zip)$/i.test(file.name)) {
      showError('This looks like a ' + file.name.split('.').pop().toUpperCase() + ' file. Only CSV files work here. In Excel, choose Save As, then CSV, and try again.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) { showError('That file is over 25 MB. Export a shorter date range and try again.'); return; }
    let text;
    try { text = await file.text(); } catch (e) { showError('That file could not be read.'); return; }
    if (text.indexOf('\u0000') !== -1 || text.slice(0, 2) === 'PK') { showError('That file is not plain text. Export your statement as CSV and try again.'); return; }
    const rows = C.parseCSV(text);
    text = null;
    if (rows.filter(r => !C.isBlankRow(r)).length < 2) { showError('No transactions found in that file. Check that it is a CSV export of your statement.'); return; }
    const headerRow = C.detectHeaderRow(rows);
    const cfg = Object.assign(C.autoMap(rows, headerRow), { dateFmt: 'auto', outFmt: 'DMY', invert: false, skipZero: true });
    session = { name: file.name, rows, cfg };
    $('fileName').textContent = file.name;
    $('step-upload').hidden = true;
    $('step-done').hidden = true;
    $('step-map').hidden = false;
    $('step-check').hidden = false;
    populateAll();
    refresh();
    $('step-map').scrollIntoView({ block: 'start' });
  }

  // ---------- Form <-> config ----------
  function fillSelect(sel, options, value) {
    sel.textContent = '';
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = String(o.value); opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.value = String(value);
  }

  function populateAll() {
    const { rows, cfg } = session;
    const hdrOpts = [];
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      if (C.isBlankRow(rows[i])) continue;
      const preview = rows[i].filter(Boolean).slice(0, 3).join(', ');
      hdrOpts.push({ value: i, label: 'Row ' + (i + 1) + ': ' + (preview.length > 60 ? preview.slice(0, 57) + '...' : preview) });
    }
    fillSelect($('headerRow'), hdrOpts, cfg.headerRow);
    populateColumns();
    $('dateFmt').value = cfg.dateFmt;
    $('outFmt').value = cfg.outFmt;
    $('invert').checked = cfg.invert;
    $('skipZero').checked = cfg.skipZero;
    document.querySelectorAll('input[name=amountMode]').forEach(r => { r.checked = r.value === cfg.amountMode; });
    toggleAmountMode(cfg.amountMode);
  }

  function populateColumns() {
    const { rows, cfg } = session;
    const headers = rows[cfg.headerRow] || [];
    const opts = [{ value: -1, label: 'Not used' }];
    headers.forEach((h, i) => opts.push({ value: i, label: colLetter(i) + ': ' + (h || '(no name)') }));
    for (const k of COL_KEYS) fillSelect($(k), opts, cfg[k]);
    MULTI.forEach(renderMulti);
  }

  // ---------- Multi-column fields ----------
  function renderMulti(name) {
    const box = document.querySelector('[data-multi=' + name + ']');
    const cfg = session.cfg, cols = cfg[name + 'Cols'], headers = session.rows[cfg.headerRow] || [];
    const label = i => colLetter(i) + ': ' + (headers[i] || '(no name)');
    const list = box.querySelector('.chips');
    list.textContent = '';
    cols.forEach((ci, pos) => {
      const li = document.createElement('li');
      li.className = 'chip';
      const t = document.createElement('span'); t.className = 'ct'; t.textContent = label(ci); t.title = label(ci);
      li.appendChild(t);
      const mk = (txt, aria, disabled, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = txt; b.setAttribute('aria-label', aria + ' ' + label(ci)); b.disabled = disabled;
        b.addEventListener('click', fn); li.appendChild(b);
      };
      mk('\u2039', 'Move earlier:', pos === 0, () => { cols.splice(pos, 1); cols.splice(pos - 1, 0, ci); renderMulti(name); refresh(); });
      mk('\u203A', 'Move later:', pos === cols.length - 1, () => { cols.splice(pos, 1); cols.splice(pos + 1, 0, ci); renderMulti(name); refresh(); });
      mk('\u00D7', 'Remove', false, () => { cols.splice(pos, 1); renderMulti(name); refresh(); });
      list.appendChild(li);
    });
    const add = box.querySelector('.madd');
    const opts = [{ value: -1, label: cols.length ? 'Add another column...' : 'Add a column...' }];
    headers.forEach((h, i) => { if (!cols.includes(i)) opts.push({ value: i, label: label(i) }); });
    fillSelect(add, opts, -1);
    box.querySelector('.mjoin').value = cfg[name + 'Join'];
    box.querySelector('.mjoin').hidden = cols.length < 2;
  }

  function setupMulti() {
    MULTI.forEach(name => {
      const box = document.querySelector('[data-multi=' + name + ']');
      box.querySelector('.madd').addEventListener('change', e => {
        const v = parseInt(e.target.value, 10);
        if (v >= 0 && session) { session.cfg[name + 'Cols'].push(v); renderMulti(name); refresh(); }
      });
      box.querySelector('.mjoin').addEventListener('change', e => {
        if (session) { session.cfg[name + 'Join'] = e.target.value; refresh(); }
      });
    });
  }
  setupMulti();

  function toggleAmountMode(mode) {
    $('boxSingle').hidden = mode !== 'single';
    $('boxDebit').hidden = mode !== 'split';
    $('boxCredit').hidden = mode !== 'split';
  }

  function readForm() {
    const cfg = Object.assign({}, session.cfg); // multi-column lists live in session.cfg
    cfg.headerRow = parseInt($('headerRow').value, 10);
    for (const k of COL_KEYS) cfg[k] = parseInt($(k).value, 10);
    cfg.amountMode = document.querySelector('input[name=amountMode]:checked').value;
    cfg.dateFmt = $('dateFmt').value;
    cfg.outFmt = $('outFmt').value;
    cfg.invert = $('invert').checked;
    cfg.skipZero = $('skipZero').checked;
    return cfg;
  }

  // ---------- Preview ----------
  function refresh() {
    if (!session) return;
    session.cfg = readForm();
    const cfg = session.cfg;
    const res = C.convert(session.rows, cfg);
    session.result = res;

    const missing = [];
    if (cfg.dateCol < 0) missing.push('a Date column');
    if (cfg.amountMode === 'single' && cfg.amountCol < 0) missing.push('an Amount column');
    if (cfg.amountMode === 'split' && cfg.debitCol < 0 && cfg.creditCol < 0) missing.push('a Money out or Money in column');
    const mapMsg = $('mapMsg');
    if (missing.length) { mapMsg.textContent = 'Choose ' + missing.join(' and ') + ' in step 2 to see your transactions.'; mapMsg.hidden = false; }
    else if (!res.out.length) { mapMsg.textContent = 'No transactions were found with these settings. Check the header row, date and amount columns in step 2.'; mapMsg.hidden = false; }
    else mapMsg.hidden = true;

    $('sCount').textContent = String(res.out.length);
    $('sIn').textContent = money(res.moneyIn);
    $('sOut').textContent = money(res.moneyOut);
    $('sDates').textContent = res.from ? (res.from === res.to ? res.from : res.from + ' to ' + res.to) : '-';

    // warnings
    const warnBox = $('warnBox'), list = $('warnList');
    list.textContent = '';
    if (res.skipped.length) {
      $('warnSummary').textContent = res.skipped.length + (res.skipped.length === 1 ? ' row was' : ' rows were') + ' left out';
      res.skipped.slice(0, 50).forEach(s => { const li = document.createElement('li'); li.textContent = 'Row ' + s.row + ': ' + s.reason; list.appendChild(li); });
      if (res.skipped.length > 50) { const li = document.createElement('li'); li.textContent = 'and ' + (res.skipped.length - 50) + ' more'; list.appendChild(li); }
      warnBox.hidden = false;
    } else warnBox.hidden = true;

    // table
    const tb = $('preview');
    tb.textContent = '';
    res.out.slice(0, PREVIEW_ROWS).forEach(o => {
      const tr = document.createElement('tr');
      [o.date, o.amount, o.payee, o.description, o.reference, o.check].forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i === 1) td.className = 'num ' + (parseFloat(v) < 0 ? 'neg' : 'pos');
        if (i >= 2) td.title = v;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    const more = res.out.length - PREVIEW_ROWS;
    let note = more > 0 ? 'Showing the first ' + PREVIEW_ROWS + ' of ' + res.out.length + ' transactions.' : '';
    if (res.zeroSkipped) note += (note ? ' ' : '') + res.zeroSkipped + ' zero-amount ' + (res.zeroSkipped === 1 ? 'row' : 'rows') + ' left out.';
    $('moreRows').textContent = note;
    $('moreRows').hidden = !note;
    $('btnDownload').disabled = res.out.length === 0;
  }

  // ---------- Download + wipe ----------
  function download() {
    if (!session || !session.result || !session.result.out.length) return;
    const count = session.result.out.length;
    const base = session.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'statement';
    const fileName = 'xero-' + base + '.csv';
    const blob = new Blob([C.toXeroCSV(session.result.out)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    wipe(true);
    $('step-upload').hidden = true;
    $('doneMsg').textContent = fileName + ' (' + count + (count === 1 ? ' transaction' : ' transactions') + ') was saved to your downloads.';
    $('step-done').hidden = false;
    $('step-done').scrollIntoView({ block: 'start' });
  }

  // Removes every trace of the uploaded statement from memory and from the page.
  function wipe(keepScreen) {
    session = null;
    $('file').value = '';
    $('fileName').textContent = '';
    $('preview').textContent = '';
    $('warnList').textContent = '';
    $('warnBox').hidden = true;
    $('mapMsg').hidden = true;
    $('moreRows').textContent = '';
    ['sCount', 'sIn', 'sOut'].forEach(id => { $(id).textContent = id === 'sCount' ? '0' : '0.00'; });
    $('sDates').textContent = '-';
    ['headerRow'].concat(COL_KEYS).forEach(id => { $(id).textContent = ''; });
    document.querySelectorAll('[data-multi] .chips, [data-multi] .madd').forEach(el => { el.textContent = ''; });
    $('step-map').hidden = true;
    $('step-check').hidden = true;
    showError('');
    if (!keepScreen) { $('step-done').hidden = true; $('step-upload').hidden = false; }
  }

  // ---------- Events ----------
  $('file').addEventListener('change', e => loadFile(e.target.files && e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  $('headerRow').addEventListener('change', () => {
    const keep = readForm();
    const fresh = C.autoMap(session.rows, keep.headerRow);
    session.cfg = Object.assign(fresh, { dateFmt: keep.dateFmt, outFmt: keep.outFmt, invert: keep.invert, skipZero: keep.skipZero });
    populateAll();
    refresh();
  });
  document.querySelectorAll('input[name=amountMode]').forEach(r => r.addEventListener('change', () => { toggleAmountMode(r.value); refresh(); }));
  COL_KEYS.concat(['dateFmt', 'outFmt', 'invert', 'skipZero']).forEach(id => $(id).addEventListener('change', refresh));

  $('btnDownload').addEventListener('click', download);
  $('btnClear').addEventListener('click', () => wipe(false));
  $('btnAgain').addEventListener('click', () => wipe(false));
  window.addEventListener('pagehide', () => wipe(true));

  // ---------- PWA ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('btnInstall').hidden = false; });
  $('btnInstall').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt(); await deferred.userChoice; deferred = null; $('btnInstall').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; });
})();
