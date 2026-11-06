// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* THE LOADS' PART TYPES — each load is an occurrence of a BIM part, and the part's IFC type
   is the stored twin GET <BIM API>/parts/<maker>/<model>.ifc (DATABASE.server.BIM). The editor
   reads its facts (powerRollup.js partFacts: power, heat, weight, connector words) for the
   roll-ups, and embeds the type itself in the saved .ifc (ifc/powerToIfc.js). The API is
   same-origin /api/bim unless the page sets window.APK_BIM_API. A part that does not answer
   stays unknown: its load is still written, as a USERDEFINED appliance naming the part. */

import { partFacts } from './powerRollup.js';

export const bimApi = () => String(globalThis.APK_BIM_API || '/api/bim').replace(/\/$/, '');

/** The URL of a part's .ifc type (ids are <maker>/<model>, lower-case words and dashes). */
export function partIfcUrl(pid, base = bimApi()) {
  const [maker, model] = String(pid).split('/');
  return `${base}/parts/${encodeURIComponent(maker)}/${encodeURIComponent(model)}.ifc`;
}

/** Every part id a block's loads (and their kit components) name. */
export function partIdsOf(model) {
  const out = new Set();
  for (const l of model.loads ?? []) {
    if (l.part) out.add(l.part);
    for (const c of l.parts ?? []) if (c.part) out.add(c.part);
  }
  return [...out].sort();
}

/**
 * Fetch the .ifc types the model's loads need (cached in `cache`, a Map pid → text | null),
 * set each part's facts on the model. → {types: {pid: text}, missing: [pid]}.
 */
export async function loadPartTypes(model, cache, { fetchFn = globalThis.fetch, base = bimApi() } = {}) {
  const missing = [];
  for (const pid of partIdsOf(model)) {
    if (!cache.has(pid)) {
      let text = null;
      try {
        const r = await fetchFn(partIfcUrl(pid, base), { headers: { Accept: 'model/step, application/x-step' } });
        if (r.ok) text = await r.text();
      } catch (_) { text = null; }
      cache.set(pid, text && text.startsWith('ISO-10303-21') ? text : null);
    }
    const text = cache.get(pid);
    if (!text) { missing.push(pid); continue; } // facts already known (an opened .ifc's own types) stay
    try { model.setPartFacts(pid, partFacts(text, pid)); } catch (_) { missing.push(pid); }
  }
  const types = {};
  for (const [pid, text] of cache) if (text) types[pid] = text;
  return { types, missing };
}
