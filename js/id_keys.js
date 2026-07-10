// Allotinus C&P Key — sequential dichotomous key navigation and scoring
// UI matches Jamides_id presentation model (event delegation, separate render zones).

const GENUS_MARKER = 'Allotinus';
const ANSWERS_KEY  = 'allotinus-ks-answers-v1';

const ks = {
  couplets:     [],
  leads:        {},
  species_paths: {},
  cpByNum:      new Map(),  // num_a (int) → couplet
  cpById:       new Map(),  // id → couplet
  speciesInfo:  new Map(),  // "Allotinus foo" → {common_name, inat_url}
  answers:      [],         // [{coupletId, choice: 'A'|'B'|'skip'}]
  current:      null,       // current couplet, null when done
  result:       null,       // {leadNum, text, speciesName} when identified
  scores:       [],
  expandedName: null,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escAttr(s) {
  return (s || '').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Navigation ────────────────────────────────────────────────────────────────

function ksIsTerminal(n) {
  return (ks.leads[String(n)] || '').includes(GENUS_MARKER);
}

function ksExtractSpecies(text) {
  const m = text.match(/→\s*(Allotinus\s+\w+)/);
  return m ? m[1] : (text.match(/\bAllotinus\s+\w+/)?.[0] || '');
}

// Walk forward from lead t: couplet-node beats terminal (cpByNum checked first).
function ksResolve(t) {
  let steps = 0;
  while (steps++ < 500) {
    if (ks.cpByNum.has(t)) return { couplet: ks.cpByNum.get(t) };
    if (ksIsTerminal(t)) {
      const text = ks.leads[String(t)];
      return { result: { leadNum: t, text, speciesName: ksExtractSpecies(text) } };
    }
    t++;
  }
  return { dead: true };
}

function ksChoose(cp, choice) {
  if (choice === 'skip') return ksResolve(cp.num_b);
  if (choice === 'A') {
    if (ksIsTerminal(cp.num_a)) {
      const text = ks.leads[String(cp.num_a)];
      return { result: { leadNum: cp.num_a, text, speciesName: ksExtractSpecies(text) } };
    }
    return ksResolve(cp.num_a + 1);
  }
  return ksResolve(cp.num_b);
}

function ksReplay() {
  ks.current = ks.couplets[0];
  ks.result  = null;
  for (const a of ks.answers) {
    if (!ks.current) break;
    if (ks.current.id !== a.coupletId) break;
    const dest = ksChoose(ks.current, a.choice);
    if (dest.result)       { ks.current = null; ks.result = dest.result; }
    else if (dest.couplet) { ks.current = dest.couplet; }
    else                   { ks.current = null; }
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function ksScoreAll() {
  const names = new Set();
  for (const cp of ks.couplets) {
    cp.species_a.forEach(s => names.add(s));
    cp.species_b.forEach(s => names.add(s));
  }

  const answered = ks.answers.filter(a => a.choice !== 'skip');

  const scores = [...names].map(name => {
    let score = 0, max = 0;
    for (const a of answered) {
      const cp = ks.cpById.get(a.coupletId);
      if (!cp) continue;
      const inA = cp.species_a.includes(name);
      const inB = cp.species_b.includes(name);
      if (!inA && !inB) continue;
      max++;
      if (a.choice === 'A' && inA) score++;
      else if (a.choice === 'A' && inB) score--;
      else if (a.choice === 'B' && inB) score++;
      else if (a.choice === 'B' && inA) score--;
    }
    return { name, score, max };
  });

  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pA = a.max > 0 ? a.score / a.max : 0;
    const pB = b.max > 0 ? b.score / b.max : 0;
    return pB - pA || a.name.localeCompare(b.name);
  });

  ks.scores = scores;
}

// ── LocalStorage ──────────────────────────────────────────────────────────────

function ksSave() {
  try { localStorage.setItem(ANSWERS_KEY, JSON.stringify(ks.answers)); } catch(e) {}
}

function ksLoad() {
  try {
    const raw = localStorage.getItem(ANSWERS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    const valid = new Set(ks.couplets.map(c => c.id));
    return arr.filter(a => valid.has(a.coupletId) && ['A','B','skip'].includes(a.choice));
  } catch(e) { return []; }
}

function ksClear() {
  try { localStorage.removeItem(ANSWERS_KEY); } catch(e) {}
}

// ── Render helpers ────────────────────────────────────────────────────────────

function ksLinkify(text, phrase, link) {
  if (!phrase || !link) return esc(text);
  const idx = text.indexOf(phrase);
  if (idx === -1) return esc(text);
  return esc(text.slice(0, idx))
    + `<a href="${escAttr(link)}" class="ks-guide-link" target="_blank" rel="noopener">${esc(phrase)}</a>`
    + esc(text.slice(idx + phrase.length));
}

// ── Render: history strip ─────────────────────────────────────────────────────

function ksRenderHistory() {
  const el = document.getElementById('ks-history');
  if (!el) return;
  if (!ks.answers.length) { el.innerHTML = ''; return; }

  const items = ks.answers.map((a, i) => {
    const cp = ks.cpById.get(a.coupletId);
    if (!cp) return '';
    const verdict = a.choice === 'skip' ? 'Skip' : a.choice === 'A' ? 'Yes' : 'No';
    return `<span class="ks-hist-item" data-step="${i}" role="button" tabindex="0" title="Back to Key ${cp.num_a}">Key ${cp.num_a}: ${esc(verdict)}</span>`;
  }).filter(Boolean).join('<span class="ks-hist-sep">›</span>');

  el.innerHTML = `<div class="ks-hist">${items}</div>`;
}

// ── Render: current couplet or result ─────────────────────────────────────────

function ksRenderCoupletArea() {
  const el = document.getElementById('ks-couplets');
  if (!el) return;

  if (ks.result) {
    const { speciesName, text, leadNum } = ks.result;
    const info = ks.speciesInfo.get(speciesName) || {};
    const inatHref = info.inat_url ? escAttr(info.inat_url) : '';
    el.innerHTML = `
      <div class="ks-result-card">
        <p class="ks-result-label">&#9658; Identification &middot; Key ${esc(String(leadNum))}</p>
        <p class="ks-result-species"><em>${esc(speciesName)}</em></p>
        ${info.common_name ? `<p class="ks-result-common">${esc(info.common_name)}</p>` : ''}
        <p class="ks-result-text">${esc(text)}</p>
        ${inatHref ? `<a class="ks-inat-link" href="${inatHref}" target="_blank" rel="noopener">View on iNaturalist &#8594;</a>` : ''}
      </div>`;
    return;
  }

  if (!ks.current) {
    el.innerHTML = `<p class="ks-empty">Unexpected end of key. <button class="ks-btn-restart" id="ks-restart-inline">Start over</button></p>`;
    const b = document.getElementById('ks-restart-inline');
    if (b) b.addEventListener('click', ksReset);
    return;
  }

  const cp = ks.current;
  const stmtHtml = ksLinkify(cp.a_text, cp.guide_phrase, cp.guide_link);

  // If guide phrase not in a_text, show a trailing guide link
  const guideExtra = (cp.guide_link && cp.guide_phrase && !(cp.a_text || '').includes(cp.guide_phrase))
    ? ` <a href="${escAttr(cp.guide_link)}" class="ks-guide-link" target="_blank" rel="noopener">visual guide</a>`
    : '';

  const hintHtml = cp.hint
    ? `<details class="ks-hint"><summary>Hint</summary><p>${esc(cp.hint)}</p></details>`
    : '';

  const canSkip = !!cp.upperside;
  const skipRow = canSkip
    ? `<div class="ks-btn-row">
         <button class="ks-btn ks-btn-skip" data-id="${escAttr(cp.id)}" data-v="skip">Skip — upperside feature</button>
       </div>`
    : '';

  el.innerHTML = `
    <div class="ks-cp" id="ks-cp-current">
      <p class="ks-cp-label">
        <span class="ks-label-tag">Key ${cp.num_a}</span>
        ${cp.upperside ? '<span class="ks-us-badge">Upperside</span>' : ''}
      </p>
      <p class="ks-cp-statement">${stmtHtml}${guideExtra}</p>
      ${hintHtml}
      <div class="ks-btn-row ks-btn-row--yesno">
        <button class="ks-btn ks-btn-yes" data-id="${escAttr(cp.id)}" data-v="A">Yes</button>
        <button class="ks-btn ks-btn-no"  data-id="${escAttr(cp.id)}" data-v="B">No</button>
      </div>
      ${skipRow}
    </div>`;
}

// ── Render: candidates ────────────────────────────────────────────────────────

function ksRenderCandidates() {
  const el = document.getElementById('ks-candidates');
  if (!el) return;

  const nonSkip = ks.answers.filter(a => a.choice !== 'skip').length;
  if (nonSkip === 0) {
    el.innerHTML = '<p class="ks-empty">Answer key questions above to rank candidates.</p>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  el.innerHTML = ks.scores.map((s, i) => {
    const info     = ks.speciesInfo.get(s.name) || {};
    const barW     = s.max > 0 ? Math.round(Math.max(0, s.score) / s.max * 100) : 0;
    const isExp    = ks.expandedName === s.name;
    const inatHref = info.inat_url ? escAttr(info.inat_url) : '';
    const detail   = isExp ? `
      <div class="ks-cand-detail">
        <p class="ks-cand-score-detail">${s.score > 0 ? '+' : ''}${s.score} / ${s.max} couplet${s.max !== 1 ? 's' : ''} consistent</p>
        ${inatHref ? `<a class="ks-inat-link" href="${inatHref}" target="_blank" rel="noopener">View on iNaturalist &#8594;</a>` : ''}
      </div>` : '';
    return `
      <div class="ks-cand${isExp ? ' expanded' : ''}" data-name="${escAttr(s.name)}">
        <div class="ks-cand-row" role="button" tabindex="0" aria-expanded="${isExp}">
          <span class="ks-rank">${medals[i] || i + 1}</span>
          <span class="ks-cname">
            <em class="ks-sci">${esc(s.name)}</em>
            ${info.common_name ? `<span class="ks-common">${esc(info.common_name)}</span>` : ''}
          </span>
          <span class="ks-bar-wrap">
            <span class="ks-bar-bg">
              <span class="ks-bar${s.score < 0 ? ' neg' : ''}" style="width:${barW}%"></span>
            </span>
            <span class="ks-score-num${s.score < 0 ? ' neg' : ''}">${s.score > 0 ? '+' : ''}${s.score}</span>
          </span>
          ${inatHref ? `<a class="ks-inat-icon" href="${inatHref}" target="_blank" rel="noopener" title="View on iNaturalist" aria-label="View ${escAttr(s.name)} on iNaturalist">&#128279;</a>` : ''}
        </div>
        ${detail}
      </div>`;
  }).join('');
}

// ── Main render ───────────────────────────────────────────────────────────────

function ksRender() {
  ksScoreAll();
  ksRenderHistory();
  ksRenderCoupletArea();
  ksRenderCandidates();

  const badge = document.getElementById('ks-answered-count');
  if (badge) {
    if (ks.result) {
      badge.textContent = `Key ${ks.result.leadNum}`;
    } else if (ks.current) {
      badge.textContent = `Key ${ks.current.num_a}`;
    } else {
      badge.textContent = '';
    }
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────

function ksOnCoupletClick(e) {
  if (e.target.closest('.ks-guide-link')) return;
  const btn = e.target.closest('.ks-btn');
  if (!btn || !btn.dataset.id) return;
  const id = btn.dataset.id;
  const choice = btn.dataset.v;
  if (!ks.current || ks.current.id !== id) return;

  ks.answers.push({ coupletId: id, choice });
  ksSave();
  const dest = ksChoose(ks.current, choice);
  if (dest.result)       { ks.current = null; ks.result = dest.result; }
  else if (dest.couplet) { ks.current = dest.couplet; }
  else                   { ks.current = null; }
  ksRender();
}

function ksOnHistoryClick(e) {
  const item = e.target.closest('.ks-hist-item');
  if (!item) return;
  const step = parseInt(item.dataset.step, 10);
  if (isNaN(step)) return;
  ks.answers = ks.answers.slice(0, step);
  ks.result  = null;
  ksReplay();
  ksSave();
  ksRender();
}

function ksOnCandidateClick(e) {
  if (e.target.closest('.ks-inat-icon')) return;
  const row = e.target.closest('.ks-cand-row');
  if (!row) return;
  const cand = row.closest('.ks-cand');
  if (!cand) return;
  const name = cand.dataset.name;
  ks.expandedName = ks.expandedName === name ? null : name;
  ksRenderCandidates();
}

function ksReset() {
  ks.answers      = [];
  ks.result       = null;
  ks.expandedName = null;
  ks.current      = ks.couplets[0];
  ks.scores       = [];
  ksClear();
  ksRender();
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function ksInit() {
  try {
    const [keyData, speciesData] = await Promise.all([
      fetch('data/id_key.json').then(r => r.json()),
      fetch('data/species.json').then(r => r.json()).catch(() => ({ species: [] })),
    ]);

    ks.couplets      = keyData.couplets;
    ks.leads         = keyData.leads;
    ks.species_paths = keyData.species_paths || {};

    for (const cp of ks.couplets) {
      ks.cpById.set(cp.id, cp);
      ks.cpByNum.set(cp.num_a, cp);
    }

    for (const sp of (speciesData.species || [])) {
      const key2 = sp.name.split(' ').slice(0, 2).join(' ');
      const info = { common_name: sp.common_name || '', inat_url: sp.inat_url || '' };
      ks.speciesInfo.set(key2, info);
      if (sp.name !== key2) ks.speciesInfo.set(sp.name, info);
    }

    ks.current = ks.couplets[0];
    ks.answers = ksLoad();
    ksReplay();
    ksScoreAll();

    document.getElementById('loading').style.display   = 'none';
    document.getElementById('ks-app').style.display    = '';
    document.getElementById('app-topbar').style.display = '';

    ksRender();

    document.getElementById('ks-couplets').addEventListener('click', ksOnCoupletClick);

    const histEl = document.getElementById('ks-history');
    histEl.addEventListener('click', ksOnHistoryClick);
    histEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') ksOnHistoryClick(e);
    });

    const candEl = document.getElementById('ks-candidates');
    candEl.addEventListener('click', ksOnCandidateClick);
    candEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') ksOnCandidateClick(e);
    });

    document.getElementById('ks-reset').addEventListener('click', ksReset);

  } catch(e) {
    console.error('ksInit failed:', e);
    document.getElementById('loading').innerHTML =
      '<p style="color:red;padding:2rem;">Failed to load key data. Please reload.</p>';
  }
}

document.addEventListener('DOMContentLoaded', ksInit);
