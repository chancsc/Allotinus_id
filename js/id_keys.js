// Allotinus C&P Key — sequential dichotomous key navigation and scoring
// Presentation model: single statement per couplet, answered Yes / No.
// See notebook_data/id_keys_technical_design.txt for full spec.

const GENUS_MARKER = 'Allotinus';
const ANSWERS_KEY  = 'allotinus-ks-answers-v1';

const ks = {
  couplets:   [],          // array from JSON
  leads:      {},          // {leadNum_str: leadText} — terminal leads only
  species_paths: {},       // {speciesName: [leadNums]} — for species detail page
  cpByNum:    new Map(),   // num_a (int) → couplet
  cpById:     new Map(),   // id → couplet
  speciesInfo: new Map(),  // "Allotinus foo" → {common_name, inat_url}
  answers:    [],          // [{coupletId, choice: 'A'|'B'|'skip'}]
  current:    null,        // current couplet object
  result:     null,        // {leadNum, text, speciesName} when identified
  scores:     [],          // computed rankings
};

// ===== Helpers =====

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Terminal if the lead text contains the genus name.
function ksIsTerminal(n) {
  return (ks.leads[String(n)] || '').includes(GENUS_MARKER);
}

// Extract "Allotinus X" from a terminal lead text.
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
  if (choice === 'A') {
    if (ksIsTerminal(cp.num_a)) {
      const text = ks.leads[String(cp.num_a)];
      return { result: { leadNum: cp.num_a, text, speciesName: ksExtractSpecies(text) } };
    }
    return ksResolve(cp.num_a + 1);
  }
  // choice 'B' or 'skip'
  return ksResolve(cp.num_b);
}

// ===== Scoring =====

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
    const pA = a.max > 0 ? a.score / a.max : 0;
    const pB = b.max > 0 ? b.score / b.max : 0;
    return pB - pA || a.name.localeCompare(b.name);
  });

  ks.scores = scores;
}

// ===== LocalStorage =====

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

// ===== Navigation =====

function ksReplay() {
  ks.current = ks.couplets[0];
  ks.result = null;
  for (const a of ks.answers) {
    if (!ks.current) break;
    if (ks.current.id !== a.coupletId) break;
    const dest = ksChoose(ks.current, a.choice);
    if (dest.result) { ks.current = null; ks.result = dest.result; }
    else if (dest.couplet) { ks.current = dest.couplet; }
    else { ks.current = null; }
  }
}

function ksOnAnswer(choice) {
  if (!ks.current) return;
  ks.answers.push({ coupletId: ks.current.id, choice });
  ksSave();
  const dest = ksChoose(ks.current, choice);
  if (dest.result) { ks.current = null; ks.result = dest.result; }
  else if (dest.couplet) { ks.current = dest.couplet; }
  else { ks.current = null; }
  ksScoreAll();
  ksRender();
}

function ksBack(index) {
  ks.answers = ks.answers.slice(0, index);
  ksSave();
  ksReplay();
  ksScoreAll();
  ksRender();
}

function ksReset() {
  ks.answers = [];
  ks.result = null;
  ks.current = ks.couplets[0];
  ks.scores = [];
  ksClear();
  ksRender();
}

// ===== Rendering helpers =====

function ksLinkify(text, phrase, link) {
  if (!phrase || !link) return esc(text);
  const idx = text.indexOf(phrase);
  if (idx === -1) return esc(text);
  return esc(text.slice(0, idx)) +
    `<a href="${esc(link)}" class="question-text-link" target="_blank" rel="noopener">${esc(phrase)}</a>` +
    esc(text.slice(idx + phrase.length));
}

function ksSpeciesEpithet(name) {
  return name.replace(/^Allotinus /, '');
}

function ksSpeciesDisplayName(name) {
  return name.replace(/^Allotinus /, 'A. ');
}

// ===== Render functions =====

function ksRenderBreadcrumb() {
  if (!ks.answers.length) return '';
  const crumbs = ks.answers.map((a, i) => {
    const cp = ks.cpById.get(a.coupletId);
    const keyLabel = cp ? ('Key ' + cp.num_a) : a.coupletId;
    const choiceLabel = a.choice === 'A' ? 'Yes' : a.choice === 'B' ? 'No' : 'Skip';
    return `<button class="ks-crumb" data-idx="${i}" title="Back to ${keyLabel}">${esc(keyLabel)}: ${esc(choiceLabel)}</button>`;
  });
  return `<div class="ks-breadcrumb-wrap">
    <div class="ks-breadcrumb">
      <span class="ks-crumb-start">Start</span>
      ${crumbs.map(c => `<span class="ks-sep">›</span>${c}`).join('')}
    </div>
  </div>`;
}

// Single-statement Yes/No card — spec §PRESENTATION MODEL.
// b_text is the alternate lead's own statement; it is NOT shown here.
function ksRenderCouplet(cp) {
  const canSkip = cp.upperside;
  const stmtHtml = ksLinkify(cp.a_text, cp.guide_phrase, cp.guide_link);
  const guideHtml = (cp.guide_phrase && cp.guide_link)
    ? `<a href="${esc(cp.guide_link)}" class="question-guide-link" target="_blank" rel="noopener">📷 Visual guide →</a>` : '';
  const hintHtml = cp.hint
    ? `<p class="ks-hint">${esc(cp.hint)}</p>` : '';

  return `
    <div class="card ks-card" id="ks-couplet-card">
      <div class="ks-label-row">
        <span class="ks-label">Key ${cp.num_a}</span>
        ${cp.upperside ? '<span class="ks-us-badge">Upperside</span>' : ''}
      </div>
      <p class="ks-stmt">${stmtHtml}</p>
      ${hintHtml}
      ${guideHtml}
      <div class="ks-btn-row">
        <button class="ks-btn ks-btn--yes" id="ks-btn-a">Yes</button>
        <button class="ks-btn ks-btn--no"  id="ks-btn-b">No</button>
        ${canSkip ? '<button class="ks-btn ks-btn--skip" id="ks-btn-skip">Skip (upperside not visible)</button>' : ''}
      </div>
    </div>`;
}

