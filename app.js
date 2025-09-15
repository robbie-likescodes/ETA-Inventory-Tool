/*************** FIXED CONNECTION (no UI fields) ***************/
const BASE_URL = "https://script.google.com/macros/s/AKfycbzYUDoESRUzfbXWErt7uk021OwZK3LzUCL9sEFkbc39HRDz8Qce4218v-WleoS1nroiKw/exec"; // Apps Script Web App URL (/exec)
const API_KEY  = "thebluedogisfat"; // must match Settings!API_KEY
/****************************************************************/

// Local storage helpers
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};

const K = {
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
async function apiGET(route, params = {}) {
  const qs = new URLSearchParams({ route, ...params }).toString();
  const r = await fetch(`${BASE_URL}?${qs}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'GET failed');
  return j;
}
async function apiPOST(body) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api_key: API_KEY, ...body }),
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
  await apiPOST({ kind: 'login', pin });  // Backend checks against Settings!LOGIN_PIN
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
  const opts = ['<option value="" selected disabled>Select location…</option>']
    .concat(locs.map(l => `<option>${l}</option>`))
    .join('');
  el('fromLoc').innerHTML = opts;
  el('toLoc').innerHTML   = opts;
}

async function loadParts() {
  try {
    const j = await apiGET('parts'); // {parts:[{PartID}]}
    const ids = (j.parts || []).map(p => p.PartID);
    LS.set(K.parts, ids);
  } catch { /* ok if none yet */ }
  const ids = LS.get(K.parts, []);
  const dl = el('partsList');
  if (dl) dl.innerHTML = ids.map(id => `<option value="${id}">`).join('');
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

// === Multi-entry (bulk) helpers ===
function actionSelectHtml(val='used'){
  const opts = ['used','received','moved']
    .map(a=>`<option value="${a}" ${a===val?'selected':''}>${a}</option>`).join('');
  return `<select data-field="action">${opts}</select>`;
}
function locSelectHtml(attr){
  const locs = LS.get(K.locs, []);
  const opts = ['<option value="" selected disabled>Select location…</option>']
    .concat(locs.map(l => `<option value="${l}">${l}</option>`)).join('');
  return `<select data-field="${attr}">${opts}</select>`;
}
function bulkRowHtml(){
  return `
    <tr>
      <td style="padding:6px">
        <input data-field="partId" list="partsList" placeholder="PartID"/>
      </td>
      <td style="padding:6px">${actionSelectHtml()}</td>
      <td style="padding:6px">${locSelectHtml('fromLoc')}</td>
      <td style="padding:6px">${locSelectHtml('toLoc')}</td>
      <td style="padding:6px;text-align:right">
        <input data-field="qty" type="number" min="0.01" step="0.01" style="width:110px;text-align:right"/>
      </td>
      <td style="padding:6px">
        <button type="button" data-action="remove">✕</button>
      </td>
    </tr>`;
}

// === History helpers ===
async function loadTechs(){
  try{
    const j = await apiGET('techs'); // {techs:[]}
    const sel = el('historyTech');
    const techs = j.techs || [];
    const me = (el('tech').value||'').trim();
    const ordered = me && techs.includes(me) ? [me, ...techs.filter(t=>t!==me)] : techs;
    sel.innerHTML = ordered.map(t=>`<option>${t}</option>`).join('');
  }catch{/* ignore if none yet */}
}
function renderHistory(items){
  if (!items || !items.length){
    el('historyList').innerHTML = `<div class="muted small">No records.</div>`;
    return;
  }
  const rows = items.map(it=>{
    const when = it.ts ? new Date(it.ts).toLocaleString() : '';
    const move =
      it.action==='moved'    ? `${it.qty} ${it.partId} (${it.fromLoc||'—'}→${it.toLoc||'—'})` :
      it.action==='used'     ? `${it.qty} ${it.partId} (from ${it.fromLoc||'—'})` :
      it.action==='received' ? `${it.qty} ${it.partId} (to ${it.toLoc||'—'})` :
      it.action==='count'    ? `count Δ=${it.qty} ${it.partId} @ ${it.fromLoc||'loc'}` :
      it.action==='backorder'? `BO ${it.qty} ${it.partId}` : `${it.qty} ${it.partId}`;
    const extra = [it.company, it.jobCode].filter(Boolean).join(' • ');
    const note = it.note ? ` — ${it.note}` : '';
    return `<li><strong>${when}</strong> — ${move} <span class="muted small">${extra}</span>${note}</li>`;
  }).join('');
  el('historyList').innerHTML = `<ul id="recent">${rows}</ul>`;
}

// Boot
window.addEventListener('DOMContentLoaded', async () => {
  setNet();

  // Login gate
  if (isAuthed()) {
    el('gate').classList.add('hidden');
    el('app').classList.remove('hidden');
  }
  el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('loginMsg').textContent = '';
    const pin = el('pin').value.trim();
    try {
      await login(pin);
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

  // Action visibility + reset hidden fields
  const vis = () => {
    const a = el('action').value;
    const fromWrap = el('fromLoc').closest('label');
    const toWrap   = el('toLoc').closest('label');

    fromWrap.style.display = (a === 'used' || a === 'moved') ? 'block' : 'none';
    toWrap.style.display   = (a === 'received' || a === 'moved') ? 'block' : 'none';

    if (a === 'used')      el('toLoc').value = "";
    else if (a === 'received') el('fromLoc').value = "";
  };
  el('action').addEventListener('change', vis); vis();

  // Submit movement (with action-specific validation)
  el('btnSubmit').addEventListener('click', async () => {
    const action  = el('action').value;
    const fromLoc = el('fromLoc').value;
    const toLoc   = el('toLoc').value;

    const payload = {
      kind: 'movement',
      company: el('company').value.trim(),
      tech: el('tech').value.trim(),
      action,
      partId: el('partId').value.trim(),
      qty: String(parseFloat(el('qty').value) || 0),
      fromLoc: action !== 'received' ? fromLoc : '',
      toLoc:   action !== 'used'     ? toLoc   : '',
      jobCode: el('jobCode').value.trim(),
      note: el('note').value.trim(),
      requestId: (crypto.randomUUID ? crypto.randomUUID() : 'r-' + Date.now()),
    };

    if (!payload.company || !payload.tech || !payload.partId || !(parseFloat(payload.qty) > 0)) {
      alert('Fill Company, Tech, PartID, and Quantity.'); return;
    }
    if (action === 'used' && !fromLoc)     { alert('Select the location the part is being USED FROM.'); return; }
    if (action === 'received' && !toLoc)   { alert('Select the destination location to RECEIVE INTO.'); return; }
    if (action === 'moved' && (!fromLoc || !toLoc)) { alert('Select BOTH From and To locations for a Move.'); return; }

    qPush(payload);
    prependRecent(`${payload.tech} ${payload.action} ${payload.qty} × ${payload.partId} (${payload.fromLoc || '—'}→${payload.toLoc || '—'})`);
    await flushQueue();
    el('qty').value = '';
    el('note').value = '';
  });

  // Backorder
  el('btnBackorder').addEventListener('click', async () => {
    const qty = prompt('Backorder quantity?'); if (!qty) return;
    const expected = prompt('Expected date? (optional YYYY-MM-DD)');
    const payload = {
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
    const partId  = el('partId').value.trim();
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
    const partId  = el('partId').value.trim();
    const tech    = el('tech').value.trim();
    if (!company || !partId || !tech) { alert('Company, PartID, Tech required.'); return; }
    const inputs = Array.from(el('countTable').querySelectorAll('input[data-loc]'));
    const rows = inputs.map(inp => ({ locId: inp.dataset.loc, qty: Number(inp.value || 0) }));
    const payload = {
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

  // === Multi-entry (bulk) ===
  const bulkPanel = el('bulkPanel');
  el('btnBulk').addEventListener('click', ()=>{
    bulkPanel.classList.remove('hidden');
    if (!el('bulkTable').querySelector('tbody tr')) {
      el('bulkTable').querySelector('tbody').insertAdjacentHTML('beforeend', bulkRowHtml());
    }
  });
  el('bulkClose').addEventListener('click', ()=> bulkPanel.classList.add('hidden'));
  el('bulkAdd').addEventListener('click', ()=>{
    el('bulkTable').querySelector('tbody').insertAdjacentHTML('beforeend', bulkRowHtml());
  });
  el('bulkTable').addEventListener('click', (e)=>{
    if (e.target.dataset.action==='remove'){
      const tr = e.target.closest('tr'); if (tr) tr.remove();
    }
  });
  el('bulkSubmit').addEventListener('click', async ()=>{
    const company = el('company').value.trim();
    const tech    = el('tech').value.trim();
    if (!company || !tech){ alert('Company and Technician are required.'); return; }
    const rows = Array.from(el('bulkTable').querySelectorAll('tbody tr'));
    if (!rows.length){ alert('Add at least one line.'); return; }

    const items = rows.map(tr=>{
      const get = name => { const n = tr.querySelector(`[data-field="${name}"]`); return n ? n.value : ''; };
      const action = get('action') || 'used';
      const fromLoc = action!=='received' ? get('fromLoc') : '';
      const toLoc   = action!=='used'     ? get('toLoc')   : '';
      return {
        company, tech,
        action,
        partId: (get('partId')||'').trim(),
        qty: String(parseFloat(get('qty')||'0')||0),
        fromLoc, toLoc,
        jobCode: el('jobCode').value.trim(),
        note: el('note').value.trim(),
        requestId: (crypto.randomUUID ? crypto.randomUUID() : 'r-'+Date.now()+Math.random().toString(16).slice(2))
      };
    }).filter(it => it.partId && parseFloat(it.qty)>0);

    if (!items.length){ alert('Fill PartID and Qty on at least one line.'); return; }

    try{
      await apiPOST({ kind:'batch', items: JSON.stringify(items) }); // requires backend 'batch' route
      items.forEach(it => prependRecent(`${tech} ${it.action} ${it.qty} × ${it.partId} (${it.fromLoc||'—'}→${it.toLoc||'—'})`));
      el('bulkTable').querySelector('tbody').innerHTML = '';
      bulkPanel.classList.add('hidden');
      await loadParts(); // refresh parts in case new IDs were created
    }catch(e){
      alert('Bulk submit failed: '+e.message);
    }
  });

  // === History panel ===
  el('btnHistory').addEventListener('click', async ()=>{
    el('historyCompany').value = el('company').value;
    await loadTechs();
    el('historyPanel').classList.remove('hidden');
  });
  el('historyClose').addEventListener('click', ()=> el('historyPanel').classList.add('hidden'));
  el('historyLoad').addEventListener('click', async ()=>{
    const tech = el('historyTech').value;
    if (!tech){ alert('Pick a technician'); return; }
    const params = {
      tech,
      company: (el('historyCompany').value||'').trim(),
      partId:  (el('historyPart').value||'').trim(),
      limit:   String(parseInt(el('historyLimit').value||100))
    };
    try{
      const j = await apiGET('history', params);
      renderHistory(j.items||[]);
    }catch(e){
      alert('Failed to load history: '+e.message);
    }
  });
});
