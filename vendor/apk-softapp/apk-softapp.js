// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* apk-softapp.js — THE ONE CLIENT A SOFTAPP LOADS. window.APKSoftapp.

   One plain script (no build, no framework, no module) that gives a softapp the
   things every imported editor used to write for itself:

     connectHost()  the CAD block bridge — cad.like.audio/host@1, the block
                    messages (EDITORS.CAD.Like.audio contract/host@1/,
                    src/shell/hostBridge/blockHost.ts). Replaces every
                    js/blockBridge.js and its private APK_*_BLOCK messages.
     contracts()    window.APKContracts — topic builders, presence rule, tokens.
     bus()          window.APKBus.connect(), once per page.
     discovered()   the things the bus knows about (scanners, agents, presence),
                    merged by identity (MAC / serial, never IP), alive or dead.
     discoveredPanel()  the same, drawn: one APKTable, a live column, a
                    status line and a button per row (config/discovered.json).
     interfaces()   the Interface Map's Interfaces table (Gui/Interfaces/Map/…).
     describe()     its inputs, outputs and controls, drawn as a ? help panel.
     showProblem()  an error as what happened / why / do this, with Retry.
     fetchJson()    an input read that never throws and says what went wrong.

   Standalone-safe: no CAD around it, save() downloads a .json file and the
   page says so on screen; no APKContracts / APKBus / broker, discovered() and
   interfaces() resolve with `ok: false` and a reason to show — never a throw.

   ─────────────────────────────────────────────────────────────────────────
   LOAD (index.html, in this order — classic scripts, before your module):

     <script src="./vendor/apk-contracts/apk-contracts.global.js"></script>
     <script src="/FrontEnd/shared/apk-bus.js"></script>
     <script src="./vendor/apk-softapp/apk-softapp.js"></script>
     <link rel="stylesheet" href="./vendor/apk-table/apk-table.css">
     <script src="./vendor/apk-table/apk-table.js"></script>

   vendor/ copies are made, and held to this file, by
     python3 .apk.scripts/vendor_contract_web.py <app>/vendor/apk-contracts
     python3 .apk.scripts/vendor_shared_web.py   <app>/vendor/apk-softapp
     python3 .apk.scripts/vendor_shared_web.py   <app>/vendor/apk-table
   (drift lane: bash .apk.scripts/check.sh webshared). apk-bus.js is linked from
   /FrontEnd/shared/ and not vendored: it finds mqtt.js beside itself, and off
   the bench there is no broker to reach anyway.

   ─────────────────────────────────────────────────────────────────────────
   THE CAD BRIDGE

     const host = APKSoftapp.connectHost({
       editor: 'Rack Elevation Builder',      // shown in the CAD
       blockType: 'rack_elevation',
       onLoad(block, meta) { model.load(block); render(); },  // toEditor.load
       onRequest() { return model.toBlock(); },               // toEditor.request: what to save
       // notice: element | false   — where to say "in the CAD" / "standalone"
     });
     host.changed(model.toBlock());           // after an edit        (toCad.blockChanged)
     host.save(model.toBlock(), { filename: 'rack_a' })  // Save button (toCad.blockSave, or a download)
     host.close();                            // Close button         (toCad.editorClose)
     host.embedded                            // true inside the CAD's iframe

   connectHost() says `editorReady` at once (pass { autoReady: false } and call
   host.ready() yourself if onLoad cannot run yet). onRequest may return the
   block, { block, meta }, or nothing (host.block, the last loaded/saved, goes).
   Messages go to location.origin, never '*'; a message is taken only from
   window.parent at our own origin with protocol cad.like.audio/host@1.

   ─────────────────────────────────────────────────────────────────────────
   WHAT IS ON THE NETWORK

     const d = await APKSoftapp.discovered({
       kinds: ['switch'],                     // optional: substring of a thing's kinds
       onChange(things) { table.setRows(things.map(toRow)); },
     });
     if (!d.ok) status.textContent = d.reason;   // no SDK / no bus / no broker
     d.things()  → [{ id, mac, serial, name, ips, vendor, model, protocols,
                      kinds, fields: { <proto>: {field: text} }, agent,
                      live: { state: 'good'|'kinda'|'dead', why, at } }]
     d.stop()

   kinds of a thing: each protocol that saw it, the scanner's kind segment
   (Device/<kind>/<id>) and its device_class, lower-cased. Identity is the MAC,
   else the serial, else the agent's own name, else the sighting — never an IP.
   live follows the owner's rule: verified within trustMinutes (5) is good,
   older is kinda (never good), lost / failed / offline is dead. Re-judged every
   15 s even when the bus is quiet, so trust decays on screen. `collections`
   (default ['Device']) names the segment things are filed under, for a
   scanner that files more (PLUGIN.WIFI: every BSS heard is under Network/).

     const panel = await APKSoftapp.discoveredPanel(hostEl, {
       configUrl: './config/discovered.json',  // { kinds, collections } — or config: {…}, or kinds: [...]
       status: statusEl, id: 'my-discovered', pickLabel: 'Bind', onPick(thing) {},
     });
   draws it all (the editors' old js/discoveredPanel.js / discoveredTable.js);
   APKSoftapp.thingRow(t) is one row, discoveredConfig(url) the checked tunables.

   THE INTERFACES TABLE

     const t = await APKSoftapp.interfaces({ onChange(rows, headers) { … } });
     t.rows() → [{ interface, kind, family, domain, carries, in, out, on, why }]
   from the retained Gui/Interfaces/Map/Interfaces panel; { url } instead reads
   an Interfaces.json (OcaBin) file and takes its Interfaces block.

   ─────────────────────────────────────────────────────────────────────────
   A TABLE is APKTable (apk-table.js), never hand-built:

     APKTable.create(hostEl, { id: 'my-ports', columns: [{ key: 'name', label: 'Name' }, …],
                               rows, onEdit(row, key, value) {}, onDelete(i) {} });

   ─────────────────────────────────────────────────────────────────────────
   WHEN SOMETHING GOES WRONG — what happened, why, do this

     APKSoftapp.showProblem('broker_unreachable', { onRetry: connect })
     APKSoftapp.showProblem(err, { into: slotEl, subject: 'Rack A', onRetry })
     const r = await APKSoftapp.fetchJson('/api/bim', { timeoutMs: 8000 });
     if (!r.ok) APKSoftapp.showProblem(r.problem, { onRetry: load });

   A code is a key into contracts/problems/problems.json (APKContracts.problem):
   title, cause, fix steps, retry. explain(err) maps what was thrown (fetch
   failure, 404, AbortError, NotAllowedError, bad JSON…) to a code. Every
   ok:false handle above carries .problem too. An error or rejected promise
   nobody caught becomes a card on its own (guard(), on unless
   window.APK_SOFTAPP_GUARD = false is set before this file loads).

   INPUTS, OUTPUTS, CONTROL — what the app IS

     APKSoftapp.describe({ name, does,
       inputs:   [{ name, from, kind?, topic? }],
       outputs:  [{ name, to,   kind?, topic? }],
       controls: [{ name, how }],
       problems: ['bad_input', 'save_failed'] });
   draws a ? button (bottom-left, F1) with the three lists and the fixes for
   the problems the app can hit. A bus input/output adds the broker ones.

   ─────────────────────────────────────────────────────────────────────────
   APKSoftapp.esc(s) escapes text for HTML: every interpolated string goes
   through it (or textContent). APKSoftapp.inheritTheme() copies the parent
   shell's --apk-* tokens into a same-origin iframe. Tests: apk-softapp.test.js. */
(function (root) {
    'use strict';

    var PROTOCOL = 'cad.like.audio/host@1';
    var TRUST_MINUTES = 5;               // owner rule: nothing unverified for 5 minutes is trusted
    var REJUDGE_MS = 15000;
    var NOTICE_ID = 'apk-softapp-notice';
    var THEME_TOKENS = [
        '--apk-accent', '--apk-accent-hover', '--apk-accent-tint', '--apk-on-accent',
        '--apk-state-good', '--apk-state-dead', '--apk-state-kinda',
        '--accent', '--bg-dark', '--bg-panel', '--bg-surface', '--bg-window',
        '--border-color', '--border-light', '--text-main', '--text-muted', '--text-subtle'
    ];

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function origin() { return (root.location && root.location.origin) || ''; }
    function parentWin() {
        try { return root.parent && root.parent !== root ? root.parent : null; } catch (e) { return null; }
    }

    /* ───────────────────────── the CAD bridge ───────────────────────── */

    function say(el, text, state) {
        if (!el) return;
        el.textContent = text;
        el.setAttribute('data-apk-state', state);
    }

    function noticeEl(opt) {
        if (opt === false) return null;
        if (opt && typeof opt === 'object' && 'textContent' in opt) return opt;
        var doc = root.document;
        if (!doc || !doc.createElement) return null;
        var el = doc.getElementById && doc.getElementById(NOTICE_ID);
        if (el) return el;
        el = doc.createElement('div');
        el.id = NOTICE_ID;
        el.setAttribute('role', 'status');
        el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;padding:4px 8px;border-radius:4px;'
            + 'font:12px system-ui,sans-serif;background:rgba(0,0,0,.72);color:#fff;pointer-events:none';
        (doc.body || doc.documentElement).appendChild(el);
        return el;
    }

    function download(block, name) {
        var doc = root.document;
        if (!doc || typeof root.Blob !== 'function' || !root.URL || !root.URL.createObjectURL) return false;
        var url = root.URL.createObjectURL(new root.Blob([JSON.stringify(block, null, 2)], { type: 'application/json' }));
        var a = doc.createElement('a');
        a.href = url;
        a.download = String(name || 'block').replace(/[^\w.-]+/g, '_').replace(/(\.json)?$/i, '.json');
        (doc.body || doc.documentElement).appendChild(a);
        a.click();
        if (a.remove) a.remove();
        root.URL.revokeObjectURL(url);
        return true;
    }

    function connectHost(opts) {
        opts = opts || {};
        var editor = String(opts.editor || (root.document && root.document.title) || 'softapp');
        var blockType = String(opts.blockType || 'block');
        var parent = parentWin();
        var notice = noticeEl(opts.notice);
        var handle;

        function post(type, body) {
            if (!parent) return false;
            var msg = { protocol: PROTOCOL, type: type };
            for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined) msg[k] = body[k];
            try { parent.postMessage(msg, origin()); return true; } catch (e) { return false; }
        }

        function onMessage(e) {
            if (!parent || e.source !== parent || e.origin !== origin()) return;
            var m = e.data;
            if (!isObj(m) || m.protocol !== PROTOCOL) return;
            if (m.type === 'load' && isObj(m.block)) {
                handle.block = m.block;
                handle.meta = isObj(m.meta) ? m.meta : {};
                say(notice, 'In the CAD: Save stores ' + (handle.meta.blockName || 'this block') + ' in the drawing.', 'good');
                if (opts.onLoad) opts.onLoad(handle.block, handle.meta);
            } else if (m.type === 'request') {
                var out = opts.onRequest ? opts.onRequest() : undefined;
                if (isObj(out) && isObj(out.block)) handle.save(out.block, out.meta);
                else handle.save(isObj(out) ? out : handle.block);
            }
        }

        handle = {
            protocol: PROTOCOL,
            embedded: !!parent,
            editor: editor,
            blockType: blockType,
            block: isObj(opts.block) ? opts.block : null,
            meta: {},
            /* toCad.editorReady — the CAD answers with toEditor.load. */
            ready: function () { return post('editorReady', { editor: editor, blockType: blockType }); },
            /* toCad.blockChanged — edited, not saved. */
            changed: function (block, meta) {
                if (isObj(block)) handle.block = block;
                return post('blockChanged', { block: handle.block || {}, meta: merged(meta) });
            },
            /* toCad.blockSave in the CAD; a .json download standalone. Returns 'host', 'download' or ''. */
            save: function (block, meta) {
                if (isObj(block)) handle.block = block;
                var m = merged(meta);
                handle.meta = m;
                var b = handle.block || {};
                if (post('blockSave', { editor: editor, blockType: blockType, block: b, meta: m })) return 'host';
                return download(b, m.filename || m.blockName || blockType) ? 'download' : '';
            },
            /* toCad.editorClose in the CAD; standalone, only a window this page was opened as can close. */
            close: function () {
                if (post('editorClose', { editor: editor })) return true;
                try { if (root.opener && root.close) root.close(); } catch (e) { /* not ours to close */ }
                return false;
            },
            stop: function () { if (root.removeEventListener) root.removeEventListener('message', onMessage); }
        };

        function merged(meta) {
            var out = {};
            var k;
            for (k in handle.meta) if (Object.prototype.hasOwnProperty.call(handle.meta, k)) out[k] = handle.meta[k];
            if (isObj(meta)) for (k in meta) if (Object.prototype.hasOwnProperty.call(meta, k)) out[k] = meta[k];
            return out;
        }

        if (root.addEventListener) root.addEventListener('message', onMessage);
        if (parent) {
            say(notice, 'In the CAD: waiting for the block…', 'kinda');
            if (opts.autoReady !== false) handle.ready();
        } else {
            say(notice, 'Not inside the CAD: Save downloads a .json file.', 'kinda');
        }
        return handle;
    }

    /* ───────────────────────── SDK and bus ───────────────────────── */

    function contracts() {
        var C = root.APKContracts;
        return C && C.Topics ? C : null;
    }

    var busPending = null;
    function bus(opts) {
        if (busPending) return busPending;
        if (!root.APKBus || typeof root.APKBus.connect !== 'function') return Promise.resolve(null);
        var o = { clientId: 'softapp-' + Math.random().toString(16).slice(2) };
        if (opts) for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
        busPending = Promise.resolve(root.APKBus.connect(o)).catch(function () { return null; });
        busPending.then(function (link) { if (!link) busPending = null; });
        return busPending;
    }

    function noBus(C) {
        if (!C) return 'SDK missing: vendor/apk-contracts/apk-contracts.global.js did not load.';
        if (!root.APKBus) return 'No bus here: open this softapp from the APK.audio OS to see the network.';
        return 'No broker reachable from this page.';
    }

    /* The catalogue code for the same three cases. */
    function noBusCode(C) {
        if (!C) return 'sdk_missing';
        if (!root.APKBus) return 'bus_missing';
        return 'broker_unreachable';
    }

    /* ───────────────────────── discovery ───────────────────────── */

    // ComputerBuddy's networkComputers.js MAC_RE: not inside a longer hex run (an EUI-64 is not a MAC).
    var MAC_RE = /(?<![0-9a-f])(?<![0-9a-f]{2}[:_-])([0-9a-f]{2})([:_-])([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})(?![:_-]?[0-9a-f])/i;
    var IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

    /** The MAC inside any string ("ping_00_07_F5_42_06_A2", "nic:b8:27:…"), as aa:bb:cc:dd:ee:ff, or ''. */
    function macIn(s) {
        if (typeof s !== 'string') return '';
        var m = MAC_RE.exec(s);
        return m ? [m[1], m[3], m[4], m[5], m[6], m[7]].join(':').toLowerCase() : '';
    }

    function realValue(s) {
        var v = String(s == null ? '' : s).trim();
        return v && v !== '-' && v !== 'null' ? v : '';
    }

    function parseJson(text) { try { return JSON.parse(text); } catch (e) { return undefined; } }

    function ago(ms) {
        if (!isFinite(ms)) return 'never';
        var s = Math.max(0, Math.round(ms / 1000));
        if (s < 90) return s + 's ago';
        if (s < 5400) return Math.round(s / 60) + ' min ago';
        if (s < 172800) return Math.round(s / 3600) + ' h ago';
        return Math.round(s / 86400) + ' days ago';
    }

    /* The pure model: fed (topic, text), answers things(). No bus, no DOM — the tests drive it. */
    function createDiscovery(o) {
        var roots = o.roots;
        var presenceActive = o.presenceActive || function () { return null; };
        var now = o.now || function () { return Date.now(); };
        var trustMs = (o.trustMinutes == null ? TRUST_MINUTES : o.trustMinutes) * 60000;
        // The collection segment(s) a thing is filed under: Protocols/<proto>/<collection>/[kind/]<id>/<field>.
        // 'Device' everywhere; a scanner may file more (PLUGIN.WIFI puts every BSS heard under 'Network').
        var collections = Array.isArray(o.collections) && o.collections.length ? o.collections.map(String) : ['Device'];
        var hosts = {};        // proto/kind/id -> { proto, kind, id, fields }
        var agents = {};       // node -> { node, target, rows: {section/key: row}, status }
        var presence = {};     // proto/id -> { proto, id, doc }
        var verified = {};     // proto/id -> verifiedAt (ms): the agent's DiscoveryVerified, Discovery/{proto}/{id}/verified
        var seen = {};         // protocols seen

        function protocol(seg, text) {
            var proto = seg[0];
            if (!proto) return false;
            seen[proto] = true;
            var d = -1;
            for (var i = 1; i < seg.length && d < 0; i++) if (collections.indexOf(seg[i]) >= 0) d = i;
            if (d < 0) return false;
            var tail = seg.slice(d + 1), kind = '', id, field;
            if (tail.length === 2) { id = tail[0]; field = tail[1]; }
            else if (tail.length === 3) { kind = tail[0]; id = tail[1]; field = tail[2]; }
            else return false;
            var key = proto + '/' + kind + '/' + id;
            var h = hosts[key];
            if (text === '' || text == null) { if (h) delete h.fields[field]; return !!h; }
            if (!h) h = hosts[key] = { proto: proto, kind: kind, id: id, fields: {} };
            h.fields[field] = String(text);
            return true;
        }

        function agent(node, target) {
            var a = agents[node] || (agents[node] = { node: node, target: target, rows: {}, status: null });
            if (target !== 'MonitorProbes') a.target = target;
            return a;
        }

        function bareMetal(seg, text) {
            var target = seg[0];
            var doc = parseJson(text);
            if (Array.isArray(doc)) {
                var changed = false;
                doc.forEach(function (row) {
                    if (!isObj(row) || !row.node || !row.key) return;
                    var at = seg.indexOf(row.node);
                    var section = (at >= 0 ? seg.slice(at + 1) : seg.slice(1)).join('/') || '-';
                    agent(row.node, target).rows[section + '|' + row.key] = row;
                    changed = true;
                });
                return changed;
            }
            if (isObj(doc)) {
                var node = doc.hostname || doc.node || (target === 'MonitorProbes' ? seg[2] : seg[1]);
                if (!node) return false;
                agent(node, target).status = doc;
                return true;
            }
            return false;
        }

        function presenceMsg(seg, text) {
            if (seg.length === 3 && seg[2] === 'verified' && seg[0].charAt(0) !== '_') {
                // "I just re-verified this thing" (contracts discovery-verified.ts): the trust
                // window reads verifiedAt as well as the presence document's own stamps.
                var vkey = seg[0] + '/' + seg[1];
                var vdoc = text ? parseJson(text) : null;
                var ms = isObj(vdoc) ? Date.parse(vdoc.verifiedAt) : NaN;
                if (!isFinite(ms)) { var hadV = vkey in verified; delete verified[vkey]; return hadV; }
                verified[vkey] = ms;
                return vkey in presence;
            }
            if (seg.length !== 2 || seg[0].charAt(0) === '_') return false;
            var key = seg[0] + '/' + seg[1];
            if (text === '' || text == null) { var had = key in presence; delete presence[key]; return had; }
            var doc = parseJson(text);
            if (!isObj(doc)) return false;
            presence[key] = { proto: seg[0], id: seg[1], doc: doc };
            return true;
        }

        function ingest(topic, text) {
            topic = String(topic);
            if (topic.indexOf(roots.protocols + '/') === 0) return protocol(topic.slice(roots.protocols.length + 1).split('/'), text);
            if (topic.indexOf(roots.bareMetal + '/') === 0) return bareMetal(topic.slice(roots.bareMetal.length + 1).split('/'), text);
            if (topic.indexOf(roots.discovery + '/') === 0) return presenceMsg(topic.slice(roots.discovery.length + 1).split('/'), text);
            return false;
        }

        function agentValue(a, key) {
            for (var k in a.rows) if (k.slice(k.indexOf('|') + 1) === key) return a.rows[k].value;
            return undefined;
        }

        function things() {
            // union-find over identity keys: MAC, serial, agent name, sighting
            var parent = {};
            function find(k) { if (!(k in parent)) parent[k] = k; while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
            function union(keys) {
                keys = keys.filter(Boolean);
                if (!keys.length) return null;
                var r = find(keys[0]);
                for (var i = 1; i < keys.length; i++) parent[find(keys[i])] = r;
                return r;
            }
            var groups = {};
            function bucket(k) { var r = find(k); return groups[r] || (groups[r] = { agent: null, hosts: [], presence: [] }); }

            Object.keys(agents).forEach(function (n) {
                var a = agents[n];
                union(['agent:' + n, macIn(String(agentValue(a, 'mac') || '')) || macIn(String((a.status && a.status.mac) || ''))]);
            });
            Object.keys(hosts).forEach(function (k) {
                var f = hosts[k].fields;
                var serial = realValue(f.serial);
                union(['host:' + k, macIn(f.mac || '') || macIn(serial) || macIn(hosts[k].id), serial && !macIn(serial) ? 'serial:' + serial : '']);
            });
            Object.keys(agents).forEach(function (n) { bucket('agent:' + n).agent = agents[n]; });
            Object.keys(hosts).forEach(function (k) { bucket('host:' + k).hosts.push(hosts[k]); });
            Object.keys(presence).forEach(function (k) {
                var p = presence[k];
                var mac = macIn(p.id);
                // A scanner names its thing's presence document itself (the presence_topic
                // leaf); that pointer is the link when the presence id is not the topic key
                // (wireless_wwb:plan:… beside wireless_wwb_plan_…, ROAD-3519) and no MAC joins them.
                var topic = roots.discovery + '/' + k;
                var hostKey = Object.keys(hosts).filter(function (h) {
                    return hosts[h].id === p.id || realValue(hosts[h].fields.presence_topic) === topic;
                })[0];
                var r = mac && (mac in parent) ? find(mac) : hostKey ? find('host:' + hostKey) : null;
                if (r && groups[r]) groups[r].presence.push(p);   // presence alone is not a thing
            });

            var list = Object.keys(groups).map(function (r) { return describe(groups[r]); });
            var rank = { good: 0, kinda: 1, dead: 2 };
            list.sort(function (x, y) { return rank[x.live.state] - rank[y.live.state] || x.name.localeCompare(y.name); });
            return list;
        }

        function describe(g) {
            var macs = [], ips = [], kinds = [], protos = [], names = [], fields = {}, vendor = '', model = '', serial = '';
            function add(list, v) { if (v && list.indexOf(v) < 0) list.push(v); }
            var a = g.agent;
            if (a) {
                add(macs, macIn(String(agentValue(a, 'mac') || '')) || macIn(String((a.status && a.status.mac) || '')));
                add(names, agentValue(a, 'hostname') || (a.status && a.status.hostname) || a.node);
                model = realValue(agentValue(a, 'model'));
                add(kinds, 'agent');
                if (a.target) add(kinds, String(a.target).toLowerCase());
            }
            g.hosts.forEach(function (h) {
                var f = h.fields;
                add(protos, h.proto);
                add(kinds, h.proto.toLowerCase());
                if (h.kind) add(kinds, h.kind.toLowerCase());
                if (realValue(f.device_class)) add(kinds, realValue(f.device_class).toLowerCase());
                add(macs, macIn(f.mac || '') || macIn(f.serial || '') || macIn(h.id));
                String(f.ips || f.ip || '').split(/[\s,]+/).forEach(function (ip) { if (IPV4_RE.test(ip)) add(ips, ip); });
                if (!vendor) vendor = realValue(f.manufacturer) || realValue(f.vendor);
                if (!model) model = realValue(f.model);
                if (!serial && realValue(f.serial) && !macIn(f.serial)) serial = realValue(f.serial);
                var n = realValue(f.name);
                if (n && !IPV4_RE.test(n) && !macIn(n)) add(names, n);
                var into = fields[h.proto] || (fields[h.proto] = {});
                for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) into[k] = f[k];
            });
            var mac = macs[0] || '';
            var first = g.hosts[0];
            var id = mac || (serial ? 'serial:' + serial : a ? 'agent:' + a.node : 'host:' + first.proto + '/' + first.kind + '/' + first.id);
            return {
                id: id, mac: mac, macs: macs, serial: serial,
                name: names[0] || (vendor ? vendor + (mac ? ' ' + mac.slice(-5) : '') : '') || mac || serial || (first && first.id) || 'unnamed',
                ips: ips, vendor: vendor, model: model, protocols: protos, kinds: kinds, fields: fields,
                agent: a ? { node: a.node, target: a.target } : null,
                live: live(g)
            };
        }

        /* good / kinda / dead: the freshest timed fact wins; trust decays after trustMinutes. */
        function live(g) {
            var t = now(), facts = [];
            var a = g.agent;
            if (a) {
                var newest = NaN;
                for (var k in a.rows) { var ts = Date.parse(a.rows[k].last_seen); if (isFinite(ts) && !(ts <= newest)) newest = ts; }
                var offline = a.status && /offline|dead|lost/i.test(String(a.status.status || ''));
                if (isFinite(newest)) {
                    var age = t - newest;
                    facts.push(offline ? { at: newest, state: 'dead', why: 'its agent went offline; last report ' + ago(age) }
                        : age <= trustMs ? { at: newest, state: 'good', why: 'its agent reported ' + ago(age) }
                            : { at: newest, state: 'kinda', why: 'its agent last reported ' + ago(age) + ', not re-verified since' });
                } else if (offline) facts.push({ at: 0, state: 'dead', why: 'its agent is offline' });
            }
            g.presence.forEach(function (p) {
                var active = presenceActive(p.doc);
                if (active === null || active === undefined) return;
                if (active) {
                    var seenAt = Date.parse(p.doc.lastDiscovered || p.doc.lastOnline);
                    var vAt = verified[p.proto + '/' + p.id];
                    if (isFinite(vAt) && !(vAt <= seenAt)) seenAt = vAt;   // re-verified since: that counts
                    var age = t - seenAt;
                    facts.push(age <= trustMs ? { at: seenAt, state: 'good', why: p.proto + ' verified it ' + ago(age) }
                        : { at: seenAt, state: 'kinda', why: p.proto + ' last verified it ' + ago(age) });
                } else {
                    var lost = Date.parse(p.doc.lastOffline) || 0;
                    facts.push({ at: lost, state: 'dead', why: p.proto + ' lost it ' + ago(t - lost) });
                }
            });
            if (facts.length) { facts.sort(function (x, y) { return y.at - x.at; }); return facts[0]; }
            for (var i = 0; i < g.hosts.length; i++) {
                var s = String(g.hosts[i].fields.state || '').toLowerCase();
                if (s === 'reachable' || s === 'permanent') return { at: NaN, state: 'kinda', why: g.hosts[i].proto + ': ' + s + ', not timed' };
                if (s === 'failed' || s === 'incomplete' || s === 'unreachable') return { at: NaN, state: 'dead', why: g.hosts[i].proto + ': ' + s };
            }
            return { at: NaN, state: 'kinda', why: 'seen on the network, never verified' };
        }

        return {
            ingest: ingest,
            things: things,
            protocolsSeen: function () { return Object.keys(seen); }
        };
    }

    function rootsOf(C) {
        var strip = function (t) { return String(t).replace(/\/#$/, ''); };
        return {
            protocols: strip(C.Topics.protocols.wildcard()),
            bareMetal: C.Topics.bareMetal.ROOT,
            discovery: strip(C.Topics.discoveryWildcard())
        };
    }

    function matchesKinds(thing, kinds) {
        if (!kinds || !kinds.length) return true;
        return kinds.some(function (k) {
            k = String(k).toLowerCase();
            return thing.kinds.some(function (x) { return x.indexOf(k) >= 0; });
        });
    }

    /* ok:false, with the reason in one line AND the Problem (what to do): show
       it with APKSoftapp.showProblem(handle.problem, { into: slot, onRetry }). */
    function idle(reason, code) {
        return { ok: false, reason: reason, problem: problem(code || 'script_error', { detail: reason }),
            things: function () { return []; }, rows: function () { return []; }, stop: function () {} };
    }

    /* Subscribes through bus(); resolves a handle at once (things() fills as retained messages land). */
    function discovered(opts) {
        opts = opts || {};
        var C = contracts();
        var linkP = opts.bus ? Promise.resolve(opts.bus) : (C ? bus() : Promise.resolve(null));
        return linkP.then(function (link) {
            if (!C || !link) return idle(noBus(C), noBusCode(C));
            var model = createDiscovery({
                roots: rootsOf(C), presenceActive: C.discoveryPresenceActive,
                trustMinutes: opts.trustMinutes, now: opts.now, collections: opts.collections
            });
            var offs = [], watched = {}, pending = null, timer = null;
            var schedule = opts.schedule || function (fn) { return setTimeout(fn, 250); };
            function emit() {
                pending = null;
                if (opts.onChange) opts.onChange(handle.things());
            }
            function feed(topic, text) {
                var changed = model.ingest(topic, text);
                model.protocolsSeen().forEach(function (p) {
                    if (watched[p]) return;
                    watched[p] = true;
                    try {
                        offs.push(link.subscribe(C.Topics.discoveryWildcard(p), feed));
                        offs.push(link.subscribe(C.Topics.discoveryWildcard(p) + '/verified', feed));   // DiscoveryVerified
                    } catch (e) { /* not a valid segment */ }
                });
                if (changed && !pending) pending = schedule(emit);
            }
            offs.push(link.subscribe(C.Topics.protocols.wildcard(), feed));
            offs.push(link.subscribe(C.Topics.bareMetal.wildcard(), feed));
            if (opts.onChange && typeof setInterval === 'function') timer = setInterval(emit, REJUDGE_MS);   // trust decays when the bus is quiet
            var handle = {
                ok: true,
                reason: '',
                bus: link,
                model: model,
                things: function () { return model.things().filter(function (t) { return matchesKinds(t, opts.kinds); }); },
                stop: function () {
                    offs.forEach(function (off) { if (typeof off === 'function') off(); });
                    offs = [];
                    if (timer) clearInterval(timer);
                }
            };
            return handle;
        });
    }

    /* ───────────────────────── the Discovered panel ───────────────────────── */

    /* What a dozen editors each kept a copy of (js/discoveredPanel.js,
       js/discoveredTable.js, ROAD-3502): the things discovered() finds, as one
       APKTable with a live column, a status line, and a button per row. */

    var LIVE_STATES = ['good', 'kinda', 'dead'];

    /** The identity of a discovered thing: MAC, else serial, else its agent's own name. Never an IP. */
    function thingIdentity(t) {
        if (!t) return '';
        var a = t.agent;
        return String(t.mac || t.serial || (isObj(a) ? a.node : a) || '');
    }

    /** One discovered thing as a plain table row (text only: APKTable writes cells with textContent). */
    function thingRow(t) {
        t = t || {};
        var live = t.live || {};
        var identity = thingIdentity(t);
        function list(v) { return Array.isArray(v) ? v.join(', ') : ''; }
        return {
            id: String(t.id || identity),
            name: String(t.name || t.model || identity || ''),
            make: [t.vendor, t.model].filter(Boolean).join(' '),
            vendor: String(t.vendor || ''),
            model: String(t.model || ''),
            identity: identity,
            ips: list(t.ips),
            kinds: list(t.kinds),
            seenBy: list(t.protocols),
            state: LIVE_STATES.indexOf(live.state) >= 0 ? live.state : 'kinda',   // nothing unverified is trusted
            why: String(live.why || 'never verified')
        };
    }

    var DISCOVERED_COLUMNS = [
        { key: 'name', label: 'Name' },
        { key: 'make', label: 'Make / model' },
        { key: 'identity', label: 'MAC / serial', mono: true },
        { key: 'ips', label: 'Address', mono: true },
        { key: 'seenBy', label: 'Seen by' },
        { key: 'why', label: 'Why' }
    ];

    function wordList(v) { return Array.isArray(v) && v.every(function (w) { return typeof w === 'string'; }); }

    /* An app's discovery tunables, checked: kinds (and collections) must be
       lists of words. → { ...the file, kinds, collections?, url, why, problem }.
       why is '' when the file was read and is right; problem (a Problem, or
       null) says what to fix. A file that is not there means "show everything"
       (problem null) unless `required`. Never throws. */
    function checkConfig(cfg, url) {
        var bad = function (detail) {
            return { kinds: [], url: url, why: detail, problem: problem('config_invalid', { detail: detail, subject: url,
                fix: ['Fix ' + url + ' (JSON with "kinds": ["word", …]); the Discovered panel lists everything until then.'] }) };
        };
        if (!isObj(cfg)) return bad(url + ' holds ' + JSON.stringify(cfg) + ', not an object.');
        if (cfg.kinds !== undefined && !wordList(cfg.kinds)) return bad('Field "kinds" in ' + url + ' is not a list of words.');
        if (cfg.collections !== undefined && !wordList(cfg.collections)) return bad('Field "collections" in ' + url + ' is not a list of words.');
        var out = {};
        for (var k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k)) out[k] = cfg[k];
        out.kinds = (cfg.kinds || []).slice();
        out.url = url;
        out.why = '';
        out.problem = null;
        return out;
    }

    function discoveredConfig(url, opts) {
        opts = opts || {};
        url = String(url || './config/discovered.json');
        var missing = function (detail, code) {
            return { kinds: [], url: url, why: detail, problem: opts.required ? problem(code, { detail: detail, subject: url }) : null };
        };
        return fetchJson(url, { cache: 'no-store', timeoutMs: opts.timeoutMs || 8000, subject: url }).then(function (r) {
            if (r.ok) return checkConfig(r.data, url);
            if (r.problem && r.problem.code === 'bad_json') {
                return { kinds: [], url: url, why: r.problem.detail || (url + ' is not JSON'),
                    problem: problem('config_invalid', { detail: r.problem.detail, subject: url,
                        fix: ['Fix ' + url + ' (JSON with "kinds": ["word", …]); the Discovered panel lists everything until then.'] }) };
            }
            return missing((r.status ? r.status + ' reading ' : 'could not read ') + url, (r.problem && r.problem.code) || 'http_not_found');
        });
    }

    /* DRAW WHAT THE BUS KNOWS. One call, the whole panel:

         const panel = await APKSoftapp.discoveredPanel(hostEl, {
           configUrl: './config/discovered.json',   // or config: {kinds,…}, or kinds: [...]
           status: statusEl, id: 'my-discovered',   // the status line; the APKTable id
           pickLabel: 'Bind', onPick(thing) {},     // a button per row (optional)
           onChange(things) {}, columns, toRows,    // optional
         });
         panel.things() / panel.config / panel.table / panel.retry() / panel.stop()

       The config's `kinds` filters (discovered({ kinds })); its `collections`
       names the topic segments a thing is filed under (default Device). The
       status line counts verified / not re-verified / dead and says when the
       bus is not connected; no SDK, bus or broker is a Problem card in the
       status line, with Retry. Resolves the panel; never throws. */
    function discoveredPanel(host, opts) {
        opts = opts || {};
        var T = opts.table || root.APKTable;
        var doc = (host && host.ownerDocument) || root.document;
        var status = opts.status || null;
        var subject = opts.subject || 'Discovered';
        function say(text, state) {
            if (!status) return;
            status.textContent = text;
            status.setAttribute('data-apk-state', state);
            status.setAttribute('data-apk-tone', state);
        }
        var things = [], link = null;
        var panel = {
            ok: false, reason: '', problem: null, config: null, table: null, handle: null, bus: null,
            things: function () { return things; },
            stop: function () { if (panel.handle) panel.handle.stop(); },
            retry: function () { return run(); }
        };
        if (!T || typeof T.create !== 'function' || !doc) {
            panel.reason = 'vendor/apk-table did not load, so the Discovered panel cannot draw.';
            panel.problem = problem('sdk_missing', { detail: panel.reason });
            say(panel.reason, 'dead');
            return Promise.resolve(panel);
        }
        var columns = [{ key: 'state', label: 'Live', render: function (v, row) {
            var b = doc.createElement('span');
            b.className = 'apk-live';
            b.setAttribute('data-apk-state', row.state);
            b.setAttribute('data-apk-tone', row.state);
            b.textContent = row.state;
            b.title = row.why;
            return b;
        } }].concat((opts.columns || DISCOVERED_COLUMNS).map(function (c) {
            var o = { editable: false };
            for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) o[k] = c[k];
            return o;
        }));
        if (opts.onPick) {
            columns.push({ key: '_pick', label: '', render: function (v, row) {
                var b = doc.createElement('button');
                b.type = 'button';
                b.className = 'btn btn-secondary btn-sm apk-table-btn';
                b.textContent = opts.pickLabel || 'Use';
                b.addEventListener('click', function () {
                    var t = things.filter(function (x) { return String(x.id) === row.id; })[0];
                    if (t) opts.onPick(t);
                });
                return b;
            } });
        }
        var cfgOf = function () {
            if (opts.config) return Promise.resolve(checkConfig(opts.config, String(opts.configUrl || opts.config.url || 'config')));
            if (opts.configUrl) return discoveredConfig(opts.configUrl, { required: opts.required });
            return Promise.resolve(checkConfig({ kinds: opts.kinds || [] }, 'kinds'));
        };
        var toRows = opts.toRows || function (list) { return list.map(thingRow); };
        function words(cfg) { return cfg && cfg.kinds.length ? cfg.kinds.join(', ') : 'anything'; }
        panel.table = T.create(host, {
            id: opts.id, columns: columns, rows: [], editable: false,
            empty: opts.empty || 'Nothing on the bus matches yet.',
            searchPlaceholder: 'name, MAC, address'
        });
        function tell() {
            var note = panel.config && panel.config.why ? ' · config: ' + panel.config.why : '';
            if (link && link.connected === false) {
                return say('Bus not connected' + (link.url ? ' (' + link.url + ')' : '') + ': nothing here is verified now' + note + '.', 'dead');
            }
            var n = function (s) { return things.filter(function (t) { return t.live && t.live.state === s; }).length; };
            say(things.length + ' on the bus (kinds: ' + words(panel.config) + ') · ' + n('good') + ' verified · '
                + n('kinda') + ' not re-verified · ' + n('dead') + ' dead. Trust decays after '
                + (opts.trustMinutes == null ? TRUST_MINUTES : opts.trustMinutes) + ' min' + note + '.', things.length ? 'good' : 'kinda');
        }
        function draw(list) {
            things = list;
            panel.table.setRows(toRows(list));
            tell();
            if (opts.onChange) opts.onChange(list);
        }
        function run() {
            if (panel.handle) { panel.handle.stop(); panel.handle = null; }
            say('Asking the bus…', 'kinda');
            return cfgOf().then(function (cfg) {
                panel.config = cfg;
                if (cfg.problem && opts.problems !== false) showProblem(cfg.problem, { subject: cfg.url });
                return discovered({
                    kinds: cfg.kinds, collections: cfg.collections, onChange: draw, bus: opts.bus,
                    schedule: opts.schedule, now: opts.now, trustMinutes: opts.trustMinutes
                });
            }).then(function (d) {
                panel.handle = d;
                panel.ok = d.ok;
                panel.reason = d.reason;
                panel.problem = d.problem || null;
                panel.bus = link = d.bus || null;
                if (!d.ok) {
                    say(d.reason, 'dead');
                    // what happened / why / do this, in the status line, with Retry asking the bus again
                    if (d.problem && opts.problems !== false) showProblem(d.problem, { into: status || undefined, subject: subject, onRetry: run });
                    return panel;
                }
                if (link && typeof link.on === 'function' && !run.listening) {
                    run.listening = true;
                    link.on('connect', tell);
                    link.on('close', tell);
                }
                draw(d.things());
                return panel;
            });
        }
        return run();
    }

    /* ───────────────────────── the Interfaces table ───────────────────────── */

    function tableRows(doc) {
        if (Array.isArray(doc)) return { rows: doc, headers: doc[0] ? Object.keys(doc[0]) : [] };
        if (!isObj(doc)) return null;
        if (isObj(doc['Interface Map']) && isObj(doc['Interface Map'].blocks)) doc = doc['Interface Map'].blocks.Interfaces;
        else if (isObj(doc.blocks) && isObj(doc.blocks.Interfaces)) doc = doc.blocks.Interfaces;
        if (!isObj(doc) || !Array.isArray(doc.data)) return null;
        return { rows: doc.data, headers: Array.isArray(doc.headers) ? doc.headers : (doc.data[0] ? Object.keys(doc.data[0]) : []) };
    }

    /** The Gui path of the Interface Map's Interfaces table (a panel path, built by Topics.gui.topic). */
    var INTERFACES_PATH = ['Interfaces', 'Map', 'Interfaces'];

    function interfaces(opts) {
        opts = opts || {};
        var rows = [], headers = [];
        function take(doc) {
            var t = tableRows(doc);
            if (!t) return false;
            rows = t.rows; headers = t.headers;
            if (opts.onChange) opts.onChange(rows, headers);
            return true;
        }
        function handle(extra) {
            var h = { ok: true, reason: '', rows: function () { return rows; }, headers: function () { return headers; }, stop: function () {} };
            for (var k in extra) h[k] = extra[k];
            return h;
        }
        if (opts.url) {
            if (typeof root.fetch !== 'function') return Promise.resolve(idle('No fetch in this page.', 'unsupported_browser'));
            return root.fetch(opts.url, { cache: 'no-store' })
                .then(function (r) { if (!r.ok) throw Object.assign(new Error(r.status + ' from ' + opts.url), { status: r.status }); return r.json(); })
                .then(function (doc) { return take(doc) ? handle({}) : idle(opts.url + ' holds no Interfaces table.', 'bad_input'); })
                .catch(function (e) {
                    var code = e.status ? (e.status === 404 ? 'http_not_found' : e.status >= 500 ? 'http_server_error' : 'http_forbidden') : explain(e).code;
                    return idle('Could not read ' + opts.url + ' (' + e.message + ').', code);
                });
        }
        var C = contracts();
        var linkP = opts.bus ? Promise.resolve(opts.bus) : (C ? bus() : Promise.resolve(null));
        return linkP.then(function (link) {
            if (!C || !link) return idle(noBus(C), noBusCode(C));
            var off = link.subscribe(C.Topics.gui.topic(INTERFACES_PATH), function (topic, text) { take(parseJson(text)); });
            return handle({ topic: C.Topics.gui.topic(INTERFACES_PATH), stop: function () { if (typeof off === 'function') off(); } });
        });
    }

    /* ───────────────────────── theme ───────────────────────── */

    function inheritTheme(tokens) {
        var p = parentWin();
        if (!p) return 0;
        var n = 0;
        try {
            var style = p.getComputedStyle(p.document.documentElement);
            (tokens || THEME_TOKENS).forEach(function (t) {
                var v = style.getPropertyValue(t);
                if (v && v.trim()) { root.document.documentElement.style.setProperty(t, v.trim()); n++; }
            });
        } catch (e) { /* cross-origin parent: keep our own tokens */ }
        return n;
    }

    /* ───────────────────────── problems: what happened, why, do this ───────────────────────── */

    /* The catalogue is contracts/problems/problems.json, through APKContracts.
       These few are the ones that can happen BEFORE APKContracts loads (or
       because it did not), so this file must be able to say them on its own.
       apk-softapp.test.js holds every one equal to the catalogue's. */
    var FALLBACK_PROBLEMS = {
        sdk_missing: {
            area: 'config', title: "This app's shared code did not load",
            cause: 'vendor/apk-contracts/apk-contracts.global.js (or vendor/apk-softapp/apk-softapp.js) is missing or was served as an error page.',
            fix: ['Reload the page once (Ctrl+Shift+R) in case it was a half-finished load.',
                'Re-vendor it: python3 .apk.scripts/vendor_contract_web.py <app>/vendor/apk-contracts and python3 .apk.scripts/vendor_shared_web.py <app>/vendor/apk-softapp.',
                'If the app is served by the bench, rebuild the image that carries it: PODS/POD.manager/MANAGER.Docktor/K8/up-stack.sh WEB.Frontend-Assets.'],
            retry: true
        },
        script_error: {
            area: 'config', title: 'Something in this app broke',
            cause: 'The app hit an error it did not expect. What you see may be incomplete.',
            fix: ['Save or export your work now if you can.', 'Reload the page.',
                "If it happens again, copy the details (button below) into the app's roadmap item so it can be fixed."],
            retry: true
        }
    };

    function problem(code, opts) {
        var C = root.APKContracts;
        opts = opts || {};
        if (C && typeof C.problem === 'function') return C.problem(String(code), opts);
        var known = Object.prototype.hasOwnProperty.call(FALLBACK_PROBLEMS, code);
        var e = known ? FALLBACK_PROBLEMS[code] : FALLBACK_PROBLEMS.script_error;
        var p = { code: String(code), area: e.area, title: known ? e.title : (opts.detail || e.title), cause: e.cause,
            fix: (opts.fix || []).concat(e.fix), retry: e.retry };
        if (opts.detail != null && known) p.detail = opts.detail;
        if (opts.subject != null) p.subject = opts.subject;
        return p;
    }

    /* Whatever was thrown (Error, DOMException, Response, string, {code}) → a Problem. */
    function explain(err, opts) {
        var C = root.APKContracts;
        opts = opts || {};
        var extra = Array.isArray(opts.fix) ? opts.fix : [];
        if (isObj(err) && typeof err.code === 'string' && typeof err.title === 'string' && Array.isArray(err.fix)) {   // already one
            if (!extra.length && opts.subject == null) return err;
            var copy = {};
            for (var k in err) if (Object.prototype.hasOwnProperty.call(err, k)) copy[k] = err[k];
            copy.fix = extra.concat(err.fix.filter(function (s) { return extra.indexOf(s) < 0; }));
            if (opts.subject != null && copy.subject == null) copy.subject = opts.subject;
            return copy;
        }
        if (C && typeof C.explain === 'function') return C.explain(err, opts);
        var msg = err && err.message ? err.message : String(err);
        return problem('script_error', { detail: msg, subject: opts.subject, fix: extra });
    }

    function problemText(p) {
        var C = root.APKContracts;
        if (C && typeof C.problemText === 'function') return C.problemText(p);
        var lines = [p.title + (p.subject ? ' — ' + p.subject : '') + ' [' + p.code + ']'];
        if (p.detail) lines.push('Details: ' + p.detail);
        lines.push('Why: ' + p.cause);
        p.fix.forEach(function (s, i) { lines.push((i + 1) + '. ' + s); });
        return lines.join('\n');
    }

    var STACK_ID = 'apk-softapp-problems';
    var shown = {};   // code|detail -> card, so one fault repeating is one card

    function el(doc, tag, css, text) {
        var n = doc.createElement(tag);
        if (css) n.style.cssText = css;
        if (text != null) n.textContent = text;
        return n;
    }

    function problemStack(doc) {
        var s = doc.getElementById && doc.getElementById(STACK_ID);
        if (s) return s;
        s = el(doc, 'div', 'position:fixed;right:8px;bottom:40px;z-index:10000;display:flex;flex-direction:column;gap:8px;'
            + 'max-width:min(420px,calc(100vw - 16px));max-height:calc(100vh - 56px);overflow:auto');
        s.id = STACK_ID;
        (doc.body || doc.documentElement).appendChild(s);
        return s;
    }

    /* Draw a problem: what happened, why, the steps, and Retry / Copy / Dismiss.
         APKSoftapp.showProblem(p | code | error, { into: element, onRetry() {}, onClose() {} })
       → the card element (or null with no document). `into` replaces that
       element's content (an inline slot in the app); without it the card
       stacks bottom-right. Text only — nothing interpolated as HTML. */
    function showProblem(p, opts) {
        opts = opts || {};
        if (typeof p === 'string') p = problem(p, opts);
        else p = explain(p, opts);
        var doc = root.document;
        if (!doc || !doc.createElement) return null;
        var key = p.code + '|' + (p.detail || '') + '|' + (p.subject || '');
        if (!opts.into && shown[key] && shown[key].parentNode) return shown[key];
        var tone = p.area === 'browser' || p.retry ? 'kinda' : 'dead';
        var card = el(doc, 'section', 'font:13px/1.4 system-ui,sans-serif;color:var(--text-main,#eee);'
            + 'background:var(--bg-panel,#1e1e1e);border:1px solid var(--border-color,#444);'
            + 'border-left:4px solid var(--apk-state-' + tone + ',' + (tone === 'dead' ? '#e5484d' : '#e5a50a') + ');'
            + 'border-radius:6px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.4)');
        card.setAttribute('role', 'alert');
        card.setAttribute('data-apk-state', tone);
        card.setAttribute('data-apk-problem', p.code);
        card.appendChild(el(doc, 'strong', 'display:block;font-size:14px', p.title + (p.subject ? ' — ' + p.subject : '')));
        if (p.detail) card.appendChild(el(doc, 'div', 'margin-top:2px;color:var(--text-muted,#aaa);word-break:break-word', p.detail));
        card.appendChild(el(doc, 'div', 'margin-top:6px', 'Why: ' + p.cause));
        if (p.fix && p.fix.length) {
            card.appendChild(el(doc, 'div', 'margin-top:6px;font-weight:600', 'Do this:'));
            var ol = el(doc, 'ol', 'margin:2px 0 0 18px;padding:0');
            p.fix.forEach(function (step) { ol.appendChild(el(doc, 'li', 'margin:2px 0', step)); });
            card.appendChild(ol);
        }
        var bar = el(doc, 'div', 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap');
        var btn = 'font:inherit;padding:3px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--border-color,#555);'
            + 'background:var(--bg-surface,#2a2a2a);color:inherit';
        function button(label, fn, primary) {
            var b = el(doc, 'button', btn + (primary ? ';background:var(--apk-accent,#f4902c);color:var(--apk-on-accent,#111);border-color:transparent' : ''), label);
            b.setAttribute('type', 'button');
            if (b.addEventListener) b.addEventListener('click', fn);
            else b.onclick = fn;
            bar.appendChild(b);
            return b;
        }
        function close() {
            delete shown[key];
            if (opts.into) { if (opts.into.textContent !== undefined) opts.into.textContent = ''; }
            else if (card.remove) card.remove();
            else if (card.parentNode && card.parentNode.removeChild) card.parentNode.removeChild(card);
            if (opts.onClose) opts.onClose(p);
        }
        if (opts.onRetry && p.retry !== false) button('Retry', function () { close(); opts.onRetry(p); }, true);
        button('Copy details', function () {
            var text = problemText(p);
            try { root.navigator.clipboard.writeText(text); } catch (e) { /* no clipboard: the text is on screen */ }
        });
        if (opts.dismissable !== false) button('Dismiss', close);
        card.appendChild(bar);
        if (opts.into) {
            if (opts.into.replaceChildren) opts.into.replaceChildren(card);
            else { opts.into.textContent = ''; opts.into.appendChild(card); }
        } else {
            var stack = problemStack(doc);
            stack.appendChild(card);
            shown[key] = card;
            var kids = stack.children || [];
            while (kids.length > 3 && stack.removeChild) stack.removeChild(kids[0]);   // three is a lot already
        }
        if (root.console && root.console.warn) root.console.warn(problemText(p));
        return card;
    }

    /* The page's last line of defence: an error or a rejected promise nobody
       caught becomes a card with a way back, instead of a dead button and a
       console nobody has open. On by default for every page that loads this
       file; window.APK_SOFTAPP_GUARD = false before it loads turns it off. */
    var NOISE = /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection captured with value: undefined/;
    var guarded = false;
    function guard(opts) {
        if (guarded || !root.addEventListener) return false;
        guarded = true;
        opts = opts || {};
        root.addEventListener('error', function (e) {
            if (!e || e.target && e.target !== root && e.target.tagName) {
                // a <script>/<img>/<link> that failed to load: name the file
                var src = e && e.target && (e.target.src || e.target.href);
                if (src && /apk-(contracts|softapp)/.test(src)) showProblem('sdk_missing', { detail: src + ' did not load' });
                return;
            }
            var msg = String((e.error && e.error.message) || e.message || '');
            if (NOISE.test(msg)) return;
            showProblem(e.error || msg, { subject: opts.subject || described && described.name });
        }, true);
        root.addEventListener('unhandledrejection', function (e) {
            var r = e && e.reason;
            if (NOISE.test(String(r && r.message || r))) return;
            showProblem(r, { subject: opts.subject || described && described.name });
        });
        return true;
    }

    /* AN INPUT, READ WITH A WAY BACK. fetch + status + JSON in one call that
       never throws:
         const r = await APKSoftapp.fetchJson('/api/bim', { timeoutMs: 8000 });
         if (!r.ok) return APKSoftapp.showProblem(r.problem, { into: slot, onRetry: load });
         use(r.data);
       The problem names the URL (detail) and what failed (status, timeout,
       not JSON — an HTML error page is the usual one). */
    function fetchJson(url, opts) {
        opts = opts || {};
        if (typeof root.fetch !== 'function') return Promise.resolve({ ok: false, problem: problem('unsupported_browser', { detail: 'no fetch() in this page', subject: opts.subject }) });
        var ctl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        var timer = ctl && opts.timeoutMs ? setTimeout(function () { ctl.abort(); }, opts.timeoutMs) : null;
        var init = {};
        for (var k in opts) if (k !== 'timeoutMs' && k !== 'subject' && Object.prototype.hasOwnProperty.call(opts, k)) init[k] = opts[k];
        if (ctl) init.signal = ctl.signal;
        var sub = { subject: opts.subject };
        return root.fetch(url, init).then(function (r) {
            if (!r.ok) return { ok: false, status: r.status, problem: explain({ ok: false, status: r.status, statusText: r.statusText, url: String(url) }, sub) };
            return r.text().then(function (text) {
                try { return { ok: true, status: r.status, data: JSON.parse(text) }; }
                catch (e) {
                    var looksHtml = /^\s*</.test(text);
                    return { ok: false, status: r.status, problem: problem('bad_json', { detail: String(url) + (looksHtml ? ' answered with an HTML page, not JSON' : ': ' + e.message), subject: opts.subject }) };
                }
            });
        }, function (e) {
            var p = explain(e, sub);
            if (!p.detail || p.detail === e.message) p.detail = String(url) + (e && e.message ? ' — ' + e.message : '');
            return { ok: false, problem: p };
        }).then(function (out) { if (timer) clearTimeout(timer); return out; });
    }

    /* ───────────────────────── inputs, outputs, control ───────────────────────── */

    /* Every app says what it takes in, what it puts out, and what it lets you
       control. Those three lists ARE the app; the help panel draws them, and
       the problems it names say what to do when one of them fails.

         APKSoftapp.describe({
           name: 'Patch Panel',
           does: 'Lays out a patch panel and its labels.',
           inputs:   [{ name: 'Panel file', from: '.json from Open, or the CAD block', kind: 'file' }],
           outputs:  [{ name: 'Panel block', to: 'the CAD drawing, or a .json download', kind: 'file' }],
           controls: [{ name: 'Add port', how: 'Click + or press A' }],
           problems: ['bad_input', 'save_failed'],   // codes from contracts/problems/problems.json
           help: false                                // no ? button (the app draws describe() itself)
         });

       Each entry is { name, from|to|how, kind?, topic? } — `topic` for a bus
       input/output. Returns the description, with `problems` expanded to full
       Problems. APKSoftapp.described is the last one (null before). F1 or the
       ? button (bottom-left) opens the panel; Esc closes it. */
    var described = null;
    var HELP_ID = 'apk-softapp-help';

    function listOf(v) { return Array.isArray(v) ? v.filter(isObj) : []; }

    function describe(d) {
        d = isObj(d) ? d : {};
        var codes = Array.isArray(d.problems) ? d.problems.slice() : [];
        var usesBus = listOf(d.inputs).concat(listOf(d.outputs)).some(function (x) { return x.topic || x.kind === 'bus'; });
        if (usesBus) ['broker_unreachable', 'bus_disconnected'].forEach(function (c) { if (codes.indexOf(c) < 0) codes.push(c); });
        described = {
            name: String(d.name || (root.document && root.document.title) || 'This app'),
            does: d.does ? String(d.does) : '',
            inputs: listOf(d.inputs),
            outputs: listOf(d.outputs),
            controls: listOf(d.controls),
            problems: codes.map(function (c) { return problem(c); })
        };
        api.described = described;
        if (d.help !== false) helpButton();
        return described;
    }

    function helpButton() {
        var doc = root.document;
        if (!doc || !doc.createElement || (doc.getElementById && doc.getElementById(HELP_ID + '-btn'))) return;
        var b = el(doc, 'button', 'position:fixed;left:8px;bottom:8px;z-index:9998;width:28px;height:28px;border-radius:50%;'
            + 'font:bold 15px system-ui,sans-serif;cursor:pointer;border:1px solid var(--border-color,#555);'
            + 'background:var(--bg-panel,#1e1e1e);color:var(--text-main,#eee);opacity:.75', '?');
        b.id = HELP_ID + '-btn';
        b.setAttribute('type', 'button');
        b.setAttribute('title', 'What this app takes in, puts out and lets you control (F1)');
        b.setAttribute('aria-label', 'Help: inputs, outputs, controls');
        if (b.addEventListener) b.addEventListener('click', function () { toggleHelp(); });
        (doc.body || doc.documentElement).appendChild(b);
        if (root.addEventListener && !helpButton.keys) {
            helpButton.keys = true;
            root.addEventListener('keydown', function (e) {
                if (e.key === 'F1') { e.preventDefault(); toggleHelp(); }
                else if (e.key === 'Escape') toggleHelp(false);
            });
        }
    }

    /* Open (true), close (false) or flip (no argument) the help panel. */
    function toggleHelp(open) {
        var doc = root.document;
        if (!doc || !doc.createElement) return false;
        var cur = doc.getElementById && doc.getElementById(HELP_ID);
        if (cur && open !== true) { if (cur.remove) cur.remove(); return false; }
        if (cur || open === false || !described) return !!cur;
        var d = described;
        var p = el(doc, 'aside', 'position:fixed;left:8px;bottom:44px;z-index:9999;width:min(460px,calc(100vw - 16px));'
            + 'max-height:calc(100vh - 60px);overflow:auto;font:13px/1.45 system-ui,sans-serif;color:var(--text-main,#eee);'
            + 'background:var(--bg-panel,#1e1e1e);border:1px solid var(--border-color,#444);border-radius:8px;padding:12px 14px;'
            + 'box-shadow:0 6px 24px rgba(0,0,0,.5)');
        p.id = HELP_ID;
        p.setAttribute('role', 'dialog');
        p.setAttribute('aria-label', d.name + ' — inputs, outputs, controls');
        p.appendChild(el(doc, 'strong', 'display:block;font-size:15px', d.name));
        if (d.does) p.appendChild(el(doc, 'div', 'color:var(--text-muted,#aaa);margin-top:2px', d.does));
        function section(title, rows, dir) {
            p.appendChild(el(doc, 'div', 'margin-top:10px;font-weight:600;color:var(--apk-accent,#f4902c)', title));
            if (!rows.length) { p.appendChild(el(doc, 'div', 'color:var(--text-muted,#aaa)', 'None.')); return; }
            var ul = el(doc, 'ul', 'margin:2px 0 0 18px;padding:0');
            rows.forEach(function (r) {
                var where = r[dir] || r.topic || '';
                var li = el(doc, 'li', 'margin:2px 0');
                li.appendChild(el(doc, 'span', 'font-weight:600', String(r.name || r.topic || '?')));
                if (where) li.appendChild(el(doc, 'span', '', (dir === 'how' ? ': ' : dir === 'from' ? ' ← ' : ' → ') + where));
                if (r.topic && r[dir]) li.appendChild(el(doc, 'code', 'display:block;font-size:11px;color:var(--text-muted,#aaa)', r.topic));
                ul.appendChild(li);
            });
            p.appendChild(ul);
        }
        section('Inputs — what it reads', d.inputs, 'from');
        section('Outputs — what it writes', d.outputs, 'to');
        section('Controls — what you can do', d.controls, 'how');
        if (d.problems.length) {
            p.appendChild(el(doc, 'div', 'margin-top:10px;font-weight:600;color:var(--apk-accent,#f4902c)', 'If something goes wrong'));
            d.problems.forEach(function (pr) {
                var det = el(doc, 'details', 'margin:3px 0');
                det.appendChild(el(doc, 'summary', 'cursor:pointer', pr.title));
                var ol = el(doc, 'ol', 'margin:2px 0 0 18px;padding:0');
                pr.fix.forEach(function (s) { ol.appendChild(el(doc, 'li', '', s)); });
                det.appendChild(el(doc, 'div', 'color:var(--text-muted,#aaa)', pr.cause));
                det.appendChild(ol);
                p.appendChild(det);
            });
        }
        p.appendChild(el(doc, 'div', 'margin-top:10px;font-size:11px;color:var(--text-muted,#aaa)', 'F1 opens and closes this. Esc closes.'));
        (doc.body || doc.documentElement).appendChild(p);
        return true;
    }

    var api = {
        PROTOCOL: PROTOCOL,
        TRUST_MINUTES: TRUST_MINUTES,
        problem: problem,
        explain: explain,
        problemText: problemText,
        showProblem: showProblem,
        guard: guard,
        fetchJson: fetchJson,
        describe: describe,
        described: null,
        help: toggleHelp,
        FALLBACK_PROBLEMS: FALLBACK_PROBLEMS,
        connectHost: connectHost,
        contracts: contracts,
        bus: bus,
        discovered: discovered,
        createDiscovery: createDiscovery,
        discoveredPanel: discoveredPanel,
        discoveredConfig: discoveredConfig,
        thingRow: thingRow,
        thingIdentity: thingIdentity,
        DISCOVERED_COLUMNS: DISCOVERED_COLUMNS,
        interfaces: interfaces,
        interfacesTable: tableRows,
        inheritTheme: inheritTheme,
        macIn: macIn,
        esc: esc
    };
    root.APKSoftapp = api;
    if (root.APK_SOFTAPP_GUARD !== false) guard();
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
