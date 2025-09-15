/*************** CONFIG (edit API key; base is your deployed URL) ***************/
const DEFAULT_BASE = "https://script.google.com/macros/s/AKfycbzYUDoESRUzfbXWErt7uk021OwZK3LzUCL9sEFkbc39HRDz8Qce4218v-WleoS1nroiKw/exec";
const DEFAULT_API_KEY = "YOUR_API_KEY_HERE"; // <- put your Settings!API_KEY value here once
/*******************************************************************************/

// Local storage helpers
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};

const K = {
  base: 'inv.base',
  key: 'inv.key',
  pin: 'inv.pin',
  tech: 'inv.tech',
  company: 'inv.company',
  queue: 'inv.queue',
  parts: 'inv.parts',
  locs: 'inv.locs',
};

// Shorthands
const $ = (s) => document.querySelector(s);
const el = (id) => document.getElementById(id);

// Network chip
function setNet() { el('net').textContent = navigator.onLine ? 'online' : 'offline'; }
window.addEventListener('online', () => { setNet(); flushQueue(); });
window.addEventListener('offline', setNet);

// API helpers
function base() { return (el('baseUrl').value || DEFAULT_BASE).trim(); }
function apiKey() { return (el('apiKey').value || DEFAULT_API_KEY).trim(); }

