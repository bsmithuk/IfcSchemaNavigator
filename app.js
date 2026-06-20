'use strict';

const SCHEMA_META = {
  IFC2X3:      { label: 'IFC 2x3 TC1',    htmlBase: null },
  IFC4:        { label: 'IFC 4 ADD2 TC1',
                 htmlBase: 'https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/link/{lower}.htm' },
  IFC4X3_ADD2: { label: 'IFC 4X3 ADD2',
                 htmlBase: 'https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/{orig}.htm' },
};

const SCHEMA_ORDER = ['IFC4X3_ADD2', 'IFC4', 'IFC2X3'];

const state = {
  schemaKey: 'IFC4X3_ADD2',
  schema: null,
  query: '',
  showEntities: true,
  showTypes: true,
  showPsets: true,
  selected: null,  // { name, kind }
};

// ── init ────────────────────────────────────────────────────────────────────

function initApp() {
  const sel = document.getElementById('schema-select');
  SCHEMA_ORDER.forEach(key => {
    const meta = SCHEMA_META[key];
    const sc   = window.IFC_SCHEMAS && window.IFC_SCHEMAS[key];
    const ec   = sc ? Object.keys(sc.entities).length : 0;
    const opt  = document.createElement('option');
    opt.value       = key;
    opt.textContent = `${meta.label} (${ec})`;
    sel.appendChild(opt);
  });
  sel.value = state.schemaKey;

  sel.addEventListener('change', () => loadSchema(sel.value));
  document.getElementById('search-input').addEventListener('input', debounce(e => {
    state.query = e.target.value.trim().toLowerCase();
    renderTree();
  }, 150));
  document.getElementById('show-entities').addEventListener('change', e => {
    state.showEntities = e.target.checked;
    renderTree();
  });
  document.getElementById('show-types').addEventListener('change', e => {
    state.showTypes = e.target.checked;
    renderTree();
  });
  document.getElementById('show-psets').addEventListener('change', e => {
    state.showPsets = e.target.checked;
    renderTree();
  });

  window.addEventListener('hashchange', applyHash);
  window.addEventListener('resize', updateSubheaderHeight);

  loadSchema(state.schemaKey, true);
  updateSubheaderHeight();
}

function updateSubheaderHeight() {
  const el = document.querySelector('.app-subheader');
  if (el) document.documentElement.style.setProperty('--subheader-h', el.offsetHeight + 'px');
}

// ── schema loading ──────────────────────────────────────────────────────────

function loadSchema(key, fromInit) {
  state.schemaKey = key;
  state.schema    = window.IFC_SCHEMAS && window.IFC_SCHEMAS[key];
  state.selected  = null;
  document.getElementById('schema-select').value = key;
  renderTree();
  if (fromInit) {
    applyHash();
  } else {
    renderDetail(null);
    location.hash = key;
  }
}

// ── hash navigation ──────────────────────────────────────────────────────────

function applyHash() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) { renderDetail(null); return; }
  const [schemaKey, itemName] = hash.split('/');
  if (schemaKey && SCHEMA_META[schemaKey]) {
    if (schemaKey !== state.schemaKey) {
      state.schemaKey = schemaKey;
      state.schema    = window.IFC_SCHEMAS && window.IFC_SCHEMAS[schemaKey];
      document.getElementById('schema-select').value = schemaKey;
      renderTree();
    }
  }
  if (itemName && state.schema) {
    if (state.schema.entities[itemName]) {
      selectItem(itemName, 'entity', true);
    } else if (state.schema.types[itemName]) {
      selectItem(itemName, 'type', true);
    } else if (state.schema.psets && state.schema.psets[itemName]) {
      selectItem(itemName, 'pset', true);
    }
  } else {
    renderDetail(null);
  }
}

// ── tree ────────────────────────────────────────────────────────────────────

