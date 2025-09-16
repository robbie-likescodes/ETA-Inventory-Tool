/*************** FIXED CONNECTION (update if you redeploy) ***************/
const BASE_URL = "https://script.google.com/macros/s/AKfycbzelyqp4WX9dNp6e1b2iM9d2jCgwyvubsQjqV0F9azYNj8GOBt0A3fXCCUKtVYP7zCC1g/exec"; // Apps Script /exec
const API_KEY  = "thebluedogisfat"; // must match Settings!API_KEY
/***********************************************************************/

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
  await apiPOST({ kind: 'login', pin }); // Backend checks Settings!LOGIN_PIN
  LS.set(K.pin, pin);
  return true;
}

// Load locations & parts
async function loadLocs() {
  try {
    const j = await apiGET('locs');
    LS.set(K.locs, j.locs || []);
  } catch {
    LS.set(K.locs, ['Office', 'Shop', 'CrashBox', 'Van1', 'Van2', 'Van3', 'Van4']);
  }
}
async function loadParts() {
  try {
    const j = await apiGET('parts'); // {parts:[{PartID}]}
    const ids = (j.parts || []).map(p => p.PartID);
    LS.set(K.parts, ids);
  } catch { /* fine if none yet */ }
  const ids = LS.get(K.parts, []);
  const dl = el('partsList');
  if (dl) dl.innerHTML = ids.map(id => `<option value="${id}">`).join('');
}

// Helpers for selects
function locOptionsHtml() {
  const locs = LS.get(K.locs, []);
  return [
    '<option value="" disabled>Select location…</option>',
    '<option value="N/A">N/A</option>',
    ...locs.map(l => `<option value="${l}">${l}</option>`)
  ].join('');
}
function actionSelectHtml(val='used'){
  const opts = ['used','received','moved']
    .map(a=>`<option value="${a}" ${a===val?'selected':''}>${a}</option>`).join('');
  return `<select data-field="action">${opts}</select>`;
}
function bulkRowHtml(){
  return `
    <tr>
      <td style="padding:6px">
        <input data-field="partId" list="partsList" placeholder="PartID"/>
      </td>
      <td style="padding:6px">${actionSelectHtml()}</td>
      <td style="padding:6px"><select data-field="fromLoc">${locOptionsHtml()}</select></td>
      <td style="padding:6px"><select data-field="toLoc">${locOptionsHtml()}</select></td>
      <td style="padding:6px;text-align:right">
        <input data-field="qty" type="number" min="0.01" step="0.01" style="width:110px;text-align:right"/>
      </td>
      <td style="padding:6px"><button type="button" data-action="remove">✕</button></td>
    </tr>`;
}

// Enforce Used/Received/Moved per row (To=N/A for used, From=N/A for received)
function enforceRowAction(tr){
  const action = tr.querySelector('[data-field="action"]').value;
  const fromSel = tr.querySelector('[data-field="fromLoc"]');
  const toSel   = tr.querySelector('[data-field="toLoc"]');

  if (action === 'used') {
    // From required; To = N/A & disabled
    if (!fromSel.value || fromSel.value === 'N/A') fromSel.value = '';
    toSel.value = 'N/A';
    toSel.disabled = true;
    fromSel.disabled = false;
  } else if (action === 'received') {
    // To required; From = N/A & disabled
    if (!toSel.value || toSel.value === 'N/A') toSel.value = '';
    fromSel.value = 'N/A';
    fromSel.disabled = true;
    toSel.disabled = false;
  } else { // moved
    // Both required; none disabled
    if (toSel.value === 'N/A') toSel.value = '';
    if (fromSel.value === 'N/A') fromSel.value = '';
    fromSel.disabled = false;
    toSel.disabled = false;
  }
}

