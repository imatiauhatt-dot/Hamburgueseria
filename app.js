(function () {
  'use strict';

  var fmt = new Intl.NumberFormat('es-AR');
  function money(n) { return '$' + fmt.format(Math.round(n || 0)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- Estado ---------- */
  var S = null;   // menú publicado (menu.json)
  var D = null;   // borrador del dueño
  var cart = [];   // líneas: { key, id, out: [ingredientes sin], q }
  var ask = { id: null, custom: false, out: [] };
  var isAdmin = false;
  var tab = 'pedir';
  var lastOrder = null;

  /* ---------- Teléfonos ---------- */
  function waNumber(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    d = d.replace(/^00/, '');
    if (d.indexOf('54') === 0) {
      if (d.indexOf('549') !== 0 && d.length === 12) d = '549' + d.slice(2);
      return d;
    }
    d = d.replace(/^0/, '');
    if (d.length === 10) return '549' + d;
    return d;
  }
  function phoneOk(raw) { return waNumber(raw).length >= 11; }
  function phoneShow(raw) {
    var n = waNumber(raw);
    return n ? '+' + n : '';
  }

  /* ---------- Conexión con GitHub (guardar el menú) ---------- */
  function ghCfg() {
    try { return JSON.parse(lsGet('gh_cfg') || '{}'); } catch (e) { return {}; }
  }
  function ghSet(k, v) {
    var c = ghCfg();
    c[k] = v;
    lsSet('gh_cfg', JSON.stringify(c));
  }
  function utf8b64(s) {
    var bytes = new TextEncoder().encode(s);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  /* ---------- Estructura fija ---------- */
  var app = $('#app');
  app.innerHTML =
    '<header class="band"><div class="in" id="head"></div></header>' +
    '<nav class="tabs" id="tabs" hidden><div class="in" role="tablist">' +
      '<button class="tab" role="tab" data-tab="pedir" id="tab-pedir">Vista del cliente</button>' +
      '<button class="tab" role="tab" data-tab="pedidos" id="tab-pedidos">Pedidos</button>' +
      '<button class="tab" role="tab" data-tab="menu" id="tab-menu">Menú y local</button>' +
      '<span class="tag">Panel del dueño</span>' +
    '</div></nav>' +
    '<main><div class="in" id="view"></div></main>' +
    '<div class="cartbar" id="cartbar" hidden><a class="btn primary" href="#ticket" id="cartGo"><span id="cartGoN">Ver mi pedido</span><span id="cartGoT" class="price"></span></a></div>' +
    '<div class="savebar" id="savebar" hidden></div>' +
    '<div class="toast" id="toast" hidden role="status"></div>';

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function renderHead() {
    var s = S.shop;
    document.title = s.name || 'Menú y pedidos';
    $('#head').innerHTML =
      '<div class="brand"><div class="eyebrow">Pedidos online</div><h1>' + esc(s.name) + '</h1>' +
      (s.hours ? '<p class="hours">' + esc(s.hours) + '</p>' : '') + '</div>' +
      '<span class="pill' + (s.open ? '' : ' closed') + '"><i></i>' + (s.open ? 'Recibiendo pedidos' : 'Cerrado por ahora') + '</span>';
  }

  /* ---------- Vista del cliente ---------- */
  function cartLines() {
    var out = [];
    cart.forEach(function (c) {
      var it = S.items.filter(function (x) { return x.id === c.id; })[0];
      if (it && it.on && c.q > 0) out.push({ key: c.key, id: it.id, name: it.name, price: it.price, q: c.q, out: c.out });
    });
    return out;
  }
  function qtyOf(id) {
    return cart.reduce(function (s, c) { return c.id === id ? s + c.q : s; }, 0);
  }
  function addToCart(id, outList) {
    var o = outList.slice().sort();
    var key = id + '|' + o.join(',');
    var f = cart.filter(function (c) { return c.key === key; })[0];
    if (f) f.q = Math.min(f.q + 1, 50);
    else cart.push({ key: key, id: id, out: o, q: 1 });
  }
  function lineName(l) {
    return l.name + (l.out && l.out.length ? ' (sin ' + l.out.join(', ') + ')' : '');
  }
  function resetAsk() { ask = { id: null, custom: false, out: [] }; }
  function totalOf(lines) { return lines.reduce(function (s, l) { return s + l.q * l.price; }, 0); }

  function renderCustomer() {
    var view = $('#view');
    view.innerHTML =
      '<div id="banner"></div>' +
      '<div class="shop">' +
        '<section id="menu" aria-label="Menú"></section>' +
        '<aside class="ticket" id="ticket" aria-label="Tu pedido">' +
          '<div class="eyebrow">Comanda</div><h2>Tu pedido</h2>' +
          '<div class="lines" id="tLines"></div>' +
          '<div class="sum"><span>Total</span><span id="tTotal">$0</span></div>' +
          '<label class="field" for="fName"><span>Tu nombre</span><input type="text" id="fName" autocomplete="name"></label>' +
          '<label class="field" for="fPhone"><span>Tu WhatsApp</span><input type="tel" id="fPhone" inputmode="tel" autocomplete="tel" placeholder="3855 123456"><small>Con código de área, sin 0 y sin 15.</small></label>' +
          '<div class="legend" id="modeLegend">¿Cómo lo recibís?</div>' +
          '<div class="modes" role="radiogroup" aria-labelledby="modeLegend">' +
            '<label class="mode"><input type="radio" name="mode" id="mRetiro" value="retiro" checked><span>Retiro en el local</span></label>' +
            '<label class="mode"><input type="radio" name="mode" id="mEnvio" value="envio"><span>Envío a domicilio</span></label>' +
          '</div>' +
          '<label class="field" for="fAddr" id="addrWrap" hidden><span>Dirección de entrega</span><input type="text" id="fAddr" autocomplete="street-address"></label>' +
          '<label class="field" for="fNote"><span>Aclaraciones (opcional)</span><textarea id="fNote"></textarea></label>' +
          '<div class="actions">' +
            '<a class="btn primary block" id="btnWa" href="#" target="_blank" rel="noopener">Enviar pedido por WhatsApp</a>' +
            '<button class="btn block" id="btnCopy" type="button">Copiar pedido</button>' +
          '</div>' +
          '<div class="hint" id="tHint"></div>' +
          '<div class="sent" id="tSent" hidden></div>' +
          '<details class="pre"><summary>Ver el texto que se envía</summary><textarea id="msgPreview" readonly></textarea></details>' +
        '</aside>' +
      '</div>';

    $('#fName').value = lsGet('cli_name') || '';
    $('#fPhone').value = lsGet('cli_phone') || '';
    if (lsGet('cli_mode') === 'envio') { $('#mEnvio').checked = true; }
    $('#fAddr').value = lsGet('cli_addr') || '';
    syncMode();
    renderBanner();
    renderMenu();
    updateTicket();

    $('#menu').addEventListener('click', onMenuClick);
    $('#menu').addEventListener('change', function (e) {
      var ix = e.target.getAttribute('data-ing');
      if (ix === null) return;
      var it = S.items.filter(function (x) { return x.id === ask.id; })[0];
      if (!it) return;
      var name = it.ing[Number(ix)];
      var at = ask.out.indexOf(name);
      if (e.target.checked && at >= 0) ask.out.splice(at, 1);
      if (!e.target.checked && at < 0) ask.out.push(name);
    });
    $('#tLines').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-k]');
      if (!b) return;
      var c = cart.filter(function (x) { return x.key === b.getAttribute('data-k'); })[0];
      if (!c) return;
      c.q = Math.min(c.q + Number(b.getAttribute('data-d')), 50);
      if (c.q <= 0) cart = cart.filter(function (x) { return x !== c; });
      $('#tSent').hidden = true;
      renderMenu();
      updateTicket();
    });
    $('#ticket').addEventListener('input', function () { saveForm(); updateTicket(); });
    $('#ticket').addEventListener('change', function () { syncMode(); saveForm(); updateTicket(); });
    $('#btnWa').addEventListener('click', onSend);
    $('#btnCopy').addEventListener('click', onCopy);
  }

  function syncMode() {
    var envio = $('#mEnvio').checked;
    $('#addrWrap').hidden = !envio;
  }
  function saveForm() {
    lsSet('cli_name', $('#fName').value);
    lsSet('cli_phone', $('#fPhone').value);
    lsSet('cli_mode', $('#mEnvio').checked ? 'envio' : 'retiro');
    lsSet('cli_addr', $('#fAddr').value);
  }

  function renderBanner() {
    var b = $('#banner');
    var html = '';
    if (!S.shop.open) {
      html += '<div class="notice warn"><strong>Ahora no estamos recibiendo pedidos.</strong> ' + esc(S.shop.hours || 'Volvé a mirar más tarde.') + '</div>';
    }
    if (isAdmin && !phoneOk(S.shop.phone)) {
      html += '<div class="notice warn"><strong>Falta el WhatsApp del local.</strong> Cargalo en la pestaña “Menú y local” para que los clientes puedan enviar pedidos.</div>';
    } else if (!phoneOk(S.shop.phone)) {
      html += '<div class="notice warn">El local todavía no cargó su WhatsApp, por ahora no se pueden enviar pedidos.</div>';
    }
    if (isAdmin && S.sample) {
      html += '<div class="notice"><strong>Estos productos son de ejemplo.</strong> Cambiá nombres y precios en “Menú y local” antes de compartir el link.</div>';
    }
    b.innerHTML = html;
  }

  function renderMenu() {
    var items = S.items.filter(function (i) { return i.on; });
    var cats = [];
    items.forEach(function (i) { if (cats.indexOf(i.cat) < 0) cats.push(i.cat); });
    if (!items.length) {
      $('#menu').innerHTML = '<p class="empty">Hoy todavía no hay productos habilitados. Volvé en un rato.</p>';
      return;
    }
    $('#menu').innerHTML = cats.map(function (c) {
      return '<section class="cat"><h2>' + esc(c) + '</h2>' + items.filter(function (i) { return i.cat === c; }).map(function (i) {
        var q = qtyOf(i.id);
        var control = !S.shop.open
          ? ''
          : '<button type="button" class="btn small" data-act="add" data-id="' + esc(i.id) + '">Agregar</button>';
        var inCart = q > 0 ? '<span class="incart">' + q + ' en tu pedido</span>' : '';
        return '<div class="item"><div><h3>' + esc(i.name) + '</h3>' + (i.desc ? '<p class="desc">' + esc(i.desc) + '</p>' : '') + '</div>' +
          '<div class="side"><span class="price">' + money(i.price) + '</span>' + control + inCart + '</div>' +
          (ask.id === i.id ? askPanel(i) : '') + '</div>';
      }).join('') + '</section>';
    }).join('');
  }

  function askPanel(it) {
    if (!ask.custom) {
      return '<div class="ask"><p>¿Querés personalizarlo?</p><div class="askrow">' +
        '<button type="button" class="btn small primary" data-act="plain">Así está bien</button>' +
        '<button type="button" class="btn small" data-act="custom">Personalizar</button>' +
        '<button type="button" class="btn small" data-act="cancel">Cancelar</button></div></div>';
    }
    return '<div class="ask"><p>Destildá lo que no quieras que lleve.</p><div class="ings">' +
      it.ing.map(function (g, ix) {
        return '<label class="ing" for="ing-' + esc(it.id) + '-' + ix + '"><input type="checkbox" id="ing-' + esc(it.id) + '-' + ix + '" data-ing="' + ix + '"' + (ask.out.indexOf(g) < 0 ? ' checked' : '') + '><span>' + esc(g) + '</span></label>';
      }).join('') + '</div><div class="askrow">' +
      '<button type="button" class="btn small primary" data-act="addcustom">Agregar al pedido</button>' +
      '<button type="button" class="btn small" data-act="cancel">Cancelar</button></div></div>';
  }

  function onMenuClick(e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'add') {
      var id = b.getAttribute('data-id');
      var it = S.items.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      if (it.ing.length) ask = { id: id, custom: false, out: [] };
      else { resetAsk(); addToCart(id, []); }
    } else if (act === 'plain') {
      addToCart(ask.id, []); resetAsk();
    } else if (act === 'custom') {
      ask.custom = true;
    } else if (act === 'addcustom') {
      addToCart(ask.id, ask.out); resetAsk();
    } else if (act === 'cancel') {
      resetAsk();
    }
    $('#tSent').hidden = true;
    renderMenu();
    updateTicket();
  }

  function form() {
    return {
      name: $('#fName').value.trim(),
      phone: $('#fPhone').value.trim(),
      envio: $('#mEnvio').checked,
      addr: $('#fAddr').value.trim(),
      note: $('#fNote').value.trim()
    };
  }

  function buildMessage() {
    var f = form();
    var lines = cartLines();
    var out = ['Hola! Quiero hacer un pedido en ' + S.shop.name + ':', ''];
    lines.forEach(function (l) { out.push(l.q + 'x ' + lineName(l) + ' - ' + money(l.q * l.price)); });
    out.push('');
    out.push('Total: ' + money(totalOf(lines)));
    out.push('Nombre: ' + f.name);
    out.push('Teléfono: ' + f.phone);
    out.push('Modalidad: ' + (f.envio ? 'Envío a domicilio' : 'Retiro en el local'));
    if (f.envio) out.push('Dirección: ' + f.addr);
    if (f.note) out.push('Aclaraciones: ' + f.note);
    return out.join('\n');
  }

  function missing() {
    var f = form();
    var m = [];
    if (!S.shop.open) m.push('El local no está recibiendo pedidos ahora.');
    if (!cartLines().length) m.push('Agregá al menos un producto.');
    if (!f.name) m.push('Escribí tu nombre.');
    if (!phoneOk(f.phone)) m.push('Completá tu WhatsApp con código de área.');
    if (f.envio && !f.addr) m.push('Escribí la dirección de entrega.');
    if (!phoneOk(S.shop.phone)) m.push('El local todavía no cargó su WhatsApp.');
    return m;
  }

  function updateTicket() {
    var lines = cartLines();
    var total = totalOf(lines);
    var count = lines.reduce(function (s, l) { return s + l.q; }, 0);
    $('#tLines').innerHTML = lines.length
      ? lines.map(function (l) {
          var k = esc(l.key);
          return '<div class="ln ctl"><span>' + l.q + 'x</span><span>' + esc(l.name) + (l.out.length ? '<small class="mods">sin ' + esc(l.out.join(', ')) + '</small>' : '') + '</span><span>' + money(l.q * l.price) + '</span>' +
            '<span class="lstep"><button type="button" data-k="' + k + '" data-d="-1" aria-label="Quitar uno de ' + esc(l.name) + '">−</button><button type="button" data-k="' + k + '" data-d="1" aria-label="Agregar uno de ' + esc(l.name) + '">+</button></span></div>';
        }).join('')
      : '<p class="none">Todavía no agregaste nada.</p>';
    $('#tTotal').textContent = money(total);
    var miss = missing();
    var wa = $('#btnWa');
    var ok = miss.length === 0;
    wa.setAttribute('aria-disabled', ok ? 'false' : 'true');
    $('#btnCopy').disabled = !lines.length;
    if (ok) {
      wa.setAttribute('href', 'https://wa.me/' + waNumber(S.shop.phone) + '?text=' + encodeURIComponent(buildMessage()));
    } else {
      wa.setAttribute('href', '#');
    }
    $('#tHint').innerHTML = ok ? '' : '<ul>' + miss.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    $('#msgPreview').value = lines.length ? buildMessage() : '';
    var bar = $('#cartbar');
    bar.hidden = tab !== 'pedir' || count === 0;
    $('#cartGoN').textContent = 'Ver mi pedido (' + count + ')';
    $('#cartGoT').textContent = money(total);
  }

  function onSend(e) {
    if ($('#btnWa').getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    var s = $('#tSent');
    s.hidden = false;
    s.textContent = 'Se abrió WhatsApp con tu pedido ya escrito. Tocá “Enviar” allá para que le llegue al local (' + phoneShow(S.shop.phone) + '). Te van a responder por el mismo chat.';
  }
  function onCopy() {
    var text = buildMessage();
    var done = function () { toast('Pedido copiado. Pegalo en el chat del local.'); };
    var fallback = function () {
      var ta = $('#msgPreview');
      ta.closest('details').open = true;
      ta.focus();
      ta.select();
      toast('Tocá “copiar” sobre el texto seleccionado.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  /* ---------- Pedidos (dueño) ---------- */
  function toNum(s) { return Number(String(s).replace(/[.,]/g, '')) || 0; }

  function parseOrder(t) {
    var o = { lines: [], name: '', phone: '', envio: false, addr: '', note: '', total: 0 };
    // WhatsApp suele copiar marcas invisibles y espacios raros: se limpian antes de leer
    var clean = String(t || '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
      .replace(/[\u00A0\u202F\u2007]/g, ' ');
    clean.split(/\r?\n/).forEach(function (raw) {
      var l = raw.trim().replace(/^[•·*▪◦\-–—]\s+(?=\d+\s*[xX×])/, '');
      var m;
      if ((m = l.match(/(\d+)\s*[xX×]\s+(.+?)\s+[-–—−]\s*\$?\s*([\d.,]+)\s*$/))) {
        var q = +m[1], sub = toNum(m[3]);
        var nm = m[2].trim(), mods = '';
        var mm = nm.match(/^(.*?)\s*\(sin\s+(.+)\)$/i);
        if (mm) { nm = mm[1].trim(); mods = mm[2].trim(); }
        o.lines.push({ q: q, name: nm, mods: mods, sub: sub, price: q ? sub / q : sub });
      } else if ((m = l.match(/^Total:\s*\$\s*([\d.,]+)/i))) o.total = toNum(m[1]);
      else if ((m = l.match(/^Nombre:\s*(.*)$/i))) o.name = m[1].trim();
      else if ((m = l.match(/^Tel[eé]fono:\s*(.*)$/i))) o.phone = m[1].trim();
      else if ((m = l.match(/^Modalidad:\s*(.*)$/i))) o.envio = /env[ií]o/i.test(m[1]);
      else if ((m = l.match(/^Direcci[oó]n:\s*(.*)$/i))) o.addr = m[1].trim();
      else if ((m = l.match(/^Aclaraciones:\s*(.*)$/i))) o.note = m[1].trim();
    });
    if (!o.total) o.total = o.lines.reduce(function (s, x) { return s + x.sub; }, 0);
    return o;
  }

  function findItem(name) {
    var n = String(name).toLowerCase();
    for (var i = 0; i < S.items.length; i++) if (S.items[i].name.toLowerCase() === n) return S.items[i];
    return null;
  }

  function getHist() {
    try { return JSON.parse(lsGet('hist') || '[]'); } catch (e) { return []; }
  }
  function addHist(entry) {
    var h = getHist();
    h.unshift(entry);
    lsSet('hist', JSON.stringify(h.slice(0, 60)));
  }

  function renderOrders() {
    $('#view').innerHTML =
      '<section class="panel"><h2>Pedidos por WhatsApp</h2>' +
        '<p>Cuando llegue un pedido al WhatsApp del local, copiá el mensaje completo y pegalo acá. Vas a ver el detalle, si algo ya no está habilitado, y armás la respuesta para el cliente con un toque.</p>' +
        '<label class="field" for="pasteBox"><span>Mensaje del cliente</span><textarea id="pasteBox" rows="6" placeholder="Pegá acá el pedido que te mandó el cliente"></textarea></label>' +
        '<button class="btn primary" id="btnRead" type="button">Leer pedido</button>' +
        '<div id="review"></div>' +
      '</section>' +
      '<section class="panel"><h2>Respondidos hoy</h2><div id="hist"></div></section>';
    $('#btnRead').addEventListener('click', onRead);
    renderHist();
  }

  function renderHist() {
    var today = new Date().toDateString();
    var h = getHist().filter(function (x) { return new Date(x.t).toDateString() === today; });
    var el = $('#hist');
    if (!h.length) { el.innerHTML = '<p class="empty" style="padding:.5rem 0">Todavía no respondiste ningún pedido hoy.</p>'; return; }
    var approved = h.filter(function (x) { return x.ok; });
    var sum = approved.reduce(function (s, x) { return s + (x.total || 0); }, 0);
    el.innerHTML = '<p style="margin-bottom:.5rem;color:var(--muted)">' + approved.length + ' aprobados, suman ' + money(sum) + '.</p><div class="hist">' + h.map(function (x) {
      var d = new Date(x.t);
      var hh = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      return '<div class="h"><span class="price">' + hh + '</span><span>' + esc(x.name || 'Sin nombre') + ' · ' + (x.envio ? 'envío' : 'retiro') + ' · ' + money(x.total) + '</span><span class="st ' + (x.ok ? 'ok' : 'no') + '">' + (x.ok ? 'Aprobado' : 'Rechazado') + '</span></div>';
    }).join('') + '</div><div class="bulk"><button class="btn small" id="btnClearHist" type="button">Borrar el historial de este dispositivo</button></div>';
    $('#btnClearHist').addEventListener('click', function () { lsSet('hist', '[]'); renderHist(); });
  }

  function onRead() {
    var o = parseOrder($('#pasteBox').value);
    var box = $('#review');
    if (!o.lines.length) {
      lastOrder = null;
      box.innerHTML = '<div class="notice warn" style="margin-top:1rem">No encontré productos en ese texto. Pegá el mensaje tal como llegó, con las líneas del tipo “2x Nombre - $1.000”.</div>';
      return;
    }
    lastOrder = o;
    var bad = 0;
    var rows = o.lines.map(function (l) {
      var it = findItem(l.name);
      var off = !it || !it.on;
      if (off) bad++;
      return '<div class="ln' + (off ? ' bad' : '') + '"><span>' + l.q + 'x</span><span>' + esc(l.name) + (off ? ' (no está habilitado ahora)' : '') + (l.mods ? '<small class="mods">sin ' + esc(l.mods) + '</small>' : '') + '</span><span>' + money(l.sub) + '</span></div>';
    }).join('');
    box.innerHTML =
      '<div class="paper"><div class="eyebrow">Comanda recibida</div>' +
        '<div class="who"><span>Nombre: ' + esc(o.name || '-') + '</span><span>Teléfono: ' + esc(o.phone || '-') + (phoneOk(o.phone) ? '' : ' (revisalo)') + '</span><span>' + (o.envio ? 'Envío a domicilio: ' + esc(o.addr || 'sin dirección') : 'Retiro en el local') + '</span>' + (o.note ? '<span>Aclaraciones: ' + esc(o.note) + '</span>' : '') + '</div>' +
        '<div class="lines">' + rows + '</div><div class="sum" style="margin-bottom:0"><span>Total</span><span>' + money(o.total) + '</span></div></div>' +
      (bad ? '<div class="notice warn">Hay ' + bad + (bad === 1 ? ' producto' : ' productos') + ' que hoy no tenés habilitados. Podés rechazar el pedido o aprobarlo igual.</div>' : '') +
      '<div class="decide" role="radiogroup" aria-label="Decisión">' +
        '<label class="mode"><input type="radio" name="dec" id="dOk" value="ok" checked><span>Aprobar</span></label>' +
        '<label class="mode"><input type="radio" name="dec" id="dNo" value="no"><span>Rechazar</span></label>' +
      '</div>' +
      '<div id="okFields" class="grid2">' +
        '<label class="field" for="fEta"><span>Tiempo estimado</span><select id="fEta"><option>15 minutos</option><option selected>30 minutos</option><option>45 minutos</option><option>1 hora</option><option>1 hora y media</option></select></label>' +
        (o.envio ? '<label class="field" for="fFee"><span>Costo de envío (opcional)</span><input type="number" id="fFee" inputmode="numeric" min="0" placeholder="0"></label>' : '') +
      '</div>' +
      '<div id="noFields" class="grid2" hidden>' +
        '<label class="field" for="fWhy"><span>Motivo</span><select id="fWhy"><option>Nos quedamos sin alguno de los productos</option><option>Ya cerramos por hoy</option><option>No llegamos a esa dirección</option><option>Tenemos mucha demora y no llegamos a tiempo</option></select></label>' +
      '</div>' +
      '<label class="field" for="fExtra"><span>Algo más para decirle (opcional)</span><input type="text" id="fExtra"></label>' +
      '<div class="actions">' +
        '<a class="btn primary" id="btnReply" href="#" target="_blank" rel="noopener">Responder por WhatsApp</a>' +
        '<button class="btn" id="btnReplyCopy" type="button">Copiar respuesta</button>' +
      '</div><div class="hint" id="replyHint"></div>' +
      '<details class="pre"><summary>Ver la respuesta</summary><textarea id="replyPreview" readonly></textarea></details>';
    box.addEventListener('input', updateReply);
    box.addEventListener('change', updateReply);
    $('#btnReply').addEventListener('click', onReplyClick);
    $('#btnReplyCopy').addEventListener('click', onReplyCopy);
    updateReply();
  }

  function replyText() {
    var o = lastOrder;
    var ok = $('#dOk').checked;
    var name = o.name || '';
    var extra = ($('#fExtra').value || '').trim();
    var out;
    if (ok) {
      var fee = o.envio && $('#fFee') ? Math.max(0, Number($('#fFee').value) || 0) : 0;
      out = ['Hola' + (name ? ' ' + name : '') + '! Tu pedido está confirmado.', ''];
      o.lines.forEach(function (l) { out.push(l.q + 'x ' + l.name + (l.mods ? ' (sin ' + l.mods + ')' : '')); });
      out.push('');
      if (fee) {
        out.push('Pedido: ' + money(o.total));
        out.push('Envío: ' + money(fee));
        out.push('Total a pagar: ' + money(o.total + fee));
      } else {
        out.push('Total: ' + money(o.total));
      }
      out.push('Demora estimada: ' + $('#fEta').value + '.');
      out.push(o.envio ? 'Lo llevamos a ' + (o.addr || 'tu dirección') + '.' : 'Lo retirás en el local.');
      if (extra) out.push(extra);
      out.push('Gracias por elegir ' + S.shop.name + '!');
    } else {
      out = ['Hola' + (name ? ' ' + name : '') + '! No pudimos tomar tu pedido: ' + $('#fWhy').value.charAt(0).toLowerCase() + $('#fWhy').value.slice(1) + '.'];
      if (extra) out.push(extra);
      out.push('Si querés, armalo de nuevo y te lo confirmamos enseguida.');
    }
    return out.join('\n');
  }

  function updateReply() {
    if (!lastOrder) return;
    var ok = $('#dOk').checked;
    $('#okFields').hidden = !ok;
    $('#noFields').hidden = ok;
    var text = replyText();
    $('#replyPreview').value = text;
    var a = $('#btnReply');
    if (phoneOk(lastOrder.phone)) {
      a.setAttribute('aria-disabled', 'false');
      a.setAttribute('href', 'https://wa.me/' + waNumber(lastOrder.phone) + '?text=' + encodeURIComponent(text));
      $('#replyHint').textContent = '';
    } else {
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('href', '#');
      $('#replyHint').textContent = 'El teléfono del cliente no es válido. Copiá la respuesta y mandala a mano por el chat.';
    }
  }
  function onReplyClick(e) {
    if ($('#btnReply').getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    recordReply();
  }
  function recordReply() {
    var o = lastOrder;
    addHist({ t: Date.now(), name: o.name, total: o.total, envio: o.envio, ok: $('#dOk').checked });
    renderHist();
  }
  function onReplyCopy() {
    var text = replyText();
    var done = function () { recordReply(); toast('Respuesta copiada.'); };
    var fallback = function () {
      var ta = $('#replyPreview');
      ta.closest('details').open = true;
      ta.focus();
      ta.select();
      toast('Tocá “copiar” sobre el texto seleccionado.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* ---------- Menú y local (dueño) ---------- */
  function dirty() { return JSON.stringify(D) !== JSON.stringify(S); }

  function cats(list) {
    var c = [];
    list.forEach(function (i) { var k = (i.cat || '').trim() || 'Sin categoría'; if (c.indexOf(k) < 0) c.push(k); });
    return c;
  }

  function renderAdmin() {
    $('#view').innerHTML =
      '<section class="panel"><h2>Qué hay hoy</h2>' +
        '<p>Tocá un producto para sacarlo del menú o volver a ponerlo. Amarillo es lo que se vende ahora; tachado es lo que no hay.</p>' +
        '<label class="sw" for="openSw"><input type="checkbox" id="openSw"><span>Recibiendo pedidos</span></label>' +
        '<div id="quick"></div>' +
        '<div class="bulk"><button class="btn small" type="button" id="allOn">Habilitar todo</button><button class="btn small" type="button" id="allOff">Deshabilitar todo</button></div>' +
      '</section>' +
      '<section class="panel"><h2>Datos del local</h2>' +
        '<p>El WhatsApp es el número al que llegan los pedidos.</p>' +
        '<div class="grid2">' +
          '<label class="field" for="sName"><span>Nombre del local</span><input type="text" id="sName"></label>' +
          '<label class="field" for="sPhone"><span>WhatsApp del local</span><input type="tel" id="sPhone" inputmode="tel" placeholder="3855 123456"><small id="sPhoneShow"></small></label>' +
        '</div>' +
        '<label class="field" for="sHours"><span>Horarios o aviso para el cliente</span><input type="text" id="sHours" placeholder="Martes a domingo, 20 a 00 hs"></label>' +
      '</section>' +
      '<section class="panel"><h2>Productos</h2>' +
        '<p>Agregá, cambiá precios o borrá productos. Los cambios se publican todos juntos con el botón de abajo.</p>' +
        '<details class="edit" id="editBox"><summary>Editar productos</summary><div id="rows" style="margin-top:.75rem"></div><button class="btn" type="button" id="btnAdd">Agregar producto</button></details>' +
      '</section>' +
      '<section class="panel"><h2>Conexión con GitHub</h2>' +
        '<p>Para publicar cambios desde acá, conectá tu repositorio una sola vez. Estos datos quedan guardados solo en este dispositivo y no se publican.</p>' +
        '<div class="grid2">' +
          '<label class="field" for="ghUser"><span>Usuario de GitHub</span><input type="text" id="ghUser" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
          '<label class="field" for="ghRepo"><span>Nombre del repositorio</span><input type="text" id="ghRepo" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
        '</div>' +
        '<label class="field" for="ghToken"><span>Token de acceso</span><input type="password" id="ghToken" autocomplete="off" spellcheck="false"><small>Es como una llave de ese repositorio. No lo compartas con nadie.</small></label>' +
      '</section>';

    $('#openSw').checked = !!D.shop.open;
    $('#sName').value = D.shop.name || '';
    $('#sPhone').value = D.shop.phone || '';
    $('#sHours').value = D.shop.hours || '';
    updatePhoneShow();
    var gh = ghCfg();
    $('#ghUser').value = gh.user || '';
    $('#ghRepo').value = gh.repo || '';
    $('#ghToken').value = gh.token || '';
    $('#ghUser').addEventListener('input', function (e) { ghSet('user', e.target.value.trim()); });
    $('#ghRepo').addEventListener('input', function (e) { ghSet('repo', e.target.value.trim()); });
    $('#ghToken').addEventListener('input', function (e) { ghSet('token', e.target.value.trim()); });
    renderQuick();
    renderRows();

    $('#openSw').addEventListener('change', function (e) { D.shop.open = e.target.checked; renderSave(); });
    $('#sName').addEventListener('input', function (e) { D.shop.name = e.target.value; renderSave(); });
    $('#sPhone').addEventListener('input', function (e) { D.shop.phone = e.target.value; updatePhoneShow(); renderSave(); });
    $('#sHours').addEventListener('input', function (e) { D.shop.hours = e.target.value; renderSave(); });
    $('#quick').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]');
      if (!b) return;
      var it = D.items.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0];
      if (it) { it.on = !it.on; renderQuick(); renderSave(); }
    });
    $('#allOn').addEventListener('click', function () { D.items.forEach(function (i) { i.on = true; }); renderQuick(); renderSave(); });
    $('#allOff').addEventListener('click', function () { D.items.forEach(function (i) { i.on = false; }); renderQuick(); renderSave(); });
    $('#btnAdd').addEventListener('click', function () {
      var first = D.items[0];
      D.items.unshift({ id: uid(), name: '', desc: '', ing: [], price: 0, cat: first ? first.cat : 'Hamburguesas', on: true });
      renderRows(); renderQuick(); renderSave();
      var n = $('#rows input[data-f="name"]');
      if (n) n.focus();
    });
    $('#rows').addEventListener('input', onRowInput);
    $('#rows').addEventListener('click', onRowClick);
    renderSave();
  }

  function updatePhoneShow() {
    var n = phoneShow(D.shop.phone);
    $('#sPhoneShow').textContent = n ? 'Los clientes lo van a escribir a ' + n : 'Con código de área, sin 0 y sin 15.';
  }

  function renderQuick() {
    var c = cats(D.items);
    if (!D.items.length) { $('#quick').innerHTML = '<p class="empty" style="padding:1rem 0">Todavía no cargaste productos.</p>'; return; }
    $('#quick').innerHTML = c.map(function (k) {
      return '<div class="chipgroup"><h3>' + esc(k) + '</h3><div class="chips">' + D.items.filter(function (i) { return ((i.cat || '').trim() || 'Sin categoría') === k; }).map(function (i) {
        return '<button type="button" class="chip" data-id="' + esc(i.id) + '" aria-pressed="' + (i.on ? 'true' : 'false') + '">' + esc(i.name || 'Sin nombre') + '</button>';
      }).join('') + '</div></div>';
    }).join('');
  }

  function renderRows() {
    var list = cats(D.items).map(function (k) { return '<option value="' + esc(k) + '">'; }).join('');
    $('#rows').innerHTML = '<datalist id="catlist">' + list + '</datalist>' + D.items.map(function (i) {
      var id = esc(i.id);
      return '<div class="arow" data-id="' + id + '">' +
        '<label class="field" for="n-' + id + '"><span>Nombre</span><input type="text" id="n-' + id + '" data-f="name" value="' + esc(i.name) + '"></label>' +
        '<label class="field" for="p-' + id + '"><span>Precio ($)</span><input type="text" inputmode="numeric" id="p-' + id + '" data-f="price" value="' + esc(i.price) + '"></label>' +
        '<label class="field" for="c-' + id + '"><span>Categoría</span><input type="text" id="c-' + id + '" data-f="cat" list="catlist" value="' + esc(i.cat) + '"></label>' +
        '<label class="field wide" for="d-' + id + '"><span>Descripción</span><input type="text" id="d-' + id + '" data-f="desc" value="' + esc(i.desc) + '"></label>' +
        '<label class="field wide" for="g-' + id + '"><span>Ingredientes (separados por coma)</span><input type="text" id="g-' + id + '" data-f="ing" placeholder="Carne, cheddar, lechuga, tomate" value="' + esc((i.ing || []).join(', ')) + '"><small>Al pedirlo, el cliente puede elegir sacar los que no quiera. Dejalo vacío si no se puede personalizar.</small></label>' +
        '<div class="actions"><button class="btn small danger" type="button" data-act="del">Eliminar</button></div>' +
      '</div>';
    }).join('');
  }

  function rowItem(el) {
    var row = el.closest('.arow');
    if (!row) return null;
    var id = row.getAttribute('data-id');
    return D.items.filter(function (x) { return x.id === id; })[0] || null;
  }
  function onRowInput(e) {
    var f = e.target.getAttribute('data-f');
    var it = rowItem(e.target);
    if (!f || !it) return;
    if (f === 'price') it[f] = Number(String(e.target.value).replace(/\D/g, '')) || 0;
    else if (f === 'ing') it[f] = e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    else it[f] = e.target.value;
    renderQuick();
    renderSave();
  }
  function onRowClick(e) {
    var b = e.target.closest('button[data-act="del"]');
    if (!b) return;
    var it = rowItem(b);
    if (!it) return;
    if (b.getAttribute('data-sure') !== '1') {
      b.setAttribute('data-sure', '1');
      b.textContent = 'Tocá de nuevo para borrar';
      return;
    }
    D.items = D.items.filter(function (x) { return x.id !== it.id; });
    renderRows(); renderQuick(); renderSave();
  }

  var saving = false;
  var saveErr = '';
  function renderSave() {
    var bar = $('#savebar');
    if (tab !== 'menu' || !dirty()) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = '<p>Tenés cambios sin publicar.</p><div class="row"><button class="btn" type="button" id="btnDiscard"' + (saving ? ' disabled' : '') + '>Descartar</button><button class="btn primary" type="button" id="btnSave"' + (saving ? ' disabled' : '') + '>' + (saving ? 'Publicando…' : 'Publicar cambios') + '</button></div>' + (saveErr ? '<p class="err">' + esc(saveErr) + '</p>' : '');
    $('#btnDiscard').addEventListener('click', function () { D = clone(S); saveErr = ''; renderAdmin(); });
    $('#btnSave').addEventListener('click', onSave);
  }

  function onSave() {
    saveErr = '';
    var bad = D.items.filter(function (i) { return !String(i.name).trim(); });
    if (bad.length) { saveErr = 'Hay productos sin nombre. Completalos o eliminalos.'; renderSave(); return; }
    var next = clone(D);
    next.sample = false;
    next.shop.name = String(next.shop.name || '').trim() || 'Mi local';
    next.items.forEach(function (i) {
      i.name = i.name.trim(); i.cat = (i.cat || '').trim() || 'Sin categoría'; i.desc = (i.desc || '').trim();
      i.ing = (i.ing || []).map(function (x) { return String(x).trim(); }).filter(function (x, ix, a) { return x && a.indexOf(x) === ix; });
    });
    var cfg = ghCfg();
    if (!cfg.user || !cfg.repo || !cfg.token) {
      saveErr = 'Falta conectar con GitHub. Completá usuario, repositorio y token en “Conexión con GitHub”, más abajo.';
      renderSave();
      return;
    }
    saving = true; renderSave();
    var api = 'https://api.github.com/repos/' + encodeURIComponent(cfg.user) + '/' + encodeURIComponent(cfg.repo) + '/contents/menu.json';
    var headers = { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    fetch(api, { headers: headers, cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return {};
      if (!r.ok) throw { status: r.status };
      return r.json();
    }).then(function (cur) {
      var body = { message: 'Actualizar menú', content: utf8b64(JSON.stringify(next, null, 2) + '\n') };
      if (cur && cur.sha) body.sha = cur.sha;
      return fetch(api, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
    }).then(function (r) {
      if (!r.ok) throw { status: r.status };
      return r.json();
    }).then(function () {
      saving = false;
      S = next;
      D = clone(next);
      renderHead();
      setTab(tab);
      toast('Publicado. Los clientes lo ven en 1 o 2 minutos.');
    }).catch(function (err) {
      saving = false;
      var c = err && err.status;
      if (c === 401) saveErr = 'El token no es válido o venció. Generá uno nuevo y pegalo en “Conexión con GitHub”.';
      else if (c === 403 || c === 404) saveErr = 'GitHub no dejó guardar. Revisá que el usuario y el repositorio estén bien escritos y que el token tenga permiso de escritura sobre ese repositorio.';
      else if (c === 409 || c === 422) saveErr = 'El menú cambió mientras editabas. Actualizá la página y repetí los cambios.';
      else if (c) saveErr = 'GitHub respondió con un error (' + c + '). Probá de nuevo en un momento.';
      else saveErr = 'No hay conexión con GitHub. Revisá tu internet y probá de nuevo.';
      renderSave();
    });
  }

  /* ---------- Pestañas ---------- */
  function setTab(t) {
    tab = t;
    ssSet('tab', t);
    $$('.tab').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === t ? 'true' : 'false'); });
    $('#cartbar').hidden = true;
    if (t === 'pedidos') renderOrders();
    else if (t === 'menu') renderAdmin();
    else renderCustomer();
    renderSave();
  }
  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab');
    if (b) setTab(b.getAttribute('data-tab'));
  });

  /* ---------- Arranque ---------- */
  $('#view').innerHTML = '<p class="boot">Cargando el menú…</p>';
  window.addEventListener('hashchange', function () { location.reload(); });

  function boot(state) {
    S = state;
    S.items.forEach(function (i) { if (!Array.isArray(i.ing)) i.ing = []; });
    D = clone(S);
    renderHead();
    isAdmin = location.hash === '#admin';
    if (isAdmin) {
      $('#tabs').hidden = false;
      var saved = ssGet('tab');
      setTab(saved === 'pedidos' || saved === 'menu' ? saved : 'pedir');
    } else {
      setTab('pedir');
    }
  }

  fetch('menu.json?v=' + Date.now(), { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('menu');
    return r.json();
  }).then(boot).catch(function () {
    $('#view').innerHTML = '<p class="empty">No se pudo cargar el menú. Actualizá la página en un momento.</p>';
  });
})();
