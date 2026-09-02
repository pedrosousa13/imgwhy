(() => {
  const HOST_ID = '__imgwhy_host__';
  const existing = document.getElementById(HOST_ID);
  if (existing) { existing.remove(); return; }

  /* ---------------- srcset parsing (spec-lite, survives commas in URLs) ---------------- */
  function parseSrcset(input) {
    const out = []; const s = input || ''; let i = 0;
    const ws = c => /\s/.test(c);
    while (i < s.length) {
      while (i < s.length && (ws(s[i]) || s[i] === ',')) i++;
      if (i >= s.length) break;
      let url = '';
      while (i < s.length && !ws(s[i])) { url += s[i]; i++; }
      let desc = '';
      if (url.endsWith(',')) {
        url = url.replace(/,+$/, '');
      } else {
        let depth = 0;
        while (i < s.length) {
          const c = s[i];
          if (c === '(') depth++;
          if (c === ')') depth--;
          if (c === ',' && depth === 0) { i++; break; }
          desc += c; i++;
        }
        desc = desc.trim();
      }
      const m = desc.match(/^([\d.]+)([wx])$/);
      out.push({
        url,
        w: m && m[2] === 'w' ? parseFloat(m[1]) : null,
        x: m && m[2] === 'x' ? parseFloat(m[1]) : (m ? null : 1),
        raw: desc || '1x',
      });
    }
    return out;
  }

  /* ---------------- sizes resolution ---------------- */
  const toPx = (n, u, vw) => u === 'vw' ? n / 100 * vw : (u === 'em' || u === 'rem') ? n * 16 : n;

  function splitTop(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map(x => x.trim()).filter(Boolean);
  }

  function evalCond(cond, vw) {
    return cond.split(/\s+and\s+/i).every(p => {
      const m = p.match(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)?\s*\)/i);
      if (!m) return false;
      const v = toPx(parseFloat(m[2]), (m[3] || 'px').toLowerCase(), vw);
      return m[1].toLowerCase() === 'max' ? vw <= v : vw >= v;
    });
  }

  function evalLen(str, vw) {
    const s = str.trim();
    if (/^auto$/i.test(s)) return { auto: true };
    const calc = s.match(/^calc\(([\s\S]*)\)$/i);
    const toks = (calc ? calc[1] : s).match(/[+-]?\s*[\d.]+(?:vw|px|em|rem)/gi);
    if (!toks) return null;
    let t = 0;
    for (const tok of toks) {
      const m = tok.replace(/\s+/g, '').match(/^([+-]?)([\d.]+)(vw|px|em|rem)$/i);
      if (!m) return null;
      t += (m[1] === '-' ? -1 : 1) * toPx(parseFloat(m[2]), m[3].toLowerCase(), vw);
    }
    return { px: t };
  }

  function resolveSizes(str, vw) {
    if (!str || !str.trim()) return { px: vw, clause: 'absent → 100vw default', dflt: true };
    for (const c of splitTop(str)) {
      const mm = c.match(/^(\(.*\))\s+(.+)$/);
      if (mm) {
        if (!evalCond(mm[1], vw)) continue;
        const L = evalLen(mm[2], vw);
        return L ? { ...L, clause: c, cond: mm[1] } : { error: true, clause: c };
      }
      const L = evalLen(c, vw);
      return L ? { ...L, clause: c } : { error: true, clause: c };
    }
    return { px: vw, clause: 'no condition matched → 100vw default', dflt: true };
  }

  /* ---------------- selection ---------------- */
  function select(cands, sizesPx, dpr) {
    const withD = cands
      .map(c => ({ ...c, density: c.w != null ? (sizesPx ? c.w / sizesPx : null) : c.x }))
      .filter(c => c.density != null)
      .sort((a, b) => a.density - b.density);
    if (!withD.length) return null;
    return withD.find(c => c.density >= dpr) || withD[withD.length - 1];
  }

  const abs = u => { try { return new URL(u, location.href).href; } catch { return u; } };
  const fileOf = u => { try { const p = new URL(u, location.href); return (p.pathname.split('/').pop() || p.hostname) + (p.search ? p.search.slice(0, 40) : ''); } catch { return u.slice(-40); } };

  /* ---------------- collect ---------------- */
  function activeSrcset(img) {
    const pic = img.closest('picture');
    if (pic) {
      for (const src of pic.querySelectorAll('source')) {
        if (src.media && !matchMedia(src.media).matches) continue;
        if (src.type && !(document.createElement('canvas').toDataURL(src.type).startsWith('data:' + src.type))) {
          // unsupported type is a guess; keep going rather than block
        }
        if (src.srcset) return { srcset: src.srcset, sizes: src.sizes || img.sizes, from: '<source' + (src.media ? ' media="' + src.media + '"' : '') + '>' };
      }
    }
    return { srcset: img.srcset, sizes: img.sizes, from: '<img>' };
  }

  function analyse(img, dpr, vw, sizesOverride) {
    const act = activeSrcset(img);
    const cands = parseSrcset(act.srcset);
    const rect = img.getBoundingClientRect();
    const rendered = rect.width || img.width || 0;
    const sizesStr = sizesOverride != null ? sizesOverride : act.sizes;
    const hasW = cands.some(c => c.w != null);
    const res = hasW ? resolveSizes(sizesStr, vw) : { px: null };
    const sizesPx = res.auto ? rendered : res.px;
    const predicted = cands.length ? select(cands, sizesPx, dpr) : null;
    const actualUrl = img.currentSrc || img.src;
    const predUrl = predicted ? abs(predicted.url) : null;
    const mismatch = predUrl && actualUrl && predUrl !== actualUrl;
    const actualCand = cands.find(c => abs(c.url) === actualUrl) || null;
    const needed = rendered * dpr;
    const delivered = img.naturalWidth || (actualCand && actualCand.w) || 0;
    return {
      img, act, cands, rendered, sizesStr, res, sizesPx, predicted, actualUrl, actualCand,
      mismatch, needed, delivered,
      waste: needed > 0 && delivered > 0 ? delivered / needed : null,
      responsive: cands.length > 1,
    };
  }

  function collect(dpr, vw) {
    return [...document.images]
      .filter(i => i.getBoundingClientRect().width > 8 || i.naturalWidth > 8)
      .map(i => analyse(i, dpr, vw))
      .sort((a, b) => (b.waste || 0) - (a.waste || 0));
  }

  /* ---------------- UI ---------------- */
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:12px;bottom:12px;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;margin:0;padding:0}
    .panel{
      width:520px;max-width:calc(100vw - 24px);max-height:min(76vh,760px);
      display:flex;flex-direction:column;
      background:#14171C;color:#E4E8EE;border:1px solid #333B47;border-radius:6px;
      box-shadow:0 18px 48px -12px rgba(0,0,0,.7);
      font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
    }
    .bar{display:flex;align-items:center;gap:10px;padding:9px 11px;border-bottom:1px solid #333B47;background:#191D24;border-radius:5px 5px 0 0;flex-wrap:wrap}
    .bar b{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8B95A3;font-weight:600}
    .stat{color:#B9C2CE}
    .stat i{font-style:normal;color:#FF7A5C;font-weight:600}
    .x{margin-left:auto;cursor:pointer;background:none;border:1px solid #333B47;color:#8B95A3;border-radius:3px;padding:2px 7px;font:inherit}
    .x:hover{color:#E4E8EE;border-color:#5A6675}
    .list{overflow:auto;flex:1}
    .row{border-bottom:1px solid #22272F;padding:8px 11px;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:4px 10px}
    .row:hover{background:#1B2029}
    .row.open{background:#1B2029}
    .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#D3DAE3}
    .mx{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .sub{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .tag{font-size:10px;padding:1px 5px;border-radius:2px;letter-spacing:.03em}
    .t-good{background:#12332A;color:#5DC79C}
    .t-warn{background:#33290F;color:#E0B356}
    .t-bad{background:#3A1A14;color:#FF7A5C}
    .t-under{background:#152736;color:#7FB4E0}
    .t-flat{background:#2A2F38;color:#9AA5B3}
    .t-cache{background:#2E2140;color:#B58CE8}
    .det{grid-column:1/-1;padding:10px 0 4px;display:flex;flex-direction:column;gap:9px;border-top:1px dashed #2C333D;margin-top:6px}
    .kv{display:grid;grid-template-columns:120px 1fr;gap:2px 10px;color:#9AA5B3}
    .kv span:nth-child(2n){color:#D3DAE3;word-break:break-all}
    .cands{display:flex;flex-wrap:wrap;gap:4px}
    .c{padding:2px 6px;border:1px solid #333B47;border-radius:2px;color:#8B95A3;font-size:11px}
    .c.pick{border-color:#FF7A5C;color:#FF7A5C;background:#2A150F}
    .c.real{outline:1px dashed #B58CE8;outline-offset:1px}
    .sim{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px;background:#101318;border:1px solid #2C333D;border-radius:3px}
    .sim label{color:#8B95A3;font-size:11px}
    .sim input,.sim select{background:#191D24;color:#E4E8EE;border:1px solid #333B47;border-radius:2px;padding:3px 5px;font:inherit;font-size:11px}
    .sim input[type=text]{flex:1 1 190px;min-width:120px}
    .sim input[type=number]{width:70px}
    .trace{color:#9AA5B3;white-space:pre-wrap;line-height:1.7}
    .trace em{font-style:normal;color:#E4E8EE}
    .trace u{text-decoration:none;color:#FF7A5C}
    .acts{display:flex;gap:6px}
    .acts button{background:#22272F;border:1px solid #333B47;color:#B9C2CE;border-radius:2px;padding:3px 8px;font:inherit;font-size:11px;cursor:pointer}
    .acts button:hover{border-color:#5A6675;color:#E4E8EE}
    .note{padding:9px 11px;color:#8B95A3;border-top:1px solid #333B47;background:#191D24;border-radius:0 0 5px 5px;font-size:11px}
  </style>
  <div class="panel">
    <div class="bar" id="bar"></div>
    <div class="list" id="list"></div>
    <div class="note" id="note"></div>
  </div>`;

  const $ = s => root.querySelector(s);
  let openIdx = -1;
  const sim = {};   // per-row simulation overrides

  function badge(a) {
    if (!a.cands.length || a.cands.length === 1) return '<span class="tag t-flat">no candidates</span>';
    if (a.waste == null) return '<span class="tag t-flat">not loaded</span>';
    const r = a.waste;
    const cls = r < 0.95 ? 't-under' : r <= 1.35 ? 't-good' : r <= 2 ? 't-warn' : 't-bad';
    const lbl = r < 0.95 ? r.toFixed(2) + '× under' : r.toFixed(2) + '×';
    return `<span class="tag ${cls}">${lbl}</span>`;
  }

  function render() {
    const dpr = devicePixelRatio, vw = innerWidth;
    const rows = collect(dpr, vw);
    const resp = rows.filter(r => r.responsive).length;
    const bad = rows.filter(r => r.waste && r.waste > 2).length;
    const bgCount = [...document.querySelectorAll('*')].filter(el => {
      const b = getComputedStyle(el).backgroundImage; return b && b !== 'none' && b.includes('url(');
    }).length;

    $('#bar').innerHTML =
      `<b>imgwhy</b>
       <span class="stat">viewport <i>${vw}</i> · DPR <i>${dpr}</i></span>
       <span class="stat"><i>${rows.length}</i> imgs · <i>${resp}</i> responsive · <i>${bad}</i> over 2×</span>
       <button class="x" id="close">esc</button>`;

    $('#note').textContent = bgCount
      ? `${bgCount} CSS background-image element(s) not shown — they have no srcset mechanism at all.`
      : 'Click a row to trace and simulate. Cache mismatches are flagged in purple.';

    $('#list').innerHTML = rows.map((a, i) => {
      const open = i === openIdx;
      return `<div class="row ${open ? 'open' : ''}" data-i="${i}">
        <span class="nm">${fileOf(a.actualUrl || '(none)')}</span>
        <span class="mx">${Math.round(a.rendered)}css × ${devicePixelRatio} = ${Math.round(a.needed)} · got ${a.delivered || '?'}</span>
        <span class="sub">
          ${badge(a)}
          ${a.mismatch ? '<span class="tag t-cache">cache / mismatch</span>' : ''}
          ${a.res && a.res.error ? '<span class="tag t-warn">sizes unparsed</span>' : ''}
          ${a.res && a.res.auto ? '<span class="tag t-good">sizes=auto</span>' : ''}
          ${a.act && a.act.from !== '<img>' ? `<span class="tag t-flat">${a.act.from.replace(/</g, '&lt;')}</span>` : ''}
        </span>
        ${open ? detail(a, i) : ''}
      </div>`;
    }).join('') || '<div class="row"><span class="nm">No images found.</span></div>';
  }

  function detail(a, i) {
    const s = sim[i] || {};
    const dpr = s.dpr != null ? s.dpr : devicePixelRatio;
    const vw = s.vw != null ? s.vw : innerWidth;
    const sz = s.sizes != null ? s.sizes : a.act.sizes;
    const re = analyse(a.img, dpr, vw, sz);
    const changed = s.dpr != null || s.vw != null || s.sizes != null;

    const cands = re.cands.map(c => {
      const isPick = re.predicted && c.url === re.predicted.url;
      const isReal = abs(c.url) === a.actualUrl;
      return `<span class="c ${isPick ? 'pick' : ''} ${isReal ? 'real' : ''}">${c.raw}</span>`;
    }).join('');

    const T = [];
    if (!re.cands.length) {
      T.push(`no <em>srcset</em> — one file for every device. Nothing to select.`);
    } else if (re.cands.length === 1) {
      T.push(`srcset has one candidate — selection is a formality.`);
    } else {
      const hasW = re.cands.some(c => c.w != null);
      if (hasW) {
        T.push(`sizes <em>${sz || '(absent)'}</em>`);
        T.push(`  clause used  <em>${re.res.clause}</em>`);
        T.push(`  resolves to  <em>${re.res.auto ? Math.round(re.rendered) + 'px (real layout width)' : Math.round(re.res.px) + 'px'}</em> at viewport ${vw}`);
        T.push(`  × DPR ${dpr}  =  <u>${Math.round(re.sizesPx * dpr)}</u> physical pixels needed`);
        T.push(`  smallest candidate ≥ that  →  <u>${re.predicted ? re.predicted.raw : '—'}</u>`);
      } else {
        T.push(`x descriptors only — sizes ignored. Device DPR ${dpr} → <u>${re.predicted ? re.predicted.raw : '—'}</u>`);
      }
      T.push(`predicted  <em>${re.predicted ? fileOf(re.predicted.url) : '—'}</em>`);
      T.push(`actual     <em>${fileOf(a.actualUrl)}</em>${re.mismatch ? '   ← <u>differs</u>: a larger variant was already cached, so no new pick ran' : ''}`);
      if (a.img.naturalWidth && re.predicted && re.predicted.w && a.img.naturalWidth < re.predicted.w) {
        T.push(`note       decoded at ${a.img.naturalWidth}px, below the ${re.predicted.w}w request — source was smaller, no upscale`);
      }
    }

    return `<div class="det">
      <div class="kv">
        <span>rendered</span><span>${Math.round(a.rendered)} css px${a.img.loading === 'lazy' ? ' · loading=lazy' : ''}${a.img.fetchPriority && a.img.fetchPriority !== 'auto' ? ' · fetchpriority=' + a.img.fetchPriority : ''}</span>
        <span>decoded</span><span>${a.img.naturalWidth || 0} × ${a.img.naturalHeight || 0}</span>
        <span>candidates</span><span class="cands">${cands || '—'}</span>
      </div>
      <div class="trace">${T.join('\n')}</div>
      <div class="sim">
        <label>sizes</label><input type="text" data-sim="sizes" data-i="${i}" value="${(sz || '').replace(/"/g, '&quot;')}" placeholder="(max-width:768px) 100vw, 33vw">
        <label>vw</label><input type="number" data-sim="vw" data-i="${i}" value="${vw}">
        <label>DPR</label><select data-sim="dpr" data-i="${i}">
          ${[1, 1.5, 2, 2.625, 3, 3.5].map(d => `<option value="${d}" ${d == dpr ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
        ${changed ? `<button data-reset="${i}" style="background:#22272F;border:1px solid #333B47;color:#B9C2CE;border-radius:2px;padding:3px 8px;font:inherit;font-size:11px;cursor:pointer">reset</button>` : ''}
      </div>
      <div class="acts">
        <button data-locate="${i}">scroll to element</button>
        <button data-apply="${i}">apply sizes to live element</button>
        <button data-log="${i}">console.log element</button>
      </div>
    </div>`;
  }

  /* ---------------- events ---------------- */
  let lastRows = [];
  function rowsNow() { lastRows = collect(devicePixelRatio, innerWidth); return lastRows; }

  root.addEventListener('click', e => {
    if (e.target.id === 'close') { host.remove(); return; }
    const simEl = e.target.closest('[data-sim]');
    if (simEl) return;
    const reset = e.target.closest('[data-reset]');
    if (reset) { delete sim[+reset.dataset.reset]; render(); return; }
    const loc = e.target.closest('[data-locate]');
    if (loc) {
      const a = rowsNow()[+loc.dataset.locate];
      a.img.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const o = a.img.style.outline; a.img.style.outline = '3px solid #FF7A5C';
      setTimeout(() => { a.img.style.outline = o; }, 1600);
      return;
    }
    const ap = e.target.closest('[data-apply]');
    if (ap) {
      const i = +ap.dataset.apply; const a = rowsNow()[i];
      const s = sim[i] || {};
      if (s.sizes != null) { a.img.sizes = s.sizes; ap.textContent = 'applied — watch Network'; setTimeout(() => render(), 900); }
      else ap.textContent = 'change sizes first';
      return;
    }
    const lg = e.target.closest('[data-log]');
    if (lg) { const a = rowsNow()[+lg.dataset.log]; console.log('[imgwhy]', a.img, a); return; }
    const row = e.target.closest('.row');
    if (row) { const i = +row.dataset.i; openIdx = openIdx === i ? -1 : i; render(); }
  });

  root.addEventListener('input', e => {
    const el = e.target.closest('[data-sim]');
    if (!el) return;
    const i = +el.dataset.i; sim[i] = sim[i] || {};
    const k = el.dataset.sim;
    sim[i][k] = k === 'sizes' ? el.value : parseFloat(el.value);
    const pos = el.selectionStart;
    render();
    const again = root.querySelector(`[data-sim="${k}"][data-i="${i}"]`);
    if (again) { again.focus(); if (k === 'sizes' && again.setSelectionRange) again.setSelectionRange(pos, pos); }
  });

  root.addEventListener('change', e => {
    if (e.target.closest('[data-sim="dpr"]')) {
      const el = e.target; const i = +el.dataset.i;
      sim[i] = sim[i] || {}; sim[i].dpr = parseFloat(el.value); render();
    }
  });

  addEventListener('keydown', function esc(ev) {
    if (ev.key === 'Escape' && document.getElementById(HOST_ID)) { host.remove(); removeEventListener('keydown', esc); }
  });

  let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 200); });

  render();
  console.log('[imgwhy] panel open — esc to close');
})();
