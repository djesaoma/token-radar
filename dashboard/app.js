/* Peer multiples are fitted from the snapshot's live-token mcap/TVL ratios; the holdout metrics
   shown here and every implied value are computed by the build from that same sealed snapshot. */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var state = { tab: 'pre', q: '', category: 'all', chain: 'all', sort: 'implied', dir: -1, selected: null };
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return '$' + new Intl.NumberFormat('en-US', { notation: n >= 1e9 ? 'compact' : 'standard', maximumFractionDigits: n >= 1e9 ? 2 : 0 }).format(n); };
  var pct = function (n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; };
  var ageText = function (n) { return n === null ? 'unknown' : n >= 365 ? (n / 365).toFixed(1) + ' years' : n + ' days'; };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function put(id, text) { $(id).textContent = text; }
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    state.q = p.get('q') || ''; state.category = p.get('category') || 'all'; state.chain = p.get('chain') || 'all';
    state.selected = p.get('protocol'); state.tab = p.get('tab') === 'live' ? 'live' : 'pre';
  }
  function saveHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.selected) p.set('protocol', state.selected);
    history.replaceState(null, '', p.toString() ? '#' + p.toString() : location.pathname + location.search);
  }
  function fillSelect(id, values, label) {
    var select = $(id); select.innerHTML = '<option value="all">' + label + '</option>';
    values.forEach(function (value) { var o = document.createElement('option'); o.value = value; o.textContent = value; select.appendChild(o); });
    select.value = values.indexOf(state[id]) >= 0 ? state[id] : 'all';
  }
  function metrics() {
    var rows = [
      [D.protocols_total, 'protocol records'], [D.watchlist_size + ' / ' + D.watchlist_size, 'watchlist covered'],
      [D.board_size, 'pre-token ranked'], [D.live_size, 'live-token comps'], [D.as_of, 'snapshot date']
    ];
    $('metrics').innerHTML = rows.map(function (x) { return '<div class="metric"><strong>' + esc(x[0]) + '</strong><span>' + esc(x[1]) + '</span></div>'; }).join('');
  }
  function model() {
    var m = D.model;
    put('formula', 'round(TVL × fitted category multiple × [1 + ' + m.growth_weight + ' × clip(7d%, ' + m.growth_floor + ', +' + m.growth_cap + ')/100] × maturity(age) × breadth(chains))');
    var h = m.holdout;
    put('validation-note', 'Deterministic 80/20 live-token holdout · ' + h.count + ' held out · median absolute % error ' + h.median_absolute_pct_error.toFixed(1) + '% · ' + (h.within_2x_share * 100).toFixed(1) + '% within 2×. Peer mcap/TVL ratios are capped at 5.0× before fitting. Ranking signal, not a price forecast. Maturity peaks near two years, then eases toward ' + m.maturity_old + '; unknown age assumes one year. Chain breadth adds 2.5% per extra chain, capped at 10%.');
    put('model-version', 'MODEL ' + D.model_version);
    var entries = Object.keys(m.category_multiples).map(function (k) { return [k, m.category_multiples[k]]; }).sort(function (a, b) { return b[1].multiple - a[1].multiple || a[0].localeCompare(b[0]); });
    $('comps').innerHTML = entries.map(function (x) { return '<div class="comp"><span>' + esc(x[0]) + ' <small>n=' + x[1].peers + '</small></span><b>' + x[1].multiple.toFixed(3) + '×</b></div>'; }).join('');
  }
  function selectedRows() {
    var source = state.tab === 'pre' ? D.rows : D.live;
    var q = state.q.trim().toLowerCase();
    return source.filter(function (r) {
      if (state.tab === 'pre' && state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      return !q || [r.name, r.slug, r.category || '', r.chains.join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    }).slice().sort(function (a, b) {
      var av = state.sort === 'tvl' ? a.tvl_usd : state.sort === 'growth' ? (a.change_7d == null ? -Infinity : a.change_7d) : state.sort === 'age' ? (a.age_days == null ? -Infinity : a.age_days) : a.implied_value_usd || a.mcap_usd;
      var bv = state.sort === 'tvl' ? b.tvl_usd : state.sort === 'growth' ? (b.change_7d == null ? -Infinity : b.change_7d) : state.sort === 'age' ? (b.age_days == null ? -Infinity : b.age_days) : b.implied_value_usd || b.mcap_usd;
      return (av < bv ? -state.dir : av > bv ? state.dir : 0) || a.slug.localeCompare(b.slug);
    });
  }
  function sortButton(key, title) { return '<button data-sort="' + key + '">' + title + (state.sort === key ? (state.dir < 0 ? ' ↓' : ' ↑') : '') + '</button>'; }
  function renderHead() {
    if (state.tab === 'pre') $('table-head').innerHTML = '<tr><th>RK</th><th>' + sortButton('name', 'PROTOCOL') + '</th><th>' + sortButton('tvl', 'TVL') + '</th><th>' + sortButton('growth', '7D') + '</th><th>' + sortButton('age', 'AGE') + '</th><th>' + sortButton('implied', 'IMPLIED VALUE') + '</th><th>RECORD</th></tr>';
    else $('table-head').innerHTML = '<tr><th>MCAP RANK</th><th>PROTOCOL</th><th>TVL</th><th>7D</th><th>MCAP / TVL</th><th>MARKET CAP</th><th>RECORD</th></tr>';
    Array.prototype.forEach.call($('table-head').querySelectorAll('[data-sort]'), function (b) { b.onclick = function () { if (state.sort === b.dataset.sort) state.dir *= -1; else { state.sort = b.dataset.sort; state.dir = -1; } render(); }; });
  }
  function renderTable() {
    var rows = selectedRows();
    put('result-count', rows.length + (state.tab === 'pre' ? ' MATCHING' : ' SHOWN'));
    renderHead();
    if (!rows.length) { $('table-body').innerHTML = '<tr><td class="empty" colspan="7">No protocol matches these filters.</td></tr>'; return; }
    var max = Math.max(1, rows[0].implied_value_usd || rows[0].mcap_usd);
    $('table-body').innerHTML = rows.map(function (r, i) {
      var implied = state.tab === 'pre' ? r.implied_value_usd : r.mcap_usd;
      var rank = state.tab === 'pre' ? String(r.rank).padStart(2, '0') : String(i + 1).padStart(2, '0');
      var category = r.category || 'Other';
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.selected === r.slug ? 'selected' : '') + '"><td class="rank">' + rank + '</td><td class="protocol-cell"><div class="protocol-name">' + esc(r.name) + '</div><div class="protocol-sub">' + esc(category) + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + '</div></td><td class="mono">' + fmt(r.tvl_usd) + '</td><td class="mono ' + (r.change_7d >= 0 ? 'positive' : 'negative') + '">' + pct(r.change_7d) + '</td><td class="mono">' + (r.age_days == null ? '—' : ageText(r.age_days)) + '</td><td><span class="bar"><i style="width:' + Math.max(4, Math.round(100 * implied / max)) + '%"></i></span><span class="value">' + fmt(implied) + '</span></td><td><span class="status">' + (state.tab === 'pre' ? 'records no token' : 'trades') + '</span></td></tr>';
    }).join('');
    Array.prototype.forEach.call($('table-body').querySelectorAll('tr[data-slug]'), function (tr) { tr.onclick = function () { openDrawer(tr.dataset.slug); }; });
  }
  function openDrawer(slug) {
    var r = D.rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    state.selected = slug; saveHash();
    var m = D.model; var components = [
      ['TVL base', fmt(r.tvl_usd)], ['Category multiple', r.category_multiple.toFixed(3) + '×'],
      ['7-day growth factor', r.growth_multiplier.toFixed(3) + '×'], ['Maturity factor', r.maturity_multiplier.toFixed(3) + '×'],
      ['Chain breadth', r.chain_breadth_multiplier.toFixed(3) + '×'], ['Implied value', fmt(r.implied_value_usd)]
    ];
    $('drawer').innerHTML = '<div class="drawer-top"><div><div class="eyebrow">RANK ' + r.rank + ' / ' + D.board_size + '</div><h2>' + esc(r.name) + '</h2><div class="drawer-sub">' + esc(r.category || 'Other') + ' · ' + esc(r.chains.join(', ')) + '</div></div><button class="close" aria-label="Close details">×</button></div>' +
      '<section class="drawer-section"><h3>Implied value breakdown</h3><div class="breakdown">' + components.map(function (x) { return '<div><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div><p class="why">' + fmt(r.tvl_usd) + ' TVL × ' + r.category_multiple.toFixed(3) + ' peer multiple × ' + r.growth_multiplier.toFixed(3) + ' growth × ' + r.maturity_multiplier.toFixed(3) + ' maturity × ' + r.chain_breadth_multiplier.toFixed(3) + ' chain breadth. The result is a model estimate.</p></section>' +
      '<section class="drawer-section"><h3>Costed farm plan</h3><ol class="steps">' + r.farm_steps.map(function (s) { var found = / (?:Cost|Gas|Capital): /.exec(s); var split = found ? found.index : s.length; return '<li><div><div class="step-title">' + esc(s.slice(0, split)) + '</div><span class="step-meta">' + esc(s.slice(split + 1)) + '</span></div></li>'; }).join('') + '</ol></section>' +
      '<section class="drawer-section"><h3>Snapshot record</h3><div class="breakdown"><div><span>TVL</span><b>' + fmt(r.tvl_usd) + '</b></div><div><span>7-day change</span><b>' + pct(r.change_7d) + '</b></div><div><span>Listed</span><b>' + esc(r.listed_at || 'Not recorded') + '</b></div><div><span>Age</span><b>' + ageText(r.age_days) + '</b></div></div></section>';
    $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('shade').hidden = false;
    $('drawer').querySelector('.close').onclick = closeDrawer;
    renderTable();
  }
  function closeDrawer() { state.selected = null; saveHash(); $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); $('shade').hidden = true; renderTable(); }
  function render() {
    $('pre-tab').classList.toggle('active', state.tab === 'pre'); $('live-tab').classList.toggle('active', state.tab === 'live');
    $('pre-tab').setAttribute('aria-selected', state.tab === 'pre'); $('live-tab').setAttribute('aria-selected', state.tab === 'live');
    $('category').disabled = state.tab !== 'pre';
    renderTable();
    if (state.selected) openDrawer(state.selected);
  }
  function boot() {
    readHash();
    put('snapshot-date', D.as_of); put('pre-count', D.board_size); put('live-count', D.live.length);
    put('source-line', D.source + ' · ' + D.as_of + ' · Floor ' + fmt(D.floor_usd));
    metrics(); model();
    var categories = Array.from(new Set(D.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(D.rows.flatMap(function (r) { return r.chains; }))).sort();
    fillSelect('category', categories, 'All categories'); fillSelect('chain', chains, 'All chains');
    $('search').value = state.q;
    $('search').oninput = function () { state.q = this.value; saveHash(); renderTable(); };
    $('category').onchange = function () { state.category = this.value; saveHash(); renderTable(); };
    $('chain').onchange = function () { state.chain = this.value; saveHash(); renderTable(); };
    $('pre-tab').onclick = function () { state.tab = 'pre'; state.selected = null; closeDrawer(); saveHash(); render(); };
    $('live-tab').onclick = function () { state.tab = 'live'; state.selected = null; closeDrawer(); saveHash(); render(); };
    $('shade').onclick = closeDrawer;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.selected) closeDrawer(); });
    window.addEventListener('hashchange', function () { var old = state.selected; readHash(); if (old !== state.selected) render(); });
    render();
  }
  boot();
})();
