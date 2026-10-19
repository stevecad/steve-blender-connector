'use strict';
const $ = (id) => document.getElementById(id);
let next = 0,
  context = {},
  actions = [],
  active = null,
  online = false;
const waiting = new Map();
const pendingEvents = new Map();
const terminal = new Set(['succeeded', 'failed', 'rejected', 'cancelled', 'expired']);
function call(method, params = {}) {
  const id = ++next;
  const promise = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  window.parent.postMessage({ steve: 1, id, method, params }, '*');
  return promise;
}
function allowed(name) {
  return actions.some((a) => a.name === name && a.allowed);
}
function buttons() {
  $('refresh').disabled = !!active || !allowed('status');
  $('save').disabled = !!active || !online || !allowed('save_copy');
  $('insert').disabled =
    !!active ||
    !online ||
    !context.document ||
    !['part', 'design'].includes(context.document.kind) ||
    !allowed('import_model');
}
function applyContext(c) {
  const changed =
    context.document?.id !== c.document?.id || context.document?.revision !== c.document?.revision;
  context = c;
  document.body.dataset.theme = c.theme || 'light';
  $('document').textContent = c.document
    ? `Open ${c.document.kind} · revision ${c.document.revision}`
    : 'Open a part or design in STEVE.';
  if (changed) {
    $('motion').value = '';
    $('result').textContent = '';
    $('import-summary').hidden = true;
  }
  buttons();
}
function showStatus(s) {
  online = s?.connected === true;
  $('connection').textContent = online ? 'Connected' : 'Offline';
  $('connection').className = 'badge' + (online ? ' online' : '');
  $('scene').textContent = online ? s.scene : 'Blender is offline';
  $('stats').textContent = online
    ? `${s.objects} objects · Blender ${s.version} · ${s.fps} fps`
    : 'Open Blender and start the Blender Lab MCP extension.';
  buttons();
}
function showImportResult(result) {
  if (!result.collection) return;
  const known = typeof result.animation_imported === 'boolean';
  $('import-collection').textContent = result.collection;
  $('import-motion').textContent = known
    ? result.animation_imported
      ? 'Motion imported'
      : 'Geometry only'
    : 'Motion status unavailable';
  $('import-motion').className = 'badge' + (result.animation_imported ? ' motion-imported' : '');
  $('import-detail').textContent =
    result.motion_summary ||
    (known
      ? 'This import did not report its motion source.'
      : 'This connector did not report whether motion was imported.');
  $('import-summary').hidden = false;
}
function showRun(run) {
  if (!active || active === 'pending' || active !== run.id) return;
  $('message').textContent =
    run.state === 'awaiting_confirmation'
      ? 'Waiting for you to confirm in STEVE'
      : run.error || run.message || run.state;
  $('progress').hidden = terminal.has(run.state);
  $('progress').value = run.progress || 0;
  if (terminal.has(run.state)) {
    active = null;
    if (run.result?.connected !== undefined) showStatus(run.result);
    if (run.result) $('result').textContent = JSON.stringify(run.result, null, 2);
    if (run.state === 'succeeded' && run.result) showImportResult(run.result);
  }
  buttons();
}
function start(name, inputs) {
  if (active) return;
  pendingEvents.clear();
  active = 'pending';
  buttons();
  $('message').textContent = 'Waiting for STEVE to prepare the document or request confirmation…';
  $('result').textContent = '';
  $('import-summary').hidden = true;
  // No await before run: the document is submitted in this click's activation.
  call('run', { action: name, inputs, note: 'Requested in the Blender panel' })
    .then((run) => {
      active = run.id;
      const buffered = pendingEvents.get(run.id);
      pendingEvents.clear();
      showRun(run);
      if (buffered && !terminal.has(run.state)) showRun(buffered);
    })
    .catch((e) => {
      pendingEvents.clear();
      active = null;
      $('message').textContent = e.message || String(e);
      buttons();
    });
}
window.addEventListener('message', (event) => {
  const m = event.data;
  if (event.source !== window.parent || !m || m.steve !== 1) return;
  if (m.id !== undefined && waiting.has(m.id)) {
    const p = waiting.get(m.id);
    waiting.delete(m.id);
    m.error ? p.reject(m.error) : p.resolve(m.result);
  } else if (m.event === 'context') applyContext(m.context);
  else if (m.event === 'event' && m.name === 'status') showStatus(m.data);
  else if (m.event === 'run') {
    if (active === 'pending' && m.run?.id) {
      // A delayed event from a previous run cannot identify this click's run.
      // Keep early updates until the run RPC returns its own ID.
      if (pendingEvents.size >= 20) pendingEvents.delete(pendingEvents.keys().next().value);
      pendingEvents.set(m.run.id, m.run);
    } else showRun(m.run);
  }
});
$('destination').addEventListener('change', () => {
  $('scene-name').disabled = $('destination').value !== 'new';
});
$('refresh').addEventListener('click', () => start('status', {}));
$('save').addEventListener('click', () => start('save_copy', {}));
$('insert').addEventListener('click', () => {
  if (!context.document) return;
  try {
    const inputs = {
      model: { document_id: context.document.id, revision: context.document.revision },
      destination: $('destination').value,
      start_frame: Number($('frame').value),
    };
    if ($('scene-name').value.trim()) inputs.scene_name = $('scene-name').value.trim();
    if ($('motion').value.trim()) {
      inputs.motion = JSON.parse($('motion').value);
      if (
        inputs.motion.document_id !== context.document.id ||
        inputs.motion.revision !== context.document.revision
      )
        throw new Error('Animation JSON belongs to a different document or revision.');
    }
    start('import_model', inputs);
  } catch (e) {
    $('message').textContent = e.message;
  }
});
(async () => {
  applyContext(await call('context'));
  for (const event of await call('events')) if (event.name === 'status') showStatus(event.data);
  actions = await call('actions');
  buttons();
  $('message').textContent = 'Ready. Choose a destination, then insert the open model.';
})().catch((e) => {
  $('message').textContent = e.message || String(e);
});
