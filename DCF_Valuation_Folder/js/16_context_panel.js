/* ============================================================
   TASK 16 — Context Panel (UI Layer)
   DOM rendering only. Renders the right-side context panel
   with severity badges, sector/regime chips, and checklist
   cards sorted by severity.

   API:
     initContextPanel()        — mount shell into #section-context
     updateContextPanel(report) — update cards efficiently
     refreshContextPanel()     — recompute + update (convenience)
============================================================ */

/* ----------------------------------------------------------
   CONSTANTS
---------------------------------------------------------- */
const _CTX_STATUS_ICONS = {
  red:    '&#x25CF;',  // filled circle
  yellow: '&#x25CF;',
  green:  '&#x25CF;',
  na:     '&#x25CB;',  // outline circle
};

const _CTX_STATUS_COLORS = {
  red:    'var(--accent-danger)',
  yellow: 'var(--accent-warning)',
  green:  'var(--accent-success)',
  na:     'var(--text-muted)',
};

/* ----------------------------------------------------------
   DEBOUNCE for context panel updates (50–80ms)
---------------------------------------------------------- */
let _ctxDebounceTimer = null;
function _ctxDebounce(fn, ms) {
  clearTimeout(_ctxDebounceTimer);
  _ctxDebounceTimer = setTimeout(fn, ms);
}

/* ----------------------------------------------------------
   INIT — mount the panel shell
---------------------------------------------------------- */
function initContextPanel() {
  const mount = document.getElementById('section-context');
  if (!mount) return;

  mount.innerHTML = `
    <div class="ctx-panel">
      <div class="ctx-header">
        <span class="ctx-title">Context Checks</span>
        <div class="ctx-badges" id="ctx-badges"></div>
      </div>
      <div class="ctx-chips" id="ctx-chips"></div>
      <div class="ctx-cards-list" id="ctx-cards-list">
        <div class="ctx-empty">Waiting for DCF model...</div>
      </div>
      <div class="ctx-diagnostics" id="ctx-diagnostics"></div>
    </div>
  `;
}

/* ----------------------------------------------------------
   UPDATE — efficient DOM update from contextReport
   Reuses existing card nodes when possible.
---------------------------------------------------------- */
let _prevCardIds = [];

function updateContextPanel(report) {
  if (!report) return;

  const badgesEl = document.getElementById('ctx-badges');
  const chipsEl  = document.getElementById('ctx-chips');
  const listEl   = document.getElementById('ctx-cards-list');
  const diagEl   = document.getElementById('ctx-diagnostics');
  if (!badgesEl || !listEl) return;

  // ── Badges ──────────────────────────────────────────────
  const s = report.summary;
  badgesEl.innerHTML = `
    <span class="ctx-badge ctx-badge-red" title="Red flags">${s.redCount}</span>
    <span class="ctx-badge ctx-badge-yellow" title="Yellow flags">${s.yellowCount}</span>
    <span class="ctx-badge ctx-badge-green" title="Green checks">${s.greenCount}</span>
  `;

  // ── Chips ───────────────────────────────────────────────
  if (chipsEl) {
    const ctx = (typeof state !== 'undefined' && state.context) ? state.context : {};
    const sectorLabel = ctx.sector || 'Tech';
    const regimeLabel = (CONTEXT_BENCHMARKS.regimes[ctx.regime] || {}).label || 'Base';
    chipsEl.innerHTML = `
      <span class="ctx-chip">${sectorLabel}</span>
      <span class="ctx-chip">${regimeLabel}</span>
    `;
  }

  // ── Cards — diff-based update ───────────────────────────
  const newIds = report.cards.map(c => c.id);
  const needsFullRebuild = newIds.length !== _prevCardIds.length ||
    newIds.some((id, i) => id !== _prevCardIds[i]);

  if (needsFullRebuild) {
    // Full rebuild
    listEl.innerHTML = report.cards.map(card => _renderCard(card)).join('');
    _prevCardIds = newIds;
  } else {
    // Patch in-place: update only changed content
    report.cards.forEach((card, i) => {
      const existing = listEl.children[i];
      if (!existing) return;
      // Update inner content if status or metrics changed
      const statusDot  = existing.querySelector('.ctx-card-status');
      const metricsEl  = existing.querySelector('.ctx-card-metrics');
      const whyEl      = existing.querySelector('.ctx-card-why');
      const nextStepEl = existing.querySelector('.ctx-card-nextstep');

      if (statusDot)  statusDot.innerHTML  = _statusDot(card.status);
      if (metricsEl)  metricsEl.textContent = card.metrics || '';
      if (whyEl)      whyEl.textContent     = card.why || '';
      if (nextStepEl) {
        nextStepEl.textContent = card.nextStep || '';
        nextStepEl.style.display = card.nextStep ? 'block' : 'none';
      }

      // Update card border color
      existing.style.borderLeftColor = _CTX_STATUS_COLORS[card.status] || _CTX_STATUS_COLORS.na;
    });
  }

  // ── Diagnostics ─────────────────────────────────────────
  if (diagEl) {
    if (report.diagnostics && report.diagnostics.length > 0) {
      diagEl.innerHTML = `
        <div class="ctx-diag-header">Key Drivers</div>
        ${report.diagnostics.map(d => `<div class="ctx-diag-line">${d}</div>`).join('')}
      `;
      diagEl.style.display = 'block';
    } else {
      diagEl.style.display = 'none';
    }
  }
}

/* ----------------------------------------------------------
   REFRESH — recompute and update (called from recalculate)
---------------------------------------------------------- */
function refreshContextPanel() {
  try {
    if (!state.dcf || !state.dcf.valid) {
      console.log('[Context] Skipped — DCF not valid');
      return;
    }

    // Auto-init panel shell if not yet mounted
    if (!document.getElementById('ctx-badges')) {
      console.log('[Context] Auto-init panel shell');
      initContextPanel();
    }

    const ctx = state.context || {};
    console.log('[Context] Computing report, sector:', ctx.sector, 'regime:', ctx.regime);
    const report = computeContextReport(
      { dcf: state.dcf, historical: state.historical, inputs: state.inputs },
      ctx
    );
    console.log('[Context] Report:', report.summary, 'cards:', report.cards.length);

    updateContextPanel(report);
  } catch (err) {
    console.error('[Context] Error in refreshContextPanel:', err);
  }
}

/* ----------------------------------------------------------
   RENDER HELPERS (private)
---------------------------------------------------------- */
function _statusDot(status) {
  return `<span style="color:${_CTX_STATUS_COLORS[status] || _CTX_STATUS_COLORS.na};font-size:0.875rem;">${_CTX_STATUS_ICONS[status] || _CTX_STATUS_ICONS.na}</span>`;
}

function _renderCard(card) {
  const borderColor = _CTX_STATUS_COLORS[card.status] || _CTX_STATUS_COLORS.na;
  const nextStepDisplay = card.nextStep ? 'block' : 'none';

  return `
    <div class="ctx-card" style="border-left-color:${borderColor};" data-card-id="${card.id}">
      <div class="ctx-card-header">
        <span class="ctx-card-status">${_statusDot(card.status)}</span>
        <span class="ctx-card-title">${card.title}</span>
        <span class="ctx-card-metrics">${card.metrics || ''}</span>
      </div>
      <div class="ctx-card-why">${card.why || ''}</div>
      <div class="ctx-card-nextstep" style="display:${nextStepDisplay};">${card.nextStep || ''}</div>
    </div>
  `;
}
