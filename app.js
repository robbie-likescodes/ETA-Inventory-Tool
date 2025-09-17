/*************** FIXED CONNECTION (update if you redeploy) ***************/
const BASE_URL = "https://script.google.com/macros/s/AKfycbzRiTdCtzOiVnBT9nXjfqAZqt_ptiWfSZGA0oR70KxzB4boTPatUlySbi-ttU1yX3Xfyg/exec"; // Apps Script /exec
const API_KEY  = "thebluedogisfat"; // must match Settings!API_KEY
/***********************************************************************/

/* ---------------- Local storage helpers ---------------- */
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};
const K = {
  pin: 'inv.pin',
  tech: 'inv.tech',
  company: 'inv.company', // Category in Sheets; keep key for compat
  queue: 'inv.queue',
  parts: 'inv.parts',
  cats:  'inv.cats',
  locs: 'inv.locs',
};

const el = (id) => document.getElementById(id);
const gv = (id) => (el(id)?.value || '').trim(); // safe getter for values

/* ---------------- Toast ---------------- */
function ensureToastHost(){
  let t = document.querySelector('.toast');
  if (!t){
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  return t;
}
function toast(msg, ms=2200){
  const t = ensureToastHost();
  t.textContent = msg;
  t.classList.add('show');
  window.clearTimeout(t._hide);
  t._hide = setTimeout(()=> t.classList.remove('show'), ms);
}

/* ---------------- Network chip ---------------- */
function setNet() { el('net').textContent = navigator.onLine ? 'online' : 'offline'; }
window.addEventListener('online', () => { setNet(); flushQueue(); });
window.addEventListener('offline', setNet);

/* ---------------- API helpers ---------------- */
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

/* ---------------- Queue for offline reliability ---------------- */
function qAll() { return LS.get(K.queue, []); }
function qPush(p) { const q = qAll(); q.push(p); LS.set(K.queue, q); }
function qSet(items) { LS.set(K.queue, items); }
async function flushQueue() {
  const q = qAll();
  if (!q.length || !navigator.onLine) return;
  el('sync') && (el('sync').textContent = 'Sync: flushing…');
  const keep = [];
  for (const item of q) {
    try { await apiPOST(item); } catch { keep.push(item); }
  }
  qSet(keep);
  el('sync') && (el('sync').textContent = keep.length ? `Sync: retrying (${keep.length})` : 'Sync: idle');
}

/* ---------------- Auth ---------------- */
function isAuthed() { return !!LS.get(K.pin, null); }
async function login(pin) {
  await apiPOST({ kind: 'login', pin }); // Backend checks Settings!LOGIN_PIN
  LS.set(K.pin, pin);
  return true;
}

/* ---------------- Lists (no direct DOM writes) ---------------- */
async function loadLocs() {
  try {
    const j = await apiGET('locs');
    LS.set(K.locs, j.locs || []);
  } catch {
    LS.set(K.locs, ['Office','Shop','CrashBox','Van1','Van2','Van3','Van4']);
  }
}
async function loadParts() {
  try {
    const j = await apiGET('parts'); // Code.gs returns [{PartID, Category?}] or [{PartID}]
    const ids = (j.parts || []).map(p => p.PartID);
    LS.set(K.parts, ids);
  } catch { /* fine if none yet */ }
  const ids = LS.get(K.parts, []);
  const dl = el('partsList');
  if (dl) dl.innerHTML = ids.map(id => `<option value="${id}">`).join('');
}
async function loadCats() {
  try {
    const j = await apiGET('cats'); // {cats:[...]}
    LS.set(K.cats, j.cats || []);
  } catch { /* ignore */ }
  const cats = LS.get(K.cats, []);
  const dl = el('catsList');
  if (dl) dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
}
async function autoCat(partId){
  if (!partId) return '';
  try{
    const j = await apiGET('autoCat', { partId });
    return j.category || '';
  }catch{ return ''; }
}

/* ---------------- UI helpers ---------------- */
function locOptionsHtml() {
  const locs = LS.get(K.locs, []);
  return [
    '<option value="" disabled>Select location…</option>',
    '<option value="N/A">N/A</option>',
    ...locs.map(l => `<option value="${l}">${l}</option>`)
  ].join('');
}
function actionSelectHtml(val='used'){
  const label = { used:'Use', received:'Receive', moved:'Move' };
  const opts = ['used','received','moved']
    .map(a=>`<option value="${a}" ${a===val?'selected':''}>${label[a]}</option>`).join('');
  return `<select data-field="action">${opts}</select>`;
}
function categoryInputHtml() {
  return `<input data-field="company" list="catsList" placeholder="Category (e.g. BUNN)"/>`;
}
function bulkRowHtml(){
  return `
    <tr>
      <td style="padding:6px">
        <input data-field="partId" list="partsList" placeholder="PartID"/>
      </td>
      <td style="padding:6px">${categoryInputHtml()}</td>
      <td style="padding:6px">${actionSelectHtml()}</td>
      <td style="padding:6px"><select data-field="fromLoc">${locOptionsHtml()}</select></td>
      <td style="padding:6px"><select data-field="toLoc">${locOptionsHtml()}</select></td>
      <td class="qty" style="padding:6px;text-align:right">
        <input data-field="qty" type="number" min="0.01" step="0.01" style="width:110px;text-align:right"/>
      </td>
      <td style="padding:6px"><button type="button" data-action="remove">✕</button></td>
    </tr>`;
}

// Enforce Use/Receive/Move per row (To=N/A for used, From=N/A for received)
function enforceRowAction(tr){
  const action = tr.querySelector('[data-field="action"]')?.value || 'used';
  const fromSel = tr.querySelector('[data-field="fromLoc"]');
  const toSel   = tr.querySelector('[data-field="toLoc"]');
  if (!fromSel || !toSel) return;

  if (action === 'used') {
    if (!fromSel.value || fromSel.value === 'N/A') fromSel.value = '';
    toSel.value = 'N/A';
    toSel.disabled = true;
    fromSel.disabled = false;
  } else if (action === 'received') {
    if (!toSel.value || toSel.value === 'N/A') toSel.value = '';
    fromSel.value = 'N/A';
    fromSel.disabled = true;
    toSel.disabled = false;
  } else { // moved
    if (toSel.value === 'N/A') toSel.value = '';
    if (fromSel.value === 'N/A') fromSel.value = '';
    fromSel.disabled = false;
    toSel.disabled = false;
  }
}

/* ---------------- Count Mode (uses row.locations from backend) ---------------- */
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

/* ---------------- Recent list ---------------- */
function prependRecent(text) {
  const li = document.createElement('li');
  li.textContent = text;
  el('recent')?.prepend(li);
}

/* ---------------- History (list + edit/void) ---------------- */
async function loadTechs(){
  const sel = el('historyTech');
  if (!sel) return;
  sel.disabled = true;
  sel.innerHTML = '<option value="">(loading…)</option>';
  try{
    const j = await apiGET('techs');
    let techs = j.techs || [];
    const me = gv('tech');
    if (me && !techs.includes(me)) techs = [me, ...techs];
    sel.innerHTML = techs.length
      ? techs.map(t=>`<option>${t}</option>`).join('')
      : '<option value="">(no records yet)</option>';
    sel.selectedIndex = 0;
  }catch{
    sel.innerHTML = '<option value="">(load failed)</option>';
  }finally{
    sel.disabled = false;
    sel.focus();
  }
}
function renderHistory(items){
  if (!el('historyList')) return;
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
    const extra = [it.company || it.category, it.jobCode].filter(Boolean).join(' • ');
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

/* ---------------- Boot ---------------- */
window.addEventListener('DOMContentLoaded', async () => {
  setNet();

  // Login gate
  if (isAuthed()) {
    el('gate')?.classList.add('hidden');
    el('app')?.classList.remove('hidden');
  }
  el('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (el('loginMsg')) el('loginMsg').textContent = '';
    const pin = gv('pin');
    try {
      await login(pin);
      el('gate')?.classList.add('hidden');
      el('app')?.classList.remove('hidden');
    } catch (err) {
      if (el('loginMsg')) el('loginMsg').textContent = 'Incorrect PIN or server error.';
    }
  });

  // Remember tech & default Category (company)
  const techInput = el('tech');
  const compInput = el('company'); // "Category (optional)" at top Tools row
  if (techInput) techInput.value = LS.get(K.tech, '');
  if (compInput) compInput.value = LS.get(K.company, '');
  techInput?.addEventListener('change', () => LS.set(K.tech, gv('tech')));
  compInput?.addEventListener('change', () => LS.set(K.company, gv('company')));

  // Load lists
  await loadLocs();
  await loadParts();
  await loadCats();

  // Seed one empty bulk row by default
  el('bulkTable')?.querySelector('tbody')?.insertAdjacentHTML('beforeend', bulkRowHtml());
  Array.from(el('bulkTable')?.querySelectorAll('tbody tr') || []).forEach(enforceRowAction);

  // === Bulk behaviors ===
  el('bulkAdd')?.addEventListener('click', ()=>{
    const tb = el('bulkTable')?.querySelector('tbody');
    if (!tb) return;
    tb.insertAdjacentHTML('beforeend', bulkRowHtml());
    const tr = el('bulkTable').querySelector('tbody tr:last-child');
    enforceRowAction(tr);
  });

  // Per-row logic
  el('bulkTable')?.addEventListener('change', async (e)=>{
    const tr = e.target.closest('tr');
    if (!tr) return;

    // Action toggle
    if (e.target.matches('[data-field="action"]')){
      enforceRowAction(tr);
      return;
    }

    // Auto-fill Category when a PartID is chosen
    if (e.target.matches('[data-field="partId"]')){
      const partId = (e.target.value || '').trim();
      const rowCat = tr.querySelector('[data-field="company"]');
      if (partId && rowCat && !rowCat.value){
        const cat = await autoCat(partId);
        if (cat) rowCat.value = cat;
        if (compInput && !compInput.value && cat) {
          compInput.value = cat;
          LS.set(K.company, cat);
        }
      }
      if (rowCat && !rowCat.value && compInput && compInput.value){
        rowCat.value = compInput.value;
      }
    }
  });

  el('bulkTable')?.addEventListener('click', (e)=>{
    if (e.target.dataset.action==='remove'){
      const tr = e.target.closest('tr'); if (tr) tr.remove();
    }
  });

  // Submit All — idempotent via unique requestId per line + UI guard
  let submitting = false;
  const btnSubmit = el('bulkSubmit');
  btnSubmit?.addEventListener('click', async ()=>{
    if (submitting) return;
    const tech = gv('tech');
    if (!tech){ alert('Technician is required.'); return; }

    const rows = Array.from(el('bulkTable')?.querySelectorAll('tbody tr') || []);
    if (!rows.length){ alert('Add at least one line.'); return; }

    const defaultCat = gv('company');
    const jobCode = gv('jobCode');
    const note = gv('note');

    const items = rows.map(tr=>{
      const get = name => { const n = tr.querySelector(`[data-field="${name}"]`); return n ? n.value : ''; };
      const action = get('action') || 'used';
      let fromLoc = get('fromLoc');
      let toLoc   = get('toLoc');
      const company = (get('company') || defaultCat).trim();

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
        company,
        tech,
        action,
        partId: (get('partId')||'').trim(),
        qty: String(parseFloat(get('qty')||'0')||0),
        fromLoc, toLoc,
        jobCode,
        note,
        requestId: (crypto.randomUUID ? crypto.randomUUID() : 'r-'+Date.now()+Math.random().toString(16).slice(2))
      };
    }).filter(it => it.company && it.partId && parseFloat(it.qty)>0);

    if (!items.length){ alert('Each row needs Category, PartID and Qty.'); return; }

    for (const it of items){
      if (it.action==='used'    && !it.fromLoc){ alert(`Row ${it.partId}: select FROM location.`); return; }
      if (it.action==='received'&& !it.toLoc){   alert(`Row ${it.partId}: select TO location.`);   return; }
      if (it.action==='moved'   && (!it.fromLoc || !it.toLoc)){ alert(`Row ${it.partId}: select BOTH From and To.`); return; }
    }

    submitting = true;
    if (btnSubmit) btnSubmit.disabled = true;
    try{
      await apiPOST({ kind:'batch', items: JSON.stringify(items) });
      items.forEach(it => prependRecent(`${it.company}: ${it.tech} ${it.action} ${it.qty} × ${it.partId} (${it.fromLoc||'—'}→${it.toLoc||'—'})`));
      // reset form
      const tb = el('bulkTable')?.querySelector('tbody');
      if (tb){
        tb.innerHTML = '';
        tb.insertAdjacentHTML('beforeend', bulkRowHtml());
        enforceRowAction(el('bulkTable').querySelector('tbody tr:last-child'));
      }
      if (el('note')) el('note').value = '';
      toast('Parts submitted successfully');
      await flushQueue();
      await loadParts();
      await loadCats();
    }catch(e){
      alert('Bulk submit failed: '+e.message);
    }finally{
      submitting = false;
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  // === Count Mode ===
  el('btnCount')?.addEventListener('click', async ()=>{
    let company = gv('company');
    let partId = gv('partId');
    if (!partId){
      const p = prompt('Enter PartID to count:','');
      partId = p ? p.trim() : '';
    }
    if (!partId){ alert('PartID required.'); return; }
    if (!company){
      company = await autoCat(partId);
      if (company) {
        if (el('company')) el('company').value = company;
        LS.set(K.company, company);
      }
    }
    if (!company) { alert('Category required.'); return; }

    try {
      const j = await apiGET('part', { company, partId });
      el('countMeta') && (el('countMeta').textContent = `${company} — ${partId}`);
      renderCountTable(j.row || {});
      el('countPanel')?.classList.remove('hidden');
    } catch (e) { alert('Could not load part row: ' + e.message); }
  });
  el('btnCloseCount')?.addEventListener('click', ()=> el('countPanel')?.classList.add('hidden'));

  el('btnSaveCounts')?.addEventListener('click', async ()=>{
    const company = gv('company');
    const partId  = gv('partId');
    const tech    = gv('tech');
    if (!company || !partId || !tech) { alert('Category, PartID, Tech required.'); return; }
    const inputs = Array.from(el('countTable')?.querySelectorAll('input[data-loc]') || []);
    const rows = inputs.map(inp => ({ locId: inp.dataset.loc, qty: Number(inp.value || 0) }));
    const payload = { kind:'count', company, tech, partId, counts: JSON.stringify(rows), note: gv('note'), jobCode: gv('jobCode') };
    try {
      await apiPOST(payload);
      prependRecent(`${tech} counted ${partId} (${company})`);
      toast('Counts saved');
      el('countPanel')?.classList.add('hidden');
    } catch (e) { alert('Save failed: ' + e.message); }
  });

  // === Backorder (prompt mini-form + toast) ===
  el('btnBackorder')?.addEventListener('click', async ()=>{
    let partId = gv('partId');
    if (!partId){
      const p = prompt('PartID to backorder:','');
      partId = p ? p.trim() : '';
    }
    if (!partId){ alert('PartID required.'); return; }

    let company = gv('company');
    if (!company){ company = await autoCat(partId); }
    if (!company){
      const c = prompt('Category (e.g. BUNN):','');
      company = c ? c.trim() : '';
    }
    if (!company){ alert('Category required.'); return; }

    const qtyPrompt = prompt('Backorder quantity?','1');
    if (qtyPrompt === null) return;
    const qtyStr = qtyPrompt.trim();
    if (!qtyStr) return;
    const exp = prompt('Expected date? (optional YYYY-MM-DD)');
    const expected = exp ? String(Date.parse(exp)) : '';

    const payload = {
      kind: 'backorder',
      company,
      partId,
      qty: String(parseFloat(qtyStr) || 0),
      requestedBy: gv('tech'),
      expectedDate: expected,
      note: gv('note'),
      requestId: (crypto.randomUUID ? crypto.randomUUID() : 'bo-' + Date.now()),
    };
    try {
      await apiPOST(payload);
      prependRecent(`backorder ${payload.qty} × ${payload.partId} (${company})`);
      toast('Backorder submitted');
    } catch (e) { alert('Backorder failed: ' + e.message); }
  });

  // === History panel (tech/company/part filters) ===
  el('btnHistory')?.addEventListener('click', async ()=>{
    if (el('historyCompany')) el('historyCompany').value = gv('company');
    await loadTechs();
    el('historyPanel')?.classList.remove('hidden');
  });
  el('historyClose')?.addEventListener('click', ()=> el('historyPanel')?.classList.add('hidden'));
  el('historyLoad')?.addEventListener('click', async ()=>{
    const tech = gv('historyTech');
    if (!tech){ alert('Pick a technician'); return; }
    const params = {
      tech,
      company: gv('historyCompany'),
      partId:  gv('historyPart'),
      limit:   String(parseInt(gv('historyLimit') || '100'))
    };
    try{
      // Flexible route available in Code.gs as historySearch; keeping simple tech route:
      const j = await apiGET('history', params);
      renderHistory(j.items||[]);
    }catch(e){
      alert('Failed to load history: '+e.message);
    }
  });

  // History edit/void with confirmations
  el('historyList')?.addEventListener('click', async (e)=>{
    const editId = e.target.dataset.edit;
    const voidId = e.target.dataset.void;
    if (!editId && !voidId) return;

    const li = e.target.closest('li');
    const whenStr = li ? (li.querySelector('strong')?.textContent || '') : '';

    if (voidId){
      if (!confirmDelete(whenStr)) return;
      try{
        await apiPOST({ kind:'void', requestId: voidId, tech: gv('tech') });
        toast('Submission voided');
        el('historyLoad')?.click();
      }catch(err){ alert('Delete failed: '+err.message); }
      return;
    }

    if (editId){
      if (!confirmChange(whenStr)) return;
      const a = prompt('Action (used, received, moved):','used');
      const action = a ? a.trim() : '';
      if (!action) return;
      let fromLoc = '', toLoc = '';
      if (action==='used'){
        const f = prompt('From location (required):',''); fromLoc = f ? f.trim() : '';
        toLoc = 'N/A';
      } else if (action==='received'){
        fromLoc = 'N/A';
        const t = prompt('To location (required):',''); toLoc = t ? t.trim() : '';
      } else {
        const f = prompt('From location (required):',''); fromLoc = f ? f.trim() : '';
        const t = prompt('To location (required):','');   toLoc   = t ? t.trim() : '';
      }
      const q = prompt('Quantity:', '1'); if (q === null) return;
      const qty = q.trim();
      const n = prompt('Note (optional):','');
      const note = n ? n.trim() : '';

      try{
        await apiPOST({ kind:'edit',
          requestId: editId,
          tech: gv('tech'),
          action, fromLoc, toLoc, qty, note, jobCode: gv('jobCode')
        });
        toast('Submission corrected');
        el('historyLoad')?.click();
      }catch(err){ alert('Edit failed: '+err.message); }
    }
  });
});