async function apiGET(route, params = {}) {
  const qs = new URLSearchParams({ route, ...params }).toString();
  const r = await fetch(`${base()}?${qs}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'GET failed');
  return j;
}
async function apiPOST(body) {
  const res = await fetch(base(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'POST failed');
  return j;
}

// Queue for offline reliability
function qAll() { return LS.get(K.queue, []); }
function qPush(p) { const q = qAll(); q.push(p); LS.set(K.queue, q); }
function qSet(items) { LS.set(K.queue, items); }
async function flushQueue() {
  const q = qAll();
  if (!q.length || !navigator.onLine) return;
  el('sync').textContent = 'Sync: flushing…';
  const keep = [];
  for (const item of q) {
    try { await apiPOST(item); } catch (e) { keep.push(item); }
  }
  qSet(keep);
  el('sync').textContent = keep.length ? `Sync: retrying (${keep.length})` : 'Sync: idle';
}

// Login
function isAuthed() { return !!LS.get(K.pin, null); }
async function login(pin) {
  await apiPOST({ api_key: apiKey(), kind: 'login', pin });
  LS.set(K.pin, pin);
  return true;
}

// Load locations & parts
async function loadLocs() {
  try {
    const j = await apiGET('locs');
    LS.set(K.locs, j.locs || []);
  } catch {
    // fallback fixed list
    LS.set(K.locs, ['Office', 'Shop', 'CrashBox', 'Van1', 'Van2', 'Van3', 'Van4']);
  }
  const locs = LS.get(K.locs, []);
  el('fromLoc').innerHTML = locs.map(l => `<option>${l}</option>`).join('');
  el('toLoc').innerHTML = locs.map(l => `<option>${l}</option>`).join('');
}
async function loadParts() {
  try {
    const j = await apiGET('parts'); // {parts:[{PartID}]}
    const ids = (j.parts || []).map(p => p.PartID);
    LS.set(K.parts, ids);
  } catch {
    // ignore if none yet
  }
  const ids = LS.get(K.parts, []);
  el('partsList').innerHTML = ids.map(id => `<option value="${id}">`).join('');
}

// Count mode rendering
function renderCountTable(row) {
  const locs = LS.get(K.locs, []);
  const cells = {
    Qty_Office: Number(row?.Qty_Office || 0),
    Qty_Shop: Number(row?.Qty_Shop || 0),
    Qty_CrashBox: Number(row?.Qty_CrashBox || 0),
    Qty_Van1: Number(row?.Qty_Van1 || 0),
    Qty_Van2: Number(row?.Qty_Van2 || 0),
    Qty_Van3: Number(row?.Qty_Van3 || 0),
    Qty_Van4: Number(row?.Qty_Van4 || 0),
  };
  const keyFor = (l) => {
    const n = l.toLowerCase();
    if (n === 'office') return 'Qty_Office';
    if (n === 'shop') return 'Qty_Shop';
    if (n === 'crashbox' || n === 'crash box') return 'Qty_CrashBox';
    if (n === 'van1' || n === 'van 1') return 'Qty_Van1';
    if (n === 'van2' || n === 'van 2') return 'Qty_Van2';
    if (n === 'van3' || n === 'van 3') return 'Qty_Van3';
    if (n === 'van4' || n === 'van 4') return 'Qty_Van4';
    return null;
  };
  const rows = locs.map(l => {
    const k = keyFor(l);
    const cur = k ? Number(cells[k] || 0) : 0;
    return `
      <tr>
        <td style="padding:8px">${l}</td>
        <td style="padding:8px;text-align:right">${cur}</td>
        <td style="padding:8px;text-align:right">
          <input data-loc="${l}" type="number" step="1" value="${cur}"
            style="width:110px;text-align:right;background:#111;color:#eee;border:1px solid #333;border-radius:8px;padding:6px"/>
        </td>
      </tr>`;
  }).join('');
  el('countTable').innerHTML =
    `<thead><tr><th style="text-align:left;padding:8px">Location</th><th style="text-align:right;padding:8px">Current</th><th style="text-align:right;padding:8px">New</th></tr></thead><tbody>${rows}</tbody>`;
}

// Recent list
function prependRecent(text) {
  const li = document.createElement('li');
  li.textContent = text;
  el('recent').prepend(li);
}

// Boot
window.addEventListener('DOMContentLoaded', async () => {
  // Load/save connection config
  el('baseUrl').value = LS.get(K.base, DEFAULT_BASE);
  el('apiKey').value = LS.get(K.key, DEFAULT_API_KEY);
  el('baseUrl').addEventListener('change', () => LS.set(K.base, el('baseUrl').value.trim()));
  el('apiKey').addEventListener('change', () => LS.set(K.key, el('apiKey').value.trim()));
  el('btnTest').addEventListener('click', async () => {
    try { const j = await apiGET('health'); alert('OK: ' + new Date(j.ts).toLocaleString()); }
    catch (e) { alert('Health check failed: ' + e.message); }
  });

  setNet();

  // Login gate
  if (isAuthed()) {
    el('gate').classList.add('hidden');
    el('app').classList.remove('hidden');
  }
  el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('loginMsg').textContent = '';
    try {
      await login(el('pin').value.trim());
      el('gate').classList.add('hidden');
      el('app').classList.remove('hidden');
    } catch (err) {
      el('loginMsg').textContent = 'Incorrect PIN or server error.';
    }
  });

  // Remember tech & company
  el('tech').value = LS.get(K.tech, '');
  el('company').value = LS.get(K.company, '');
  el('tech').addEventListener('change', () => LS.set(K.tech, el('tech').value.trim()));
  el('company').addEventListener('change', () => LS.set(K.company, el('company').value.trim()));

  // Load lists
  await loadLocs();
  await loadParts();

  // Action visibility
  const vis = () => {
    const a = el('action').value;
    el('fromLoc').parentElement.parentElement.style.display = (a === 'used' || a === 'moved') ? 'block' : 'none';
    el('toLoc').parentElement.parentElement.style.display = (a === 'received' || a === 'moved') ? 'block' : 'none';
  };
  el('action').addEventListener('change', vis); vis();

  // Submit movement
  el('btnSubmit').addEventListener('click', async () => {
    const payload = {
      api_key: apiKey(),
      kind: 'movement',
      company: el('company').value.trim(),
      tech: el('tech').value.trim(),
      action: el('action').value,              // used | received | moved
      partId: el('partId').value.trim(),
      qty: String(parseFloat(el('qty').value) || 0),
      fromLoc: el('action').value !== 'received' ? el('fromLoc').value : '',
      toLoc:   el('action').value !== 'used'     ? el('toLoc').value   : '',
      jobCode: el('jobCode').value.trim(),
      note: el('note').value.trim(),
      requestId: (crypto.randomUUID ? crypto.randomUUID() : 'r-' + Date.now()),
    };
    if (!payload.company || !payload.tech || !payload.partId || !(parseFloat(payload.qty) > 0)) {
      alert('Fill Company, Tech, PartID, Quantity.'); return;
    }
    // enqueue then flush
    qPush(payload);
    prependRecent(`${payload.tech} ${payload.action} ${payload.qty} × ${payload.partId} (${payload.fromLoc || '—'}→${payload.toLoc || '—'})`);
    await flushQueue();
    // light reset
    el('qty').value = '';
    el('note').value = '';
  });

  // Backorder
  el('btnBackorder').addEventListener('click', async () => {
    const qty = prompt('Backorder quantity?'); if (!qty) return;
    const expected = prompt('Expected date? (optional YYYY-MM-DD)');
    const payload = {
      api_key: apiKey(),
      kind: 'backorder',
      company: el('company').value.trim(),
      partId: el('partId').value.trim(),
      qty: String(parseFloat(qty) || 0),
      requestedBy: el('tech').value.trim(),
      expectedDate: expected ? String(Date.parse(expected)) : '',
      note: el('note').value.trim(),
      requestId: (crypto.randomUUID ? crypto.randomUUID() : 'bo-' + Date.now()),
    };
    if (!payload.company || !payload.partId || !(parseFloat(payload.qty) > 0)) {
      alert('Pick a PartID and quantity.'); return;
    }
    qPush(payload);
    prependRecent(`backorder ${payload.qty} × ${payload.partId}`);
    await flushQueue();
  });

  // Count mode open/close
  el('btnCount').addEventListener('click', async () => {
    const company = el('company').value.trim();
    const partId = el('partId').value.trim();
    if (!company || !partId) { alert('Enter Company and PartID first.'); return; }
    try {
      const j = await apiGET('part', { company, partId }); // returns {row}
      el('countMeta').textContent = `${company} — ${partId}`;
      renderCountTable(j.row || {});
      el('countPanel').classList.remove('hidden');
    } catch (e) { alert('Could not load part row: ' + e.message); }
  });
  el('btnCloseCount').addEventListener('click', () => el('countPanel').classList.add('hidden'));

  // Save counts (absolute)
  el('btnSaveCounts').addEventListener('click', async () => {
    const company = el('company').value.trim();
    const partId = el('partId').value.trim();
    const tech = el('tech').value.trim();
    if (!company || !partId || !tech) { alert('Company, PartID, Tech required.'); return; }
    const inputs = Array.from(el('countTable').querySelectorAll('input[data-loc]'));
    const rows = inputs.map(inp => ({ locId: inp.dataset.loc, qty: Number(inp.value || 0) }));
    const payload = {
      api_key: apiKey(),
      kind: 'count',
      company, tech, partId,
      counts: JSON.stringify(rows),
      note: el('note').value.trim(),
      jobCode: el('jobCode').value.trim(),
    };
    try {
      await apiPOST(payload);
      prependRecent(`${tech} counted ${partId}`);
      el('countPanel').classList.add('hidden');
    } catch (e) { alert('Save failed: ' + e.message); }
  });
});

