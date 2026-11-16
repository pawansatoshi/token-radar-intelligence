(function () {
  'use strict';
  const book = window.RADAR;
  const root = document.querySelector('#board');
  if (!book || !root) return;

  const view = { mode: 'ranked', query: '', category: 'all', order: 'value', direction: -1, focus: null };
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const compact = (n) => n == null ? 'Unreported' : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3)}K` : money.format(n);
  const percent = (n) => n == null ? 'Unreported' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
  const ageLabel = (days) => days == null ? 'Unknown' : days >= 365 ? `${(days / 365).toFixed(1)} years` : `${days} days`;
  const node = (tag, text, classes) => {
    const item = document.createElement(tag);
    if (text !== undefined && text !== null) item.textContent = String(text);
    if (classes) item.className = classes;
    return item;
  };
  const button = (label, action, classes) => {
    const item = node('button', label, classes);
    item.type = 'button'; item.addEventListener('click', action); return item;
  };
  const section = (title, content) => {
    const block = node('section', null, 'sheet-block');
    block.append(node('h3', title), content); return block;
  };
  const categories = [...new Set(book.rows.map((r) => r.category || 'Other'))].sort((a, b) => a.localeCompare(b));

  function header() {
    const bar = node('header', null, 'masthead');
    const wordmark = node('div', null, 'wordmark');
    wordmark.append(node('span', 'LS', 'brand-stamp'), node('span', 'LAUNCHSCOPE', 'brand-name'), node('span', 'TOKEN RADAR', 'brand-product'));
    const meta = node('div', null, 'mast-meta');
    meta.append(node('span', `Snapshot ${book.as_of}`), node('span', book.model_version), node('span', 'Offline dataset'));
    bar.append(wordmark, meta); return bar;
  }

  function summary() {
    const intro = node('section', null, 'intro');
    const copy = node('div');
    copy.append(node('p', 'TOKEN RESEARCH  /  FROZEN SNAPSHOT', 'eyebrow'), node('h1', `${book.board_size} pre-token records, ranked by implied value`));
    copy.append(node('p', 'All snapshot records are visible as ranked, live-token, or excluded derivative entries. A missing token identifier is a source record, not proof a token does not exist or a forecast that one will launch.', 'lede'));
    const stats = node('div', null, 'coverage-card');
    stats.append(node('span', 'DATASET COVERAGE', 'eyebrow'), node('strong', String(book.dataset_size), 'coverage-total'));
    const mix = node('div', null, 'coverage-mix');
    [[book.board_size, 'ranked'], [book.live_size, 'live'], [book.excluded.length, 'excluded']].forEach(([n, label]) => {
      const stat = node('div'); stat.append(node('b', String(n)), node('small', label)); mix.append(stat);
    });
    stats.append(mix, node('span', `${book.watchlist.length} / ${book.watchlist.length} watchlist entries covered`, 'coverage-foot'));
    intro.append(copy, stats); return intro;
  }

  function controls() {
    const area = node('section', null, 'toolbar');
    const searchLabel = node('label', 'Search protocols, chains, or categories', 'control-label');
    const search = node('input', null, 'text-control'); search.id = 'radar-search'; search.type = 'search'; search.value = view.query; search.placeholder = 'Try “Ethereum” or “Lending”';
    search.addEventListener('input', () => { view.query = search.value; paint(); }); searchLabel.append(search);
    const group = node('label', 'Category', 'control-label');
    const picker = node('select', null, 'text-control'); picker.id = 'radar-category'; picker.setAttribute('aria-label', 'Filter category');
    [['all', 'All categories'], ...categories.map((c) => [c, c])].forEach(([key, label]) => {
      const option = node('option', label); option.value = key; option.selected = view.category === key; picker.append(option);
    });
    picker.addEventListener('change', () => { view.category = picker.value; paint(); }); group.append(picker);
    const tabs = node('div', null, 'mode-switch');
    [['ranked', 'Pre-token'], ['live', 'Live token'], ['excluded', `Excluded ${book.excluded.length}`]].forEach(([key, label]) => {
      const tab = button(label, () => { view.mode = key; view.focus = null; paint(); }, view.mode === key ? 'mode active' : 'mode');
      tab.id = `mode-${key}`;
      tab.setAttribute('aria-pressed', String(view.mode === key)); tabs.append(tab);
    });
    const count = view.mode === 'ranked' ? rowsForView().length : view.mode === 'live' ? liveForView().length : excludedForView().length;
    area.append(searchLabel, group, tabs, node('span', `${count} shown`, 'result-count'));
    return area;
  }

  function matches(row) {
    if (view.category !== 'all' && row.category !== view.category) return false;
    const words = `${row.name} ${row.slug} ${row.category || ''} ${(row.chains || []).join(' ')}`.toLowerCase();
    return words.includes(view.query.trim().toLowerCase());
  }
  function rowsForView() { return book.rows.filter(matches); }
  function liveForView() { return book.live.filter(matches); }
  function excludedForView() { return book.excluded.filter(matches); }
  function rankedRows() {
    const fields = { value: 'implied_value_usd', tvl: 'tvl_usd', growth: 'change_7d', confidence: 'confidence', risk: 'risk_score' };
    return rowsForView().slice().sort((a, b) => {
      const left = a[fields[view.order]] ?? Number.NEGATIVE_INFINITY;
      const right = b[fields[view.order]] ?? Number.NEGATIVE_INFINITY;
      return (left < right ? -1 : left > right ? 1 : a.slug.localeCompare(b.slug)) * view.direction;
    });
  }

  function sortButton(key, caption) {
    const label = view.order === key ? `${caption} ${view.direction < 0 ? '↓' : '↑'}` : caption;
    const control = button(label, () => {
      if (view.order === key) view.direction *= -1;
      else { view.order = key; view.direction = -1; }
      paint();
    }, 'sort-control');
    control.setAttribute('aria-label', `Sort by ${caption}`); return control;
  }

  function tableHead(labels) {
    const head = node('thead'); const row = node('tr');
    labels.forEach((label) => { const th = node('th', null); th.scope = 'col'; th.append(typeof label === 'string' ? node('span', label) : label); row.append(th); });
    head.append(row); return head;
  }
  function boardTable() {
    const rows = rankedRows();
    if (!rows.length) return emptyMessage();
    const table = node('table', null, 'protocol-table');
    table.append(node('caption', 'Ranked estimates — select a protocol for the evidence and farm plan.'), tableHead([
      sortButton('value', 'Rank'), 'Protocol', sortButton('tvl', 'TVL'), sortButton('growth', '7d change'),
      sortButton('confidence', 'Confidence'), sortButton('risk', 'Risk'), 'Implied value', 'Record',
    ]));
    const body = node('tbody');
    rows.forEach((r) => {
      const tr = node('tr'); tr.tabIndex = 0; tr.setAttribute('aria-label', `Open ${r.name} details`);
      const open = () => { tr.focus(); showDetails(r.slug); };
      tr.addEventListener('click', open); tr.addEventListener('keydown', (event) => { if (event.key === 'Enter') open(); });
      const id = node('td', String(r.rank), 'numeric');
      const protocol = node('td'); protocol.append(node('b', r.name), node('small', `${r.category || 'Other'} · ${(r.chains || []).slice(0, 2).join(', ') || 'chain unreported'}`));
      const growth = node('td', percent(r.change_7d), `numeric ${(r.change_7d ?? 0) >= 0 ? 'positive' : 'negative'}`);
      const value = node('td', null, 'value-cell');
      const ceiling = Math.max(...rows.map((entry) => entry.implied_value_usd));
      const bar = node('span', null, 'value-track'); const fill = node('i'); fill.style.width = `${Math.max(3, Math.round(100 * r.implied_value_usd / ceiling))}%`; bar.append(fill);
      value.append(bar, node('b', compact(r.implied_value_usd), 'numeric'));
      tr.append(id, protocol, node('td', compact(r.tvl_usd), 'numeric'), growth, node('td', `${r.confidence}/100`, 'numeric'), node('td', `${r.risk_score}/100`, 'numeric'), value);
      const marker = node('td'); marker.append(node('span', book.watchlist.includes(r.slug) ? 'Watchlist' : 'Early radar', 'record-tag'));
      tr.append(marker); body.append(tr);
    });
    table.append(body); return scrollFrame(table);
  }

  function liveTable() {
    const rows = liveForView();
    if (!rows.length) return emptyMessage();
    const table = node('table', null, 'protocol-table');
    table.append(node('caption', 'Snapshot records with token identifiers. Market cap is reported data, not an implied value.'), tableHead(['Protocol', 'Category', 'TVL', 'Market cap', '7d change', 'Status']));
    const body = node('tbody');
    rows.forEach((r) => {
      const tr = node('tr'); const name = node('td'); name.append(node('b', r.name), node('small', r.slug));
      tr.append(name, node('td', r.category || 'Other'), node('td', compact(r.tvl_usd), 'numeric'), node('td', compact(r.mcap_usd), 'numeric'), node('td', percent(r.change_7d), 'numeric'), node('td', 'Token recorded', 'positive')); body.append(tr);
    });
    table.append(body); return scrollFrame(table);
  }

  function excludedTable() {
    if (!excludedForView().length) return emptyMessage();
    const table = node('table', null, 'protocol-table');
    table.append(node('caption', 'No implied launch value is assigned to these pre-token derivative or versioned records.'), tableHead(['Protocol', 'Category', 'TVL', 'Excluded by']));
    const body = node('tbody');
    excludedForView().forEach((r) => {
      const tr = node('tr'); const name = node('td'); name.append(node('b', r.name), node('small', r.slug));
      tr.append(name, node('td', r.category || 'Other'), node('td', compact(r.tvl_usd), 'numeric'), node('td', r.reason)); body.append(tr);
    });
    table.append(body); return scrollFrame(table);
  }
  function scrollFrame(table) { const frame = node('div', null, 'table-frame'); frame.append(table); return frame; }
  function emptyMessage() {
    const message = node('div', null, 'empty-state'); message.append(node('h2', 'No matching records'), node('p', 'Change the search or category filter to return to the radar.'));
    message.append(button('Clear filters', () => { view.query = ''; view.category = 'all'; paint(); }, 'action-button')); return message;
  }

  function modelNote() {
    const note = node('section', null, 'model-note');
    note.append(node('p', 'VALUATION METHOD', 'eyebrow'), node('h2', 'One formula for every ranked record'));
    note.append(node('code', 'round(TVL × 0.25 × (1 + clamp(change_7d, −60, 120) / 100 × 0.5) × (0.6 + min(age_days, 1095) / 1095 × 0.4))'));
    note.append(node('p', `An unreported 7d change uses 0%; an unknown listing date uses ${book.model.unknown_age} days. Confidence scores field completeness. Risk is a category and movement heuristic, not an audit.`));
    note.append(node('p', `Source: ${book.source}. Snapshot as of ${book.as_of}. Farm actions are category-based candidates; the snapshot contains no app links, points program, launch notice, eligibility rules, or gas quotes.`));
    return note;
  }

  function showDetails(slug) {
    const r = book.rows.find((entry) => entry.slug === slug); if (!r) return;
    view.focus = slug;
    const veil = node('div', null, 'veil'); veil.setAttribute('role', 'presentation');
    const returnFocus = document.activeElement;
    let escape = null;
    const dismiss = () => {
      veil.remove();
      if (escape) document.removeEventListener('keydown', escape);
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
    };
    const dialog = node('aside', null, 'detail-drawer'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'detail-name');
    const top = node('div', null, 'drawer-top'); const titles = node('div');
    titles.append(node('span', `RANK ${String(r.rank).padStart(2, '0')} / ${book.board_size}`, 'eyebrow'), node('h2', r.name));
    const close = button('Close', dismiss, 'action-button'); close.setAttribute('aria-label', 'Close protocol details'); top.append(titles, close); dialog.append(top);
    const location = node('p', `${r.category || 'Other'} · ${(r.chains || []).join(', ') || 'chain unreported'}`, 'drawer-location'); dialog.append(location);
    const facts = node('div', null, 'fact-grid');
    [['TVL', compact(r.tvl_usd)], ['7d TVL change', percent(r.change_7d)], ['Time listed', ageLabel(r.age_days)], ['Confidence', `${r.confidence}/100`], ['Risk indicator', `${r.risk_score}/100`], ['Implied value', compact(r.implied_value_usd)]].forEach(([key, value]) => {
      const fact = node('div'); fact.append(node('span', key), node('b', value)); facts.append(fact);
    });
    dialog.append(section('Estimate inputs', facts));
    const evidence = node('ul', null, 'evidence-list'); r.evidence.forEach((item) => evidence.append(node('li', item)));
    evidence.append(node('li', 'A missing identifier means the source record has none; it does not establish token absence or future issuance.'));
    dialog.append(section('Evidence and limits', evidence));
    const steps = node('ol', null, 'farm-list');
    r.farm_steps.forEach((text) => {
      const item = node('li'); const split = text.indexOf(' Cost: ');
      item.append(node('p', split < 0 ? text : text.slice(0, split)));
      if (split >= 0) item.append(node('small', text.slice(split + 1), 'step-cost'));
      steps.append(item);
    });
    dialog.append(section('Farm plan', steps));
    veil.append(dialog); veil.addEventListener('click', (event) => { if (event.target === veil) dismiss(); });
    escape = (event) => { if (event.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', escape);
    root.append(veil); close.focus();
  }

  function paint() {
    const focusedId = document.activeElement?.id;
    const caret = focusedId === 'radar-search' ? document.activeElement.selectionStart : null;
    root.replaceChildren();
    root.append(header(), summary(), controls());
    const content = view.mode === 'ranked' ? boardTable() : view.mode === 'live' ? liveTable() : excludedTable();
    root.append(content);
    if (view.mode === 'ranked') root.append(modelNote());
    root.setAttribute('aria-busy', 'false');
    if (focusedId) {
      const restored = document.getElementById(focusedId);
      if (restored) { restored.focus(); if (caret !== null && restored.setSelectionRange) restored.setSelectionRange(caret, caret); }
    }
  }
  paint();
})();
