(function () {
  'use strict';
  if (window.__llmod) { try { window.__llmod.mount(); } catch (e) {} return; }

  var HOST_ID = 'llmod-host';
  var RX  = /₦\s?(\d[\d,]*(?:\.\d+)?)/;
  var RXG = /₦\s?(\d[\d,]*(?:\.\d+)?)/g;
  var M = window.__llmod = {
    version: '1.0',
    target: 1e12,
    force: true,
    mode: 'balance',
    patchSocket: false,
    autoFarm: false,
    farmWords: ['work', 'earn', 'collect', 'claim', 'shift', 'deliver', 'study', 'train', 'sleep'],
    log: [], ui: {}
  };

  function parseMoney(s) { var m = RX.exec(String(s || '')); return m ? parseFloat(m[1].replace(/,/g, '')) : 0; }
  function fmt(n) { return '₦' + Math.round(n).toLocaleString('en-NG'); }

  var pending = false;
  function textNodes() {
    var out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      if (n.parentElement && n.parentElement.closest('#' + HOST_ID)) continue;
      var t = n.nodeValue;
      if (t && t.indexOf('₦') !== -1 && RX.test(t)) out.push(n);
    }
    return out;
  }
  function paint() {
    pending = false;
    if (!M.force || !document.body) return;
    var want = fmt(M.target), list = textNodes();
    if (M.mode === 'balance' && list.length) {
      var max = 0;
      list.forEach(function (n) { var v = parseMoney(n.nodeValue); if (v > max) max = v; });
      list = list.filter(function (n) { return parseMoney(n.nodeValue) === max; });
    }
    list.forEach(function (n) {
      var next = n.nodeValue.replace(RXG, want);
      if (next !== n.nodeValue) n.nodeValue = next;
    });
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(paint); } }

  function rewriteData(data) {
    if (typeof data !== 'string') return data;
    var c = data.trim().charAt(0);
    if (c !== '{' && c !== '[') return data;
    var j; try { j = JSON.parse(data); } catch (e) { return data; }
    var hit = false;
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || d > 6) return;
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (typeof v === 'number' && /^(money|balance|naira|cash|wallet|ngn|kudi|bank|networth)$/i.test(k)) {
          o[k] = M.target; hit = true;
        } else if (v && typeof v === 'object') walk(v, d + 1);
      });
    })(j, 0);
    return hit ? JSON.stringify(j) : data;
  }
  function patchSocket() {
    if (window.__llmodWs || !M.patchSocket) return;
    var Native = window.WebSocket;
    function Patched(url, proto) {
      var ws = proto ? new Native(url, proto) : new Native(url);
      var add = ws.addEventListener.bind(ws);
      function wrap(fn) {
        return function (ev) {
          if (!fn) return;
          var d = rewriteData(ev.data);
          if (d === ev.data) return fn.call(ws, ev);
          return fn.call(ws, { type: 'message', data: d, target: ws, currentTarget: ws, timeStamp: ev.timeStamp });
        };
      }
      ws.addEventListener = function (t, fn, o) { return add(t, t === 'message' ? wrap(fn) : fn, o); };
      var onm = null;
      Object.defineProperty(ws, 'onmessage', {
        get: function () { return onm; },
        set: function (fn) { onm = fn; add('message', wrap(fn)); }
      });
      return ws;
    }
    Patched.prototype = Native.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { Patched[k] = Native[k]; });
    window.WebSocket = Patched;
    window.__llmodWs = true;
  }

  function netLog(dir, url, data) {
    M.log.push({ t: Date.now(), dir: dir, url: url, data: String(data).slice(0, 4000) });
    if (M.log.length > 400) M.log.shift();
  }
  function installSniffer() {
    if (window.__llmodSniff) return;
    window.__llmodSniff = true;
    var f = window.fetch;
    if (f) window.fetch = function () {
      var a = arguments, url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
      return f.apply(this, a).then(function (res) {
        try { res.clone().text().then(function (t) { netLog('fetch>', url, t); }); } catch (e) {}
        return res;
      });
    };
    var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) {
      var x = this;
      x.addEventListener('load', function () { netLog('xhr>', x.__u, x.responseText || ''); });
      if (b) netLog('xhr<', x.__u, b);
      return XS.apply(this, arguments);
    };
    var WS = window.WebSocket;
    window.WebSocket = function (u, p) {
      var ws = p ? new WS(u, p) : new WS(u);
      netLog('ws', String(u), 'connect');
      ws.addEventListener('message', function (e) { netLog('ws<', '', e.data); });
      return ws;
    };
    window.WebSocket.prototype = WS.prototype;
  }

  function probe() {
    var found = [], seen = new Set();
    var KEYS = /^(money|balance|naira|cash|wallet|ngn|kudi|bank|networth|coins?|credit)$/i;
    function scan(o, path, d) {
      if (!o || typeof o !== 'object' || seen.has(o) || d > 5) return;
      seen.add(o);
      for (var k in o) {
        var v; try { v = o[k]; } catch (e) { continue; }
        if (typeof v === 'number' && KEYS.test(k) && found.length < 60) found.push({ path: path + '.' + k, value: v });
        else if (v && typeof v === 'object') scan(v, path + '.' + k, d + 1);
      }
    }
    var roots = [document.body, document.body && document.body.firstElementChild];
    var fiber = null;
    for (var i = 0; i < roots.length && !fiber; i++) {
      var el = roots[i]; if (!el) continue;
      var k = Object.keys(el).filter(function (x) {
        return x.indexOf('__reactFiber$') === 0 || x.indexOf('__reactContainer$') === 0;
      })[0];
      if (k) fiber = el[k];
    }
    if (fiber) {
      while (fiber.return) fiber = fiber.return;
      var n = 0;
      (function walk(node) {
        if (!node || n > 4000) return; n++;
        try { if (node.memoizedProps) scan(node.memoizedProps, 'props', 0); } catch (e) {}
        try { if (node.memoizedState) scan(node.memoizedState, 'state', 0); } catch (e) {}
        walk(node.child); walk(node.sibling);
      })(fiber);
    }
    return found;
  }

  var HTML = [
    '<style>',
    ':host{all:initial}',
    '.wrap{position:fixed;top:calc(env(safe-area-inset-top,0px) + 58px);right:10px;z-index:2147483000;',
    'font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#16203c}',
    '.panel{width:240px;background:rgba(255,255,255,.97);border:1px solid rgba(22,32,60,.12);',
    'border-radius:16px;box-shadow:0 12px 40px rgba(22,32,60,.25);overflow:hidden}',
    '.hd{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#0F8A4F;color:#fff;font-weight:700}',
    '.hd .dot{width:7px;height:7px;border-radius:50%;background:#FFD45A}',
    '.hd button{margin-left:auto;background:transparent;border:0;color:#fff;font-size:15px;cursor:pointer}',
    '.bd{padding:10px;display:grid;gap:8px}',
    'label{display:block;font-weight:700;margin-bottom:3px}',
    'input[type=text],select{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid rgba(22,32,60,.2);',
    'border-radius:9px;font:600 12px inherit;background:#fff;color:#16203c}',
    '.row{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    'button.b{padding:7px 8px;border:0;border-radius:9px;background:#eef2f7;font-weight:700;cursor:pointer;color:#16203c}',
    'button.b.p{background:#0F8A4F;color:#fff}',
    '.toggle{display:flex;align-items:center;justify-content:space-between;gap:6px}',
    '.sw{width:34px;height:20px;border-radius:999px;background:#cfd7e3;position:relative;cursor:pointer;flex:0 0 auto;transition:.15s}',
    '.sw.on{background:#0F8A4F}.sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}',
    '.sw.on i{left:16px}',
    '.hint{color:#6b7688;font-size:10.5px}',
    '.min .bd{display:none}',
    '</style>',
    '<div class="wrap"><div class="panel">',
    '<div class="hd"><span class="dot"></span><span>LagosLife Mod</span><button id="min">-</button></div>',
    '<div class="bd">',
    '<div><label>Money override</label><input id="amt" type="text" value="1000000000000"></div>',
    '<div class="row"><button class="b p" id="apply">Apply</button><button class="b" id="off">Restore</button></div>',
    '<div><label>Patch scope</label><select id="mode">',
    '<option value="balance">Balance only</option><option value="all">Every amount</option></select></div>',
    '<div class="toggle"><span>Force money display</span><span class="sw on" id="swForce"><i></i></span></div>',
    '<div class="toggle"><span>Patch socket (exp.)</span><span class="sw" id="swSock"><i></i></span></div>',
    '<div class="toggle"><span>Auto-click actions</span><span class="sw" id="swFarm"><i></i></span></div>',
    '<div class="row"><button class="b" id="probe">Probe store</button><button class="b" id="dump">Copy log</button></div>',
    '<div class="hint">Ctrl+Shift+M toggles this panel.</div>',
    '</div></div></div>'
  ].join('');

  function mount() {
    if (document.getElementById(HOST_ID)) return;
    if (!document.body) { setTimeout(mount, 300); return; }
    var host = document.createElement('div');
    host.id = HOST_ID;
    var sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = HTML;
    document.documentElement.appendChild(host);
    M.ui.sh = sh;

    var $ = function (id) { return sh.getElementById(id); };
    var sw = function (el, on) { el.classList.toggle('on', !!on); };

    $('apply').onclick = function () {
      var v = parseFloat($('amt').value.replace(/[^\d.]/g, '')) || M.target;
      M.target = v; M.force = true; sw($('swForce'), true); schedule();
    };
    $('off').onclick = function () { M.force = false; location.reload(); };
    $('mode').onchange = function () { M.mode = this.value; schedule(); };
    $('swForce').onclick = function () { M.force = !M.force; sw(this, M.force); schedule(); };
    $('swSock').onclick = function () { M.patchSocket = !M.patchSocket; sw(this, M.patchSocket); patchSocket(); };
    $('swFarm').onclick = function () { M.autoFarm = !M.autoFarm; sw(this, M.autoFarm); };
    $('min').onclick = function () { sh.querySelector('.panel').classList.toggle('min'); };
    $('probe').onclick = function () {
      var r = probe(); console.log('[llmod] money candidates', r);
      alert('Found ' + r.length + ' candidate money field(s). See DevTools console.');
    };
    $('dump').onclick = function () {
      var txt = JSON.stringify(M.log, null, 1);
      console.log(txt);
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
      alert('Copied ' + M.log.length + ' network entries.');
    };
  }

  addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
      var p = M.ui.sh && M.ui.sh.querySelector('.panel'); if (p) p.classList.toggle('min');
    }
  });

  M.set = function (n) { M.target = n; M.force = true; schedule(); };
  M.off = function () { M.force = false; };
  M.on  = function () { M.force = true; schedule(); };
  M.mount = mount;

  function farm() {
    if (!M.autoFarm) return;
    var rx = new RegExp('\\b(' + M.farmWords.join('|') + ')\\b', 'i');
    var els = document.querySelectorAll('button,[role="button"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest('#' + HOST_ID) || el.disabled) continue;
      if (rx.test((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || ''))) { el.click(); return; }
    }
  }

  installSniffer();
  patchSocket();
  function boot() {
    if (!document.body) { setTimeout(boot, 300); return; }
    mount();
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true });
    schedule();
    setInterval(schedule, 1500);
    setInterval(function () { if (!document.getElementById(HOST_ID)) mount(); }, 3000);
    setInterval(farm, 1200);
  }
  boot();
})();