function ksRenderResult(result) {
  const { speciesName, text } = result;
  const info  = ks.speciesInfo.get(speciesName);
  const epithet = ksSpeciesEpithet(speciesName);
  const common = (info && info.common_name) || '';
  const inatUrl = (info && info.inat_url) || '';

  const inatBtn = inatUrl
    ? `<a href="${esc(inatUrl)}" class="btn-inat" target="_blank" rel="noopener">View on iNaturalist →</a>`
    : '';

  const sc = ks.scores.find(s => s.name === speciesName);
  const scoreHtml = sc && sc.max > 0
    ? `<p class="ks-score-note">${sc.score}/${sc.max} couplets consistent</p>` : '';

  return `
    <div class="card ks-card card--result">
      <span class="result-badge">Identified</span>
      ${common ? `<p class="species-common">${esc(common)}</p>` : ''}
      <p class="species-name"><em>Allotinus ${esc(epithet)}</em></p>
      ${scoreHtml}
      <div class="action-row">
        ${inatBtn}
        <button class="btn-restart" id="ks-restart">Start over</button>
      </div>
    </div>`;
}

function ksRenderCandidates() {
  if (!ks.scores.length) return '';
  const items = ks.scores.slice(0, 21).map((s, i) => {
    const info = ks.speciesInfo.get(s.name);
    const common = info && info.common_name ? `<span class="ks-cand-common">${esc(info.common_name)}</span>` : '';
    const barW = s.max > 0 ? Math.max(0, ((s.score + s.max) / (2 * s.max)) * 100) : 50;
    return `<li class="ks-cand${i === 0 ? ' ks-cand--top' : ''}">
      <span class="ks-cand-rank">${i + 1}</span>
      <div class="ks-cand-info">
        <span class="ks-cand-name">${esc(ksSpeciesDisplayName(s.name))}</span>
        ${common}
      </div>
      <div class="ks-cand-bar-wrap">
        <div class="ks-cand-bar" style="width:${barW.toFixed(0)}%"></div>
      </div>
      <span class="ks-cand-score">${s.score >= 0 ? '+' : ''}${s.score}</span>
    </li>`;
  }).join('');

  const answered = ks.answers.filter(a => a.choice !== 'skip').length;

  return `<div class="ks-candidates">
    <p class="ks-cand-header">Candidates <span class="ks-cand-count">${answered} couplet${answered !== 1 ? 's' : ''} answered</span></p>
    <ol class="ks-cand-list">${items}</ol>
  </div>`;
}

function ksRender() {
  const app = document.getElementById('ks-app');
  if (!app) return;
  ksScoreAll();

  let html = ksRenderBreadcrumb();

  if (ks.result) {
    html += ksRenderResult(ks.result);
  } else if (ks.current) {
    html += ksRenderCouplet(ks.current);
  } else {
    html += `<div class="card ks-card">
      <p style="color:var(--text-muted);font-size:.9rem;">Unexpected end of key. <button class="ks-inline-link" id="ks-restart">Start over</button></p>
    </div>`;
  }

  html += ksRenderCandidates();
  app.innerHTML = html;

  const btnA    = document.getElementById('ks-btn-a');
  const btnB    = document.getElementById('ks-btn-b');
  const btnSkip = document.getElementById('ks-btn-skip');
  const restart = document.getElementById('ks-restart');

  if (btnA)    btnA.addEventListener('click', () => ksOnAnswer('A'));
  if (btnB)    btnB.addEventListener('click', () => ksOnAnswer('B'));
  if (btnSkip) btnSkip.addEventListener('click', () => ksOnAnswer('skip'));
  if (restart) restart.addEventListener('click', ksReset);

  app.querySelectorAll('.ks-crumb[data-idx]').forEach(el => {
    el.addEventListener('click', () => ksBack(+el.dataset.idx));
  });
}

// ===== Init =====

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

    const speciesList = speciesData.species || [];
    for (const sp of speciesList) {
      const key2 = sp.name.split(' ').slice(0, 2).join(' ');
      const info = { common_name: sp.common_name || '', inat_url: sp.inat_url || '' };
      ks.speciesInfo.set(key2, info);
      if (sp.name !== key2) ks.speciesInfo.set(sp.name, info);
    }

    ks.current = ks.couplets[0];
    ks.answers = ksLoad();
    ksReplay();
    ksScoreAll();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('ks-app').style.display  = '';
    document.getElementById('app-topbar').style.display = '';

    ksRender();
  } catch(e) {
    console.error('ksInit failed:', e);
    document.getElementById('loading').innerHTML =
      '<p style="color:red;padding:2rem;">Failed to load key data. Please reload.</p>';
  }
}

document.addEventListener('DOMContentLoaded', ksInit);
