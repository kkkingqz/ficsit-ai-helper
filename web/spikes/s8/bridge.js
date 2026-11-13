'use strict';
// Спайк S8, блок 4: клиент моста и самопроверка.
// Клиент — образец для фасада Co2 (web/screens/api/): конверт { id, op, args } в blu_event("ficsitai.bridge"),
// ответ { re, body } | { re, error } и события { event, data } — в window.__ficsitaiBridge.receive.
(function () {
  const MAX_REQUEST = 64 * 1024; // предел моста; больше — мод отбросит без ответа, поэтому отказ здесь
  const prefix = Math.random().toString(36).slice(2, 8); // ответы прежней страницы сюда не попадут
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();

  const bridge = {
    stray: 0,
    call(op, args) {
      const id = prefix + '-' + (++seq);
      const text = JSON.stringify({ id: id, op: op, args: args || {} });
      if (text.length > MAX_REQUEST) {
        return Promise.reject({ code: 'TOO_LARGE', message: 'bridge request over 64 KiB' });
      }
      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject });
        blu_event('ficsitai.bridge', text);
      });
    },
    on(name, fn) {
      if (!listeners.has(name)) { listeners.set(name, []); }
      listeners.get(name).push(fn);
    },
    receive(m) {
      if (m && m.re !== undefined) {
        const p = pending.get(m.re);
        if (!p) { bridge.stray++; return; }
        pending.delete(m.re);
        if (m.error) { p.reject(m.error); } else { p.resolve(m.body); }
        return;
      }
      if (m && typeof m.event === 'string') {
        (listeners.get(m.event) || []).forEach(function (fn) { fn(m.data); });
      }
    },
    pendingCount() { return pending.size; }
  };
  window.__ficsitaiBridge = bridge;

  // --- самопроверка ---------------------------------------------------------------------------------
  const out = document.getElementById('out');
  const state = document.getElementById('state');
  function log(s) { out.textContent += s + '\n'; }
  function report(key, value) { blu_event('s8', key + '=' + JSON.stringify(value)); }

  function stats(xs) {
    const s = xs.slice().sort(function (a, b) { return a - b; });
    const at = function (q) { return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    const avg = s.reduce(function (a, b) { return a + b; }, 0) / s.length;
    const over = function (ms) { return s.filter(function (x) { return x > ms; }).length; };
    return { n: s.length, avg: +avg.toFixed(2), p50: +at(0.5).toFixed(2), p99: +at(0.99).toFixed(2), max: +s[s.length - 1].toFixed(2), over33: over(33), over50: over(50) };
  }

  async function timed(n, fn) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      await fn(i);
      xs.push(performance.now() - t0);
    }
    return stats(xs);
  }

  // Формы — по public-api-v0.md: дискриминатор kind, enum строками lowerCamelCase, ошибка { code, message }.
  const shape = [];
  function expect(name, ok) { if (!ok) { shape.push(name); } }

  function checkStatus(s) {
    expect('status.apiVersion', typeof s.apiVersion === 'string' && /^\d+\.\d+\.\d+$/.test(s.apiVersion));
    expect('status.source', typeof s.source === 'string');
    expect('status.inert', typeof s.inert === 'boolean');
    expect('status.sidecarConnected', typeof s.sidecarConnected === 'boolean');
  }
  function checkValue(v) {
    expect('value.kind', v.kind === 'value');
    expect('value.unit', v.unit === 'megawatt');
    expect('value.state', v.state === 'value' && typeof v.value === 'number');
  }
  function checkSeries(v, points) {
    expect('series.kind', v.kind === 'series');
    expect('series.window', v.window === 'last60Min');
    expect('series.points', Array.isArray(v.values) && v.values.length === points);
    expect('series.timestamps', Array.isArray(v.timestamps) && v.timestamps.length === points);
  }
  function checkError(e, code) { expect('error.' + code, e && e.code === code && typeof e.message === 'string'); }

  window.runBridgeTest = async function () {
    state.textContent = 'идёт замер…';
    const r = { ok: true };
    try {
      // 4.1, 4.2 — вызов и ответ; прогрев не считается.
      await timed(20, function () { return bridge.call('getStatus'); });
      checkStatus(await bridge.call('getStatus'));
      checkValue(await bridge.call('queryMetric', { metricId: 'power.consumption' }));
      checkSeries(await bridge.call('queryMetric', { metricId: 'power.consumption', window: 'last60Min' }), 720);

      // 4.4 — задержка круга: маленький ответ и ряд в 720 точек.
      r.small = await timed(300, function () { return bridge.call('getStatus'); });
      log('getStatus × 300: ' + JSON.stringify(r.small));
      r.series720 = await timed(100, function () { return bridge.call('queryMetric', { metricId: 'power.consumption', window: 'last60Min' }); });
      log('ряд 720 точек × 100: ' + JSON.stringify(r.series720));

      // 50 запросов сразу: все в полёте одновременно, порядок ответов не важен.
      const t0 = performance.now();
      const burst = await Promise.all(Array.from({ length: 50 }, function () { return bridge.call('getStatus'); }));
      r.burst50Ms = +(performance.now() - t0).toFixed(2);
      expect('burst.all', burst.length === 50 && burst.every(function (s) { return s && s.apiVersion; }));
      log('50 сразу: ' + r.burst50Ms + ' мс');

      // Ответ с рабочего потока мода.
      const ta = performance.now();
      const asyncBody = await bridge.call('probe.async', {});
      r.asyncMs = +(performance.now() - ta).toFixed(2);
      expect('async.body', asyncBody && asyncBody.thread === 'worker');

      // Ошибки — той же формой, что в API v0.
      try { await bridge.call('noSuchOp'); expect('error.unknownOp.thrown', false); } catch (e) { checkError(e, 'UNKNOWN_OP'); }
      try { await bridge.call('queryMetric', {}); expect('error.invalid.thrown', false); } catch (e) { checkError(e, 'INVALID_ARGUMENT'); }
      try { await bridge.call('queryMetric', { metricId: 'no.such' }); expect('error.unknownMetric.thrown', false); } catch (e) { checkError(e, 'UNKNOWN_METRIC'); }
      // Фасад не отправляет конверт больше предела.
      try { await bridge.call('getStatus', { pad: 'x'.repeat(70000) }); expect('error.tooLarge.thrown', false); } catch (e) { checkError(e, 'TOO_LARGE'); }
      // Мимо фасада: мод должен отбросить без ответа (проба сверяет счётчик Malformed = 3).
      blu_event('ficsitai.bridge', '{not json');
      blu_event('ficsitai.bridge', '{"op":"getStatus"}');
      blu_event('ficsitai.bridge', JSON.stringify({ id: 'big', op: 'getStatus', args: { pad: 'x'.repeat(70000) } }));
    } catch (e) {
      r.ok = false;
      r.exception = String(e && (e.message || e.code) || e);
    }
    r.shape = shape;
    r.pending = bridge.pendingCount();
    r.stray = bridge.stray;
    state.textContent = r.ok && shape.length === 0 ? 'замер закончен' : 'есть расхождения';
    log('формы: ' + (shape.length ? shape.join(', ') : 'совпадают'));
    report('bridge', r);
  };

  let events = 0, lastSeq = 0, ordered = true;
  bridge.on('metrics.snapshot', function (d) {
    events++;
    if (d.seq !== lastSeq + 1) { ordered = false; }
    lastSeq = d.seq;
  });
  window.reportBridgeEvents = function () { report('events', { count: events, ordered: ordered, stray: bridge.stray }); };

  state.textContent = 'готово';
  blu_event('s8', 'ready=bridge');
})();