function getFilteredItems() {
  if (!state.schema) return [];
  const q = state.query;
  const items = [];

  if (state.showEntities) {
    Object.keys(state.schema.entities).forEach(n => {
      if (!q || n.toLowerCase().includes(q)) items.push({ name: n, kind: 'entity' });
    });
  }
  if (state.showTypes) {
    Object.keys(state.schema.types).forEach(n => {
      if (!q || n.toLowerCase().includes(q)) items.push({ name: n, kind: 'type' });
    });
  }
  if (state.showPsets && state.schema.psets) {
    Object.keys(state.schema.psets).forEach(n => {
      if (!q || n.toLowerCase().includes(q)) items.push({ name: n, kind: 'pset' });
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return items;
}

function renderTree() {
  const container = document.getElementById('tree');
  const items = getFilteredItems();
  const countEl = document.getElementById('result-count');
  if (countEl) countEl.textContent = `${items.length} result${items.length === 1 ? '' : 's'}`;
  const frag  = document.createDocumentFragment();

  items.forEach(({ name, kind }) => {
    const li = document.createElement('div');
    li.className  = 'tree-item';
    li.dataset.name = name;
    li.dataset.kind = kind;
    li.setAttribute('role', 'option');
    if (state.selected && state.selected.name === name) li.classList.add('selected');

    const nameEl = document.createElement('span');
    nameEl.className   = 'item-name';
    nameEl.textContent = name;

    li.appendChild(nameEl);
    li.appendChild(makeBadge(name, kind));
    li.addEventListener('click', () => selectItem(name, kind));
    frag.appendChild(li);
  });

  container.innerHTML = '';
  container.appendChild(frag);
}

function makeBadge(name, kind) {
  const span = document.createElement('span');
  span.className = 'badge';
  if (kind === 'entity') {
    span.className += ' badge-entity';
    span.textContent = 'Entity';
  } else if (kind === 'pset') {
    span.className += ' badge-pset';
    span.textContent = 'Pset';
  } else {
    const t = state.schema && state.schema.types[name];
    if (!t) { span.className += ' badge-defined'; span.textContent = 'Type'; return span; }
    if (t.k === 'E') { span.className += ' badge-enum';    span.textContent = 'Enum'; }
    else if (t.k === 'S') { span.className += ' badge-select';  span.textContent = 'Select'; }
    else                   { span.className += ' badge-defined'; span.textContent = 'Defined'; }
  }
  return span;
}

// ── selection ───────────────────────────────────────────────────────────────

function selectItem(name, kind, skipHash) {
  // Auto-enable filter if this kind is currently hidden
  let filterChanged = false;
  if (kind === 'entity' && !state.showEntities) {
    state.showEntities = true;
    const cb = document.getElementById('show-entities');
    if (cb) cb.checked = true;
    filterChanged = true;
  }
  if (kind === 'type' && !state.showTypes) {
    state.showTypes = true;
    const cb = document.getElementById('show-types');
    if (cb) cb.checked = true;
    filterChanged = true;
  }
  if (kind === 'pset' && !state.showPsets) {
    state.showPsets = true;
    const cb = document.getElementById('show-psets');
    if (cb) cb.checked = true;
    filterChanged = true;
  }

  state.selected = { name, kind };

  if (filterChanged) {
    renderTree();
  } else {
    // Update selected class without full re-render
    document.querySelectorAll('#tree .tree-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.name === name);
    });
  }

  // Scroll item into view
  const el = document.querySelector(`#tree .tree-item[data-name="${CSS.escape(name)}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });

  if (!skipHash) location.hash = `${state.schemaKey}/${name}`;
  renderDetail(name, kind);
}

// ── detail ──────────────────────────────────────────────────────────────────

function renderDetail(name, kind) {
  const panel = document.getElementById('detail-content');
  if (!name) {
    panel.innerHTML = '<p class="placeholder">Select an entity or type from the list.</p>';
    return;
  }
  if (kind === 'entity') {
    panel.innerHTML = renderEntity(name);
  } else if (kind === 'pset') {
    panel.innerHTML = renderPset(name);
  } else {
    panel.innerHTML = renderType(name);
  }
  // Wire internal links
  panel.querySelectorAll('a[data-nav]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const target = a.dataset.nav;
      let k = 'type';
      if (state.schema.entities[target]) k = 'entity';
      else if (state.schema.psets && state.schema.psets[target]) k = 'pset';
      selectItem(target, k);
    });
  });
}

function navLink(name) {
  const exists = state.schema && (state.schema.entities[name] || state.schema.types[name]);
  if (!exists) return esc(name);
  return `<a href="#" data-nav="${esc(name)}">${esc(name)}</a>`;
}

function renderEntity(name) {
  const e = state.schema.entities[name];
  if (!e) return '<p class="placeholder">Not found.</p>';

  const chain = resolveInheritanceChain(name);
  const meta  = SCHEMA_META[state.schemaKey];

  let html = '';

  // Header
  html += `<div class="detail-header">`;
  html += `<h1>${esc(name)}</h1>`;
  if (e.abs) html += `<span class="badge badge-abstract">Abstract</span>`;
  html += `<span class="badge badge-entity">Entity</span>`;
  html += `</div>`;

  // Sub-header: doc links
  html += `<div class="detail-subheader">`;
  html += `<div class="ext-links">${buildDocLinks(name, meta)}</div>`;
  html += `</div>`;

  // Breadcrumb (inheritance chain)
  if (chain.length > 1) {
    html += `<div class="breadcrumb">`;
    chain.forEach((n, i) => {
      if (i > 0) html += `<span class="sep" aria-hidden="true">/</span>`;
      if (n === name) {
        html += `<span class="current">${esc(n)}</span>`;
      } else {
        html += `<a href="#" data-nav="${esc(n)}">${esc(n)}</a>`;
      }
    });
    html += `</div>`;
  }

  // Subtypes
  const subs = e.subs || [];
  if (subs.length) {
    html += `<div class="section-header">Subtypes (${subs.length})</div>`;
    html += `<div class="subtype-list">`;
    subs.slice().sort().forEach(s => { html += `<a href="#" data-nav="${esc(s)}">${esc(s)}</a>`; });
    html += `</div>`;
  }

  // Own attributes
  const attrs = e.a || [];
  html += `<div class="section-header">Attributes${attrs.length ? ` (${attrs.length})` : ''}</div>`;
  if (attrs.length) {
    html += attrTable(attrs);
  } else {
    html += `<p class="empty-note">No own attributes.</p>`;
  }

  // Inherited attributes
  const inherited = collectInherited(name);
  if (inherited.length) {
    const total = inherited.reduce((s, g) => s + g.attrs.length, 0);
    html += `<details><summary>Inherited attributes (${total})</summary>`;
    inherited.forEach(({ from, attrs: ia }) => {
      html += `<div class="inherited-group">`;
      html += `<div class="from-label">From <a href="#" data-nav="${esc(from)}">${esc(from)}</a></div>`;
      html += attrTable(ia);
      html += `</div>`;
    });
    html += `</details>`;
  }

  // INVERSE
  const inv = e.inv || [];
  if (inv.length) {
    html += `<div class="section-header">Inverse</div>`;
    html += `<table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody>`;
    inv.forEach(r => {
      html += `<tr><td>${esc(r.n)}</td><td class="type-cell">${linkifyType(r.t)}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  // DERIVE
  const der = e.der || [];
  if (der.length) {
    html += `<div class="section-header">Derived</div>`;
    html += `<table><thead><tr><th>Name</th><th>Expression</th></tr></thead><tbody>`;
    der.forEach(r => {
      html += `<tr><td>${esc(r.n)}</td><td class="type-cell">${esc(r.t)}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  // WHERE
  const whr = e.whr || [];
  if (whr.length) {
    html += `<div class="section-header">Where Rules</div>`;
    html += `<div class="rule-list">`;
    whr.forEach(r => {
      html += `<div class="rule-item"><span class="rule-name">${esc(r.n)}</span><pre class="rule-expr">${esc(r.e)}</pre></div>`;
    });
    html += `</div>`;
  }

  // UNIQUE
  const unq = e.unq || [];
  if (unq.length) {
    html += `<div class="section-header">Unique</div>`;
    html += `<div class="rule-list">`;
    unq.forEach(r => {
      html += `<div class="rule-item"><span class="rule-name">${esc(r.n)}</span><pre class="rule-expr">${esc(r.e)}</pre></div>`;
    });
    html += `</div>`;
  }

  return html;
}

function renderType(name) {
  const t = state.schema.types[name];
  if (!t) return '<p class="placeholder">Not found.</p>';

  const meta  = SCHEMA_META[state.schemaKey];
  let html = '';

  const kindLabel = t.k === 'E' ? 'Enumeration' : t.k === 'S' ? 'Select' : 'Defined Type';
  const badgeClass = t.k === 'E' ? 'badge-enum' : t.k === 'S' ? 'badge-select' : 'badge-defined';

  html += `<div class="detail-header">`;
  html += `<h1>${esc(name)}</h1>`;
  html += `<span class="badge ${badgeClass}">${kindLabel}</span>`;
  html += `</div>`;
  html += `<div class="detail-subheader"><div class="ext-links">${buildDocLinks(name, meta)}</div></div>`;

  if (t.k === 'E') {
    html += `<div class="section-header">Values (${t.v.length})</div>`;
    html += `<div class="enum-values">`;
    t.v.forEach(v => { html += `<span class="enum-val">${esc(v)}</span>`; });
    html += `</div>`;
  } else if (t.k === 'S') {
    html += `<div class="section-header">Members (${t.v.length})</div>`;
    html += `<div class="select-members">`;
    t.v.forEach(v => {
      const exists = state.schema.entities[v] || state.schema.types[v];
      if (exists) html += `<a href="#" data-nav="${esc(v)}">${esc(v)}</a>`;
      else        html += `<span>${esc(v)}</span>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="section-header">Base Type</div>`;
    html += `<p class="defined-base">${linkifyType(t.b || '')}</p>`;
    if (t.whr && t.whr.length) {
      html += `<div class="section-header">Where Rules</div><div class="rule-list">`;
      t.whr.forEach(r => {
        html += `<div class="rule-item"><span class="rule-name">${esc(r.n)}</span><pre class="rule-expr">${esc(r.e)}</pre></div>`;
      });
      html += `</div>`;
    }
  }

  return html;
}

function renderPset(name) {
  const ps = state.schema.psets && state.schema.psets[name];
  if (!ps) return '<p class="placeholder">Not found.</p>';

  let html = '';

  const meta = SCHEMA_META[state.schemaKey];
  html += `<div class="detail-header">`;
  html += `<h1>${esc(name)}</h1>`;
  html += `<span class="badge badge-pset">Pset</span>`;
  html += `</div>`;

  const psetLinks = buildDocLinks(name, meta);
  if (psetLinks) html += `<div class="detail-subheader"><div class="ext-links">${psetLinks}</div></div>`;

  if (ps.d) {
    html += `<div class="govuk-inset-text">${esc(ps.d)}</div>`;
  }

  if (ps.cls && ps.cls.length) {
    html += `<div class="section-header">Applicable Classes</div>`;
    html += `<div class="subtype-list">`;
    ps.cls.forEach(c => { html += navLink(c); });
    html += `</div>`;
  }

  if (ps.p && ps.p.length) {
    html += `<div class="section-header">Properties (${ps.p.length})</div>`;
    html += `<table><thead><tr><th>Name</th><th>Type</th><th>Definition</th></tr></thead><tbody>`;
    ps.p.forEach(p => {
      html += `<tr>
        <td class="pset-prop-name">${esc(p.n)}</td>
        <td class="type-cell">${esc(p.t)}</td>
        <td class="pset-prop-desc">${esc(p.d)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  return html;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function resolveInheritanceChain(name) {
  const chain   = [];
  const visited = new Set();
  let current   = name;
  while (current && !visited.has(current)) {
    visited.add(current);
    chain.unshift(current);
    const e = state.schema.entities[current];
    current = e && e.sup ? e.sup : null;
  }
  return chain;
}

function collectInherited(name) {
  const chain = resolveInheritanceChain(name);
  const groups = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const ancestor = chain[i];
    const e = state.schema.entities[ancestor];
    if (e && e.a && e.a.length) {
      groups.push({ from: ancestor, attrs: e.a });
    }
  }
  return groups.reverse(); // closest parent first
}

function attrTable(attrs) {
  let html = `<table><thead><tr><th>Name</th><th>Optional</th><th>Type</th></tr></thead><tbody>`;
  attrs.forEach(a => {
    html += `<tr>
      <td>${esc(a.n)}</td>
      <td class="opt">${a.o ? '✓' : ''}</td>
      <td class="type-cell">${linkifyType(a.t)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function linkifyType(typeStr) {
  if (!typeStr) return '';
  // Replace IFC type names with links where they exist in the schema
  return esc(typeStr).replace(/Ifc[A-Za-z0-9]+/g, match => {
    const raw = match; // already escaped — no unescaping needed for Ifc names (no special chars)
    if (state.schema && (state.schema.entities[raw] || state.schema.types[raw])) {
      return `<a href="#" data-nav="${raw}">${raw}</a>`;
    }
    return raw;
  });
}

function buildDocLinks(name, meta) {
  let html = '';
  if (meta.htmlBase) {
    const docUrl = meta.htmlBase
      .replace('{lower}', name.toLowerCase())
      .replace('{orig}',  name);
    html += `<a href="${docUrl}" target="_blank" rel="noopener">Docs ↗</a>`;
  }
  return html;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ── bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', initApp);
