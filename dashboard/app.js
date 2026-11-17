/* Token Radar dashboard — renders window.RADAR (data.js) only. No network. */
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:40px">Data failed to load (data.js missing).</p>'; return; }
  var M = R.model;

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt$(v) {
    if (v == null) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function fmtFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function fmtPct(v) { if (v == null) return '—'; return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function fmtAge(d) { if (d == null) return '—'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return d + 'd'; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* The value model, re-implemented from the snapshot's own figures. */
  function recompute(row) {
    var g = clamp(row.change_7d == null ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
    var gm = 1 + (g / 100) * M.growth_weight;
    var age = row.age_days == null ? M.unknown_age_days : row.age_days;
    var mm = M.maturity_floor + Math.min(age, M.maturity_days) / M.maturity_days * M.maturity_range;
    var bm = 1 + M.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), M.breadth_max_chains);
    var implied = Math.max(1, Math.round(row.tvl_usd * row.multiple * gm * mm * bm));
    return { g: g, growth: gm, maturity: mm, breadth: bm, base: Math.round(row.tvl_usd * row.multiple), implied: implied, age: age };
  }
  function calibFor(cat) {
    for (var i = 0; i < R.calibration.length; i++) if (R.calibration[i].category === cat) return R.calibration[i];
    return null;
  }
  function expandSteps(row) {
    var tpl = (R.templates && R.templates[row.archetype]) || R.templates['default'] || [];
    var subs = { '{name}': row.name, '{chain}': row.chains[0] || 'its main chain', '{capital}': String(row.capital), '{gas}': String(row.capital >= 150 ? 8 : 4), '{hold}': String(row.hold_days) };
    return tpl.map(function (s) {
      Object.keys(subs).forEach(function (k) { s = s.split(k).join(subs[k]); });
      return s.replace(/^\d+\.\s*/, ''); // templates may carry their own numbering
    });
  }

  /* ---------- header / lede / footer ---------- */
  $('meta').innerHTML = 'Snapshot <b>' + esc(R.as_of) + '</b> &nbsp;·&nbsp; Model <b>' + esc(R.model_version) + '</b><br>' +
    'Floor <b>' + fmt$(R.floor_usd) + '</b> TVL &nbsp;·&nbsp; ' + R.rows.length + ' protocols ranked';
  var wlCovered = R.rows.filter(function (r) { return r.watchlist; }).length;
  $('lede').innerHTML =
    stat(wlCovered + '<em> / ' + R.watchlist_size + '</em>', 'Watchlist protocols covered', true) +
    stat(R.board_size, 'Pre-token protocols on the board', false) +
    stat(R.early_size, 'Early finds below the $50M floor', false) +
    stat(R.live_size, 'Live-token peers for calibration', false);
  function stat(num, lbl, hot) { return '<div class="stat' + (hot ? ' hot' : '') + '"><div class="num">' + num + '</div><div class="lbl">' + lbl + '</div></div>'; }
  $('footer').innerHTML = '<b>Source:</b> ' + esc(R.source) + ' &nbsp;·&nbsp; Snapshot date ' + esc(R.as_of) +
    ' &nbsp;·&nbsp; Model ' + esc(R.model_version) +
    '<br>Implied value is a model, not a price. It estimates what a token could be worth at launch from TVL and the market caps of live peers — it is not a prediction of any listing price.';

  /* ---------- state + hash ---------- */
  var state = { q: '', category: '', chain: '', watchonly: false, tvlmin: 0, sortKey: 'rank', sortDir: 1, tab: 'board' };
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (pair) {
      var kv = pair.split('='), k = kv[0], v = decodeURIComponent(kv[1] || '');
      if (k === 'q') state.q = v;
      if (k === 'p') state.tab = ['board', 'live', 'model'].indexOf(v) >= 0 ? v : 'board';
      if (k === 'category') state.category = v;
    });
  }
  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.tab !== 'board') parts.push('p=' + state.tab);
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
  }

  /* ---------- controls ---------- */
  var cats = [], chains = [];
  R.rows.forEach(function (r) {
    if (cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('category').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function applyStateToControls() {
    $('q').value = state.q; $('category').value = state.category; $('chain').value = state.chain;
    $('watchonly').checked = state.watchonly; $('tvlmin').value = String(state.tvlmin);
  }
  $('q').addEventListener('input', function () { state.q = this.value.trim(); renderBoard(); writeHash(); });
  $('category').addEventListener('change', function () { state.category = this.value; renderBoard(); writeHash(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('watchonly').addEventListener('change', function () { state.watchonly = this.checked; renderBoard(); });
  $('tvlmin').addEventListener('change', function () { state.tvlmin = +this.value; renderBoard(); });
  $('clear-filters').addEventListener('click', function () {
    state.q = ''; state.category = ''; state.chain = ''; state.watchonly = false; state.tvlmin = 0;
    applyStateToControls(); renderBoard(); writeHash();
  });

  /* ---------- tabs ---------- */
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    ['board', 'live', 'model'].forEach(function (t) { $('panel-' + t).hidden = t !== tab; });
    $('controls').style.display = tab === 'board' ? '' : 'none';
    writeHash();
  }
  document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });

  /* ---------- board ---------- */
  function filtered() {
    var q = state.q.toLowerCase();
    return R.rows.filter(function (r) {
      if (state.watchonly && !r.watchlist) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.tvlmin && r.tvl_usd < state.tvlmin) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var k = state.sortKey, d = state.sortDir, av = a[k], bv = b[k];
      if (k === 'name') return d * String(av).localeCompare(String(bv));
      if (k === 'change_7d') { av = av == null ? -1e9 : av; bv = bv == null ? -1e9 : bv; }
      return d * (av - bv);
    });
  }
  var maxImplied = R.rows.length ? R.rows[0].implied_value_usd : 1;
  function renderBoard() {
    var list = filtered();
    $('count').innerHTML = 'Showing <b>' + list.length + '</b> of ' + R.rows.length + ' protocols';
    $('empty').hidden = list.length > 0;
    $('board-body').innerHTML = list.map(function (r) {
      var pct = Math.max(2, Math.round(r.implied_value_usd / maxImplied * 100));
      var chg = r.change_7d == null ? '<span>—</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</span>';
      return '<tr tabindex="0" data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name">' + esc(r.name) + '</div><div class="sub">' + esc(r.slug) + ' · ' + esc(r.chains.join(', ')) + '</div></td>' +
        '<td class="num">' + fmt$(r.tvl_usd) + '<div class="sub">' + esc(r.category || 'Unknown') + '</div></td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num bar-cell">' + fmt$(r.implied_value_usd) + '<div class="bar-track"><div class="bar-fill' + (r.rank <= 3 ? ' top' : '') + '" style="width:' + pct + '%"></div></div></td>' +
        '<td><span class="badge notoken">no token</span>' + (r.watchlist ? '<span class="badge watch">watchlist</span>' : '') + '</td>' +
        '</tr>';
    }).join('');
    document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
      var on = th.dataset.sort === state.sortKey;
      th.classList.toggle('sorted', on);
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (on ? (state.sortDir > 0 ? ' ▲' : ' ▼') : '');
    });
  }
  document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.sort;
      if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = (k === 'rank' || k === 'name') ? 1 : -1; }
      renderBoard();
    });
  });
  $('board-body').addEventListener('click', function (e) { var tr = e.target.closest('tr'); if (tr) openDetail(tr.dataset.slug); });
  $('board-body').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var tr = e.target.closest('tr'); if (tr) openDetail(tr.dataset.slug); }
  });

  /* ---------- live tab ---------- */
  $('live-body').innerHTML = R.live.map(function (p) {
    var ratio = p.mcap_usd / p.tvl_usd;
    var chg = p.change_7d == null ? '—' : '<span class="' + (p.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(p.change_7d) + '</span>';
    return '<tr><td><div class="name">' + esc(p.name) + '</div><div class="sub">' + esc(p.slug) + ' · ' + esc(p.chains.join(', ')) + '</div></td>' +
      '<td class="cat">' + esc(p.category || 'Unknown') + '</td>' +
      '<td class="num">' + fmt$(p.tvl_usd) + '</td><td class="num">' + fmt$(p.mcap_usd) + '</td>' +
      '<td class="num">' + ratio.toFixed(3) + 'x</td><td class="num">' + chg + '</td></tr>';
  }).join('');

  /* ---------- model tab ---------- */
  $('formula').innerHTML =
    '<code>implied = TVL x multiple x growth x maturity x breadth</code>' +
    '<ul>' +
    '<li><b>Multiple</b> — the category median mcap / TVL of live peers, shrunk toward the global median ' + M.global_median + ' with k = ' + M.shrink_k + '. Categories with fewer than 3 live peers use ' + M.global_median + '.</li>' +
    '<li><b>Growth</b> — 1 + (7d TVL change, clamped to ' + M.growth_floor + '% … +' + M.growth_cap + '%) x ' + M.growth_weight + '.</li>' +
    '<li><b>Maturity</b> — ' + M.maturity_floor + ' + min(age, ' + M.maturity_days + ' days) / ' + M.maturity_days + ' x ' + M.maturity_range + '. Unknown listing date counts as ' + M.unknown_age_days + ' days.</li>' +
    '<li><b>Breadth</b> — 1 + ' + M.breadth_per_chain + ' per extra chain, up to ' + M.breadth_max_chains + ' extra chains.</li>' +
    '<li>Implied value is rounded to whole dollars and floored at $1.</li>' +
    '</ul>';
  $('calib-body').innerHTML = R.calibration.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td class="num">' + c.median.toFixed(4) + 'x</td><td class="num">' + c.multiple.toFixed(4) + 'x</td></tr>';
  }).join('');
  (function chart() {
    var top = R.calibration.slice(0, 10);
    var max = top.length ? top[0].multiple : 1;
    var W = 560, rowH = 27, labelW = 150, valW = 52;
    var h = top.length * rowH + 8;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + h + '" width="100%" role="img" aria-label="Top category multiples">';
    top.forEach(function (c, i) {
      var y = 8 + i * rowH, bw = (W - labelW - valW - 8) * (c.multiple / max);
      svg += '<text x="0" y="' + (y + 13) + '" fill="#9fb0cc" font-size="12">' + esc(c.category.length > 20 ? c.category.slice(0, 19) + '…' : c.category) + '</text>' +
        '<rect x="' + labelW + '" y="' + y + '" width="' + Math.max(2, bw).toFixed(1) + '" height="15" rx="3" fill="#22d3ee" opacity="' + (0.45 + 0.55 * (c.multiple / max)).toFixed(2) + '"/>' +
        '<text x="' + (labelW + bw + 8) + '" y="' + (y + 13) + '" fill="#e6edf7" font-size="12">' + c.multiple.toFixed(3) + 'x</text>';
    });
    $('chart').innerHTML = svg + '</svg><p class="chart-note">Highest shrunk mcap / TVL multiples by category. The global median is ' + M.global_median + 'x.</p>';
  })();

  /* ---------- detail dialog ---------- */
  var dlg = $('detail');
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return;
    var rc = recompute(r);
    var ok = rc.implied === r.implied_value_usd;
    var cal = calibFor(r.category);
    var calNote = cal
      ? 'Category <b>' + esc(r.category) + '</b>: ' + cal.n + ' live peer' + (cal.n === 1 ? '' : 's') + ', median mcap / TVL ' + cal.median.toFixed(4) + 'x, shrunk multiple ' + cal.multiple.toFixed(4) + 'x' + (cal.n < 3 ? ' (fewer than 3 peers — the multiple falls back to the global median ' + M.global_median + ').' : '.')
      : 'No live peers in category <b>' + esc(r.category || 'Unknown') + '</b> — the multiple falls back to the global median ' + M.global_median + '.';
    var steps = expandSteps(r).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('detail-inner').innerHTML =
      '<div class="detail-head"><div><h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
      '<div class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Unknown') + ' · ' + esc(r.chains.join(', ')) + '</div></div>' +
      '<button class="close-x" id="dlg-close" type="button" aria-label="Close">✕</button></div>' +
      '<div class="kv">' +
      '<div class="k"><div class="v">' + fmt$(r.tvl_usd) + '</div><div class="l">TVL</div></div>' +
      '<div class="k"><div class="v">' + fmtPct(r.change_7d) + '</div><div class="l">7d change</div></div>' +
      '<div class="k"><div class="v">' + fmtAge(r.age_days) + '</div><div class="l">Age</div></div>' +
      '<div class="k"><div class="v">' + fmt$(r.implied_value_usd) + '</div><div class="l">Implied value</div></div></div>' +
      '<h3>Model breakdown</h3>' +
      '<table class="math"><tbody>' +
      '<tr><td>TVL ' + fmtFull(r.tvl_usd) + ' x multiple ' + r.multiple.toFixed(4) + 'x</td><td>' + fmtFull(rc.base) + '</td></tr>' +
      '<tr><td>Growth multiplier (7d ' + fmtPct(r.change_7d) + ', clamped)</td><td>' + rc.growth.toFixed(4) + 'x</td></tr>' +
      '<tr><td>Maturity multiplier (' + (r.age_days == null ? 'unknown — counted as ' + M.unknown_age_days + ' days' : r.age_days + ' days old') + ')</td><td>' + rc.maturity.toFixed(4) + 'x</td></tr>' +
      '<tr><td>Breadth multiplier (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td>' + rc.breadth.toFixed(4) + 'x</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + fmtFull(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<div class="verify' + (ok ? '' : ' bad') + '">' + (ok
        ? 'Verified: recomputing from this row\'s own TVL, multiple and factors gives ' + fmtFull(rc.implied) + ' — it matches the stored value.'
        : 'Mismatch: recomputed ' + fmtFull(rc.implied) + ' but the stored value is ' + fmtFull(r.implied_value_usd) + '.') + '</div>' +
      '<h3>Calibration note</h3><p class="calib-note">' + calNote + '</p>' +
      '<h3>Farm plan — ' + esc(r.archetype) + ' · ' + fmt$(r.capital) + ' · ' + r.hold_days + ' days</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p style="margin-top:18px"><button id="dlg-done" type="button">Done</button></p>';
    $('dlg-close').addEventListener('click', function () { dlg.close(); });
    $('dlg-done').addEventListener('click', function () { dlg.close(); });
    if (!dlg.open) dlg.showModal();
  }
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg.open) dlg.close(); });

  /* ---------- boot ---------- */
  readHash();
  applyStateToControls();
  setTab(state.tab);
  renderBoard();
})();