// Count mode rendering (uses row.locations from backend)
function renderCountTable(row) {
  const locs = LS.get(K.locs, []);
  const hasMap = row && row.locations && typeof row.locations === 'object';

  const rows = locs.map(l=>{
    const cur = hasMap ? Number(row.locations[l]||0) : 0;
    return `
      <tr>
        <td style="padding:8px">${l}</td>
        <td style="padding:8px;text-align:right">${cur}</td>
        <td style="padding:8px;text-align:right">
          <input data-loc="${l}" type="number" step="1" value="${cur}"
            style="width:120px;text-align:right;background:#111;color:#eee;border:1px solid #333;border-radius:8px;padding:6px"/>
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

// --- History helpers (list + edit/void) ---
async function loadTechs(){
  const sel = el('historyTech');
  sel.disabled = true;
  sel.innerHTML = '<option value="">(loading…)</option>';
  try{
    const j = await apiGET('techs');
    let techs = j.techs || [];
    const me = (el('tech').value||'').trim();
    if (me && !techs.includes(me)) techs = [me, ...techs];
    if (!techs.length) {
      sel.innerHTML = '<option value="">(no records yet)</option>';
    } else {
      sel.innerHTML = techs.map(t=>`<option>${t}</option>`).join('');
      sel.selectedIndex = 0;
    }
  }catch{
    sel.innerHTML = '<option value="">(load failed)</option>';
  }finally{
    sel.disabled = false;
    sel.focus();
  }
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
      it.action==='count'    ? `count Δ=${it.qty} ${it.partId}` :
      it.action==='backorder'? `BO ${it.qty} ${it.partId}` : `${it.qty} ${it.partId}`;
    const extra = [it.company, it.jobCode].filter(Boolean).join(' • ');
    const note = it.note ? ` — ${it.note}` : '';
    const canEdit = !['count','backorder'].includes(String(it.action||''));
    const buttons = canEdit
      ? `<button type="button" data-edit="${it.requestId}" class="small">Edit</button>
         <button type="button" data-void="${it.requestId}" class="small">Delete</button>`
      : `<span class="muted small">(locked)</span>`;
    return `<li data-id="${it.requestId}">
      <strong>${when}</strong> — ${move} <span class="muted small">${extra}</span>${note}
      <div class="inline" style="margin-top:4px;gap:6px">${buttons}</div>
    </li>`;
  }).join('');
  el('historyList').innerHTML = `<ul id="recent">${rows}</ul>`;
}
function confirmChange(whenStr){
  return confirm(`This was completed on ${whenStr || 'this date'}. Are you sure you want to change your submission?`);
}
function confirmDelete(whenStr){
  return confirm(`This was completed on ${whenStr || 'this date'}. Are you sure you want to delete (void) this submission?`);
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

  // Seed one empty bulk row by default
  el('bulkTable').querySelector('tbody').insertAdjacentHTML('beforeend', bulkRowHtml());
  Array.from(el('bulkTable').querySelectorAll('tbody tr')).forEach(enforceRowAction);

  // === Bulk behaviors ===
  el('bulkAdd').addEventListener('click', ()=>{
    el('bulkTable').querySelector('tbody').insertAdjacentHTML('beforeend', bulkRowHtml());
    const tr = el('bulkTable').querySelector('tbody tr:last-child');
    enforceRowAction(tr);
  });

  el('bulkTable').addEventListener('change', (e)=>{
    const tr = e.target.closest('tr');
    if (!tr) return;
    if (e.target.matches('[data-field="action"]')){
      enforceRowAction(tr);
    }
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
      let fromLoc = get('fromLoc');
      let toLoc   = get('toLoc');

      if (action === 'used'){
        if (!fromLoc || fromLoc === 'N/A'){ fromLoc = ''; }
        toLoc = 'N/A';
      } else if (action === 'received'){
        if (!toLoc || toLoc === 'N/A'){ toLoc = ''; }
        fromLoc = 'N/A';
      } else {
        if (fromLoc === 'N/A') fromLoc = '';
        if (toLoc === 'N/A')   toLoc   = '';
      }

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

    // Validate action-specific requirements
    for (const it of items){
      if (it.action==='used'    && !it.fromLoc){ alert(`Row with ${it.partId}: select FROM location.`); return; }
      if (it.action==='received'&& !it.toLoc){   alert(`Row with ${it.partId}: select TO location.`);   return; }
      if (it.action==='moved'   && (!it.fromLoc || !it.toLoc)){ alert(`Row with ${it.partId}: select BOTH From and To.`); return; }
    }

    try{
      await apiPOST({ kind:'batch', items: JSON.stringify(items) });
      items.forEach(it => prependRecent(`${tech} ${it.action} ${it.qty} × ${it.partId} (${it.fromLoc||'—'}→${it.toLoc||'—'})`));
      el('bulkTable').querySelector('tbody').innerHTML = '';
      el('bulkTable').querySelector('tbody').insertAdjacentHTML('beforeend', bulkRowHtml());
      enforceRowAction(el('bulkTable').querySelector('tbody tr:last-child'));
      await flushQueue();
      await loadParts(); // refresh suggestions if new IDs were created
    }catch(e){
      alert('Bulk submit failed: '+e.message);
    }
  });

  // === Count Mode ===
  el('btnCount').addEventListener('click', async ()=>{
    const company = el('company').value.trim();
    const partId  = el('partId').value.trim();
    if (!company || !partId) { alert('Enter Company and PartID first.'); return; }
    try {
      const j = await apiGET('part', { company, partId });
      el('countMeta').textContent = `${company} — ${partId}`;
      renderCountTable(j.row || {});
      el('countPanel').classList.remove('hidden');
    } catch (e) { alert('Could not load part row: ' + e.message); }
  });
  el('btnCloseCount').addEventListener('click', ()=> el('countPanel').classList.add('hidden'));

  el('btnSaveCounts').addEventListener('click', async ()=>{
    const company = el('company').value.trim();
    const partId  = el('partId').value.trim();
    const tech    = el('tech').value.trim();
    if (!company || !partId || !tech) { alert('Company, PartID, Tech required.'); return; }
    const inputs = Array.from(el('countTable').querySelectorAll('input[data-loc]'));
    const rows = inputs.map(inp => ({ locId: inp.dataset.loc, qty: Number(inp.value || 0) }));
    const payload = { kind:'count', company, tech, partId, counts: JSON.stringify(rows), note: el('note').value.trim(), jobCode: el('jobCode').value.trim() };
    try {
      await apiPOST(payload);
      prependRecent(`${tech} counted ${partId}`);
      el('countPanel').classList.add('hidden');
    } catch (e) { alert('Save failed: ' + e.message); }
  });

  // === Backorder ===
  el('btnBackorder').addEventListener('click', async ()=>{
    const partId = el('partId').value.trim();
    if (!partId){ alert('Enter a PartID first.'); return; }
    const qty = prompt('Backorder quantity?'); if (!qty) return;
    const expected = prompt('Expected date? (optional YYYY-MM-DD)');
    const payload = {
      kind: 'backorder',
      company: el('company').value.trim(),
      partId,
      qty: String(parseFloat(qty) || 0),
      requestedBy: el('tech').value.trim(),
      expectedDate: expected ? String(Date.parse(expected)) : '',
      note: el('note').value.trim(),
      requestId: (crypto.randomUUID ? crypto.randomUUID() : 'bo-' + Date.now()),
    };
    try {
      await apiPOST(payload);
      prependRecent(`backorder ${payload.qty} × ${payload.partId}`);
    } catch (e) { alert('Backorder failed: ' + e.message); }
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

  // History edit/void with confirmations
  el('historyList').addEventListener('click', async (e)=>{
    const editId = e.target.dataset.edit;
    const voidId = e.target.dataset.void;
    if (!editId && !voidId) return;

    // Get displayed timestamp for confirm text
    const li = e.target.closest('li');
    const whenStr = li ? (li.querySelector('strong')?.textContent || '') : '';

    if (voidId){
      if (!confirmDelete(whenStr)) return;
      try{
        await apiPOST({ kind:'void', requestId: voidId, tech: el('tech').value.trim() });
        alert('Submission voided and inventory restored.');
        el('historyLoad').click();
      }catch(err){ alert('Delete failed: '+err.message); }
      return;
    }

    if (editId){
      if (!confirmChange(whenStr)) return;
      const action = prompt('Action (used, received, moved):','used'); if (!action) return;
      let fromLoc = '', toLoc = '';
      if (action==='used'){
        fromLoc = prompt('From location (required):','');
        toLoc = 'N/A';
      } else if (action==='received'){
        fromLoc = 'N/A';
        toLoc = prompt('To location (required):','');
      } else {
        fromLoc = prompt('From location (required):','');
        toLoc   = prompt('To location (required):','');
      }
      const qty = prompt('Quantity:', '1'); if (!qty) return;
      const note = prompt('Note (optional):','');

      try{
        await apiPOST({ kind:'edit',
          requestId: editId,
          tech: el('tech').value.trim(),
          action, fromLoc, toLoc, qty, note, jobCode: el('jobCode').value.trim()
        });
        alert('Submission corrected and inventory updated.');
        el('historyLoad').click();
      }catch(err){ alert('Edit failed: '+err.message); }
    }
  });
});
