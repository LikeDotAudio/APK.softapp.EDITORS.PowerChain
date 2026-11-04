// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* softappLink.js — this editor on the one softapp client (ROAD-3490).

   Blocks go in and out over cad.like.audio/host@1 through
   vendor/apk-softapp/apk-softapp.js (window.APKSoftapp): same origin only,
   never '*', a .json download only when there is no CAD around the page.
   "Discovered" is what the bus knows (APKSoftapp.discovered), keyed by MAC /
   serial, alive or dead, never a guessed URL. Pure enough for node: S is the
   APKSoftapp handle, so the tests hand it a stub window's copy. */

/**
 * Link a model to the CAD.
 *   S         window.APKSoftapp
 *   Model     class with new Model(block) and .toJSON()
 *   getModel  () => the current model
 *   setModel  (model, meta) => take a loaded model (and render)
 *   filename  (model) => the download / block file name
 */
export function linkBlock(S, { editor, blockType, Model, getModel, setModel, filename, notice }) {
  const name = (m) => String(filename ? filename(m) : '') || blockType;
  const host = S.connectHost({
    editor,
    blockType,
    block: getModel().toJSON(),
    notice,
    onLoad: (block, meta) => setModel(new Model(block), meta || {}),
    onRequest: () => ({ block: getModel().toJSON(), meta: { filename: name(getModel()) } }),
  });
  return {
    host,
    /** after an edit: toCad.blockChanged (nothing standalone) */
    changed: () => host.changed(getModel().toJSON()),
    /** Save: toCad.blockSave in the CAD ('host'), a download standalone ('download') */
    save: () => host.save(getModel().toJSON(), { filename: name(getModel()) }),
    close: () => host.close(),
    /** a block opened from a local file: the same path a CAD load takes */
    openLocal: (block, meta = {}) => setModel(new Model(block), meta),
  };
}

/** A discovered thing as a table row: identity is MAC, else serial, else agent — never an IP. */
export function discoveredRow(t) {
  const live = t.live || {};
  return {
    id: t.mac || t.serial || t.agent || t.id || '',
    name: t.name || '',
    mac: t.mac || '',
    serial: t.serial || '',
    vendor: [t.vendor, t.model].filter(Boolean).join(' '),
    protocols: (t.protocols || []).join(', '),
    ips: (t.ips || []).join(', '),
    state: live.state || 'dead',
    why: live.why || '',
  };
}

export function discoveredRows(things) {
  return (things || []).map(discoveredRow);
}

export const DISCOVERED_COLUMNS = [
  { key: 'state', label: 'State', editable: false },
  { key: 'name', label: 'Name', editable: false },
  { key: 'mac', label: 'MAC', editable: false, mono: true },
  { key: 'serial', label: 'Serial', editable: false, mono: true },
  { key: 'vendor', label: 'Vendor / model', editable: false },
  { key: 'protocols', label: 'Seen by', editable: false },
  { key: 'ips', label: 'IP (not identity)', editable: false, mono: true },
  { key: 'why', label: 'Why', editable: false },
];

/** The kinds to show: a tunable in config/discovered.json, never a list in source. */
export async function loadDiscoveredConfig(url = './config/discovered.json') {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { kinds: [] };
    const c = await r.json();
    return { kinds: Array.isArray(c.kinds) ? c.kinds.map(String) : [] };
  } catch (_) {
    return { kinds: [] };
  }
}

/**
 * The Discovered button: toggles #discovered-panel, an APKTable of what the
 * bus knows, with each thing's live state and why. Says on screen when there
 * is no SDK, no bus or no broker.
 */
export function mountDiscovered(S, T, { button, panel, status, tableHost, tableId }) {
  if (!button || !panel) return;
  let handle = null;
  let table = null;
  const stateCell = (v) => {
    const el = document.createElement('span');
    el.textContent = v;
    el.setAttribute('data-apk-state', v);
    return el;
  };
  const columns = DISCOVERED_COLUMNS.map((c) => (c.key === 'state' ? { ...c, render: stateCell } : c));
  const show = (things) => {
    const rows = discoveredRows(things);
    if (table) table.setRows(rows);
    if (status) status.textContent = `${rows.length} thing(s) on the bus; trust decays after ${S.TRUST_MINUTES || 5} min unverified.`;
  };
  button.addEventListener('click', async () => {
    panel.hidden = !panel.hidden;
    if (panel.hidden || handle) return;
    if (T && tableHost && !table) {
      table = T.create(tableHost, { id: tableId, columns, rows: [], empty: 'Nothing discovered yet.' });
    }
    if (status) status.textContent = 'Asking the bus…';
    const config = await loadDiscoveredConfig();
    handle = await S.discovered({ kinds: config.kinds, onChange: show });
    if (!handle.ok) {
      if (status) status.textContent = handle.reason;
      handle = null;
      return;
    }
    show(handle.things());
  });
}
