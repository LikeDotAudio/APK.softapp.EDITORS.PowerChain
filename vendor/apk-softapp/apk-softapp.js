// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* apk-softapp.js — THE ONE CLIENT A SOFTAPP LOADS. window.APKSoftapp.

   One plain script (no build, no framework, no module) that gives a softapp the
   four things every imported editor used to write for itself:

     connectHost()  the CAD block bridge — cad.like.audio/host@1, the block
                    messages (EDITORS.CAD.Like.audio contract/host@1/,
                    src/shell/hostBridge/blockHost.ts). Replaces every
                    js/blockBridge.js and its private APK_*_BLOCK messages.
     contracts()    window.APKContracts — topic builders, presence rule, tokens.
     bus()          window.APKBus.connect(), once per page.
     discovered()   the things the bus knows about (scanners, agents, presence),
                    merged by identity (MAC / serial, never IP), alive or dead.
     interfaces()   the Interface Map's Interfaces table (Gui/Interfaces/Map/…).

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
   15 s even when the bus is quiet, so trust decays on screen.

   THE INTERFACES TABLE

     const t = await APKSoftapp.interfaces({ onChange(rows, headers) { … } });
     t.rows() → [{ interface, kind, family, domain, carries, in, out, on, why }]
   from the retained Gui/Interfaces/Map/Interfaces panel; { url } instead reads
   an Interfaces.json (OcaBin) file and takes its Interfaces block.

   ─────────────────────────────────────────────────────────────────────────
   A TABLE is APKTable (apk-table.js), never hand-built:

     APKTable.create(hostEl, { id: 'my-ports', columns: [{ key: 'name', label: 'Name' }, …],
                               rows, onEdit(row, key, value) {}, onDelete(i) {} });

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
        var hosts = {};        // proto/kind/id -> { proto, kind, id, fields }
        var agents = {};       // node -> { node, target, rows: {section/key: row}, status }
        var presence = {};     // proto/id -> { proto, id, doc }
        var seen = {};         // protocols seen

        function protocol(seg, text) {
            var proto = seg[0];
            if (!proto) return false;
            seen[proto] = true;
            var d = seg.indexOf('Device');
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
                var hostKey = Object.keys(hosts).filter(function (h) { return hosts[h].id === p.id; })[0];
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

    function idle(reason) {
        return { ok: false, reason: reason, things: function () { return []; }, rows: function () { return []; }, stop: function () {} };
    }

    /* Subscribes through bus(); resolves a handle at once (things() fills as retained messages land). */
    function discovered(opts) {
        opts = opts || {};
        var C = contracts();
        var linkP = opts.bus ? Promise.resolve(opts.bus) : (C ? bus() : Promise.resolve(null));
        return linkP.then(function (link) {
            if (!C || !link) return idle(noBus(C));
            var model = createDiscovery({
                roots: rootsOf(C), presenceActive: C.discoveryPresenceActive,
                trustMinutes: opts.trustMinutes, now: opts.now
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
                    try { offs.push(link.subscribe(C.Topics.discoveryWildcard(p), feed)); } catch (e) { /* not a valid segment */ }
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
            if (typeof root.fetch !== 'function') return Promise.resolve(idle('No fetch in this page.'));
            return root.fetch(opts.url, { cache: 'no-store' })
                .then(function (r) { if (!r.ok) throw new Error(r.status + ' from ' + opts.url); return r.json(); })
                .then(function (doc) { return take(doc) ? handle({}) : idle(opts.url + ' holds no Interfaces table.'); })
                .catch(function (e) { return idle('Could not read ' + opts.url + ' (' + e.message + ').'); });
        }
        var C = contracts();
        var linkP = opts.bus ? Promise.resolve(opts.bus) : (C ? bus() : Promise.resolve(null));
        return linkP.then(function (link) {
            if (!C || !link) return idle(noBus(C));
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

    var api = {
        PROTOCOL: PROTOCOL,
        TRUST_MINUTES: TRUST_MINUTES,
        connectHost: connectHost,
        contracts: contracts,
        bus: bus,
        discovered: discovered,
        createDiscovery: createDiscovery,
        interfaces: interfaces,
        interfacesTable: tableRows,
        inheritTheme: inheritTheme,
        macIn: macIn,
        esc: esc
    };
    root.APKSoftapp = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
