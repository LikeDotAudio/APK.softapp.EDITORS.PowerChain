// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* 📚 THE BIM LIBRARY, CALLED UP HERE (ROAD-3572). The owner, 2026-11-06: "anytime there
   is a drawing or placing or adding … we should be able to call up the library", and
   "when the library is called it should return the BIM and the BIM reference". The BIM
   part is the top level: this editor keeps no device list and takes no typed make/model.

   The picker is DATABASE.server.BIM's (ROAD-3575, contract apk.bim.library@1):
   APKLibrary.pick({filter, multiple}) → [{bim, ref}], cancel rejects (AbortError
   'cancelled'). It is loaded from the copy published with the OS — /APK%3AOS/… on :8080,
   the gateway and apk.audio alike, a root path, never a relative climb out of this
   repository — which calls up the live library on this host when there is one and the
   snapshot otherwise; elsewhere (a site with no OS) from apk.audio. A page with its own
   config point names its own with setPickerUrls(). What is placed keeps `bimId` (the
   part) and `bimRef` ({part, url, rev}, the BIM reference). The same script carries
   liveDevices / defaultGuiFor / openDefaultGui (the bench's boxes of a part).
   Picking a project's unplaced instances waits for ROAD-3581.

   The same file in every editor that adds a device; change them together. (Here it is
   bimLibraryPicker.js: this editor's bimLibrary.js is its BIM part client.) */

export const PICKER_URLS = ['/APK%3AOS/system/bim/library/picker.js',
  'https://apk.audio/APK%3AOS/system/bim/library/picker.js'];
let pickerUrls = PICKER_URLS;
/** Where this page loads the picker from, in order (a host's config point). */
export function setPickerUrls(urls) { if (Array.isArray(urls) && urls.length) pickerUrls = urls.slice(); }
export const BIM_MIME = 'application/x-apk-bim';
export const SHORTCUT = 'Ctrl+Shift+L';

let loading = null;

function loadScript(src, doc) {
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = new URL(src, doc.baseURI).href;
    s.async = true;
    s.dataset.apkLibrary = '';
    s.onload = () => (globalThis.APKLibrary ? resolve(globalThis.APKLibrary) : reject(new Error(`${src} set no APKLibrary`)));
    s.onerror = () => { s.remove(); reject(new Error(`${src} did not load`)); };
    doc.head.append(s);
  });
}

/** window.APKLibrary, loading the picker the first time. */
export function loadLibrary({ doc = globalThis.document, urls = pickerUrls } = {}) {
  if (globalThis.APKLibrary) return Promise.resolve(globalThis.APKLibrary);
  if (!loading) {
    loading = urls.reduce((p, url) => p.catch(() => loadScript(url, doc)), Promise.reject(new Error('no picker')))
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

/** The BIM reference as an element keeps it: {part, url, rev}, plus globalId once ROAD-3579 fills it. */
export function bimRefOf(item) {
  const ref = item && item.ref;
  if (!ref || !ref.part) return null;
  const out = { part: String(ref.part), url: String(ref.url || ''), rev: String(ref.rev || '') };
  if (ref.globalId) out.globalId = String(ref.globalId);
  return out;
}

/** {bimId, bimRef} for an element made from a pick or a drop. */
export function bimFields(item) {
  const ref = bimRefOf(item);
  return { bimId: (item && item.bim && item.bim.id) || (ref && ref.part) || '', bimRef: ref };
}

/** Open the library; → the items picked, [] when it was closed without one. */
export async function pickFromLibrary(opts = {}) {
  const lib = await loadLibrary();
  try {
    return await lib.pick(opts);
  } catch (err) {
    if (err && (err.code === 'cancelled' || err.name === 'AbortError')) return [];
    throw err;
  }
}

/** Is this the library shortcut (Ctrl/⌘+Shift+L)? */
export function isLibraryShortcut(e) {
  return !!e && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'l';
}

/**
 * The 📚 Library button: a click — or Ctrl/⌘+Shift+L anywhere on the page — opens the
 * library and hands each picked {bim, ref} to onItems(items). → the button.
 */
export function libraryButton(onItems, { doc = globalThis.document, label = '📚 Library', title = 'Add from the BIM library',
  className = '', filter, multiple = false, shortcut = true } = {}) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = className;
  b.dataset.apkLibrary = '';
  b.textContent = label;
  b.title = `${title} (${SHORTCUT})`;
  const go = async () => {
    b.disabled = true;
    try {
      const items = await pickFromLibrary({ filter, multiple, title });
      if (items.length) onItems(items);
    } catch (err) {
      b.title = `${title} — the library did not open: ${(err && err.message) || err}`;
      b.dataset.apkState = 'dead';
    } finally { b.disabled = false; }
  };
  b.addEventListener('click', go);
  if (shortcut) {
    // one shortcut per button on the page: a button drawn again (an inspector re-render) drops its old listener
    let seen = false;
    const onKey = (e) => {
      if (!b.isConnected) { if (seen) doc.removeEventListener('keydown', onKey); return; }
      seen = true;
      if (isLibraryShortcut(e)) { e.preventDefault(); go(); }
    };
    doc.addEventListener('keydown', onKey);
  }
  return b;
}

/** {bim, ref} carried by a drop of the picker's drag source, or null. */
export function readLibraryDrop(e) {
  const dt = e && e.dataTransfer;
  if (!dt) return null;
  try {
    const v = JSON.parse(dt.getData(BIM_MIME));
    return v && v.bim && v.bim.id && v.ref && v.ref.part ? v : null;
  } catch (_) { return null; }
}

/** Let `el` take parts dragged from the library: onItem({bim, ref}, event). → undo. */
export function acceptLibraryDrops(el, onItem) {
  const has = (e) => !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], BIM_MIME) >= 0);
  const over = (e) => { if (has(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
  const drop = (e) => { const it = has(e) && readLibraryDrop(e); if (it) { e.preventDefault(); onItem(it, e); } };
  el.addEventListener('dragover', over);
  el.addEventListener('drop', drop);
  return () => { el.removeEventListener('dragover', over); el.removeEventListener('drop', drop); };
}
