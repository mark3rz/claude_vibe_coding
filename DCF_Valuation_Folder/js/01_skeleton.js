/* ============================================================
   TASK 01 — App Skeleton
   Global state + upload screen show/hide logic.
   No parsing, no calculations, no charts.
============================================================ */

// --- Global state object ---
const state = {
  rawData:    null,
  historical: null,
  inputs:     {},
  dcf:        null,
  warnings:   [],
};

// --- Section IDs (placeholders [0]–[11]) ---
const SECTION_IDS = [
  'section-upload',        // [0]  Upload screen
  'section-header',        // [1]  Header / executive metrics
  'section-assumptions',   // [2]  Assumptions panel
  'section-dcf-table',     // [3]  DCF projection table
  'section-charts',        // [4]  Core charts
  'section-sensitivity',   // [5]  Sensitivity tables
  'section-scenario',      // [6]  Scenario sliders + tornado
  'section-tooltips',      // [7]  Tooltips / glossary
  'section-historical',    // [8]  Historical metrics
  'section-warnings',      // [9]  Warnings / data quality
  'section-footer',        // [10] Footer
  'section-debug',         // [11] Debug / raw data (dev only)
];

// --- Upload screen visibility ---
function showUploadScreen() {
  document.getElementById('upload-screen').style.display = 'flex';
  document.getElementById('dashboard-body').style.display = 'none';
  document.body.style.overflow = 'hidden';
}

function hideUploadScreen() {
  document.getElementById('upload-screen').style.display = 'none';
  document.getElementById('dashboard-body').style.display = 'block';
  document.body.style.overflow = '';
}

// --- Warnings banner ---
function renderWarnings() {
  const el = document.getElementById('section-warnings');
  if (!el) return;
  if (!state.warnings || state.warnings.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = state.warnings
    .map(w => `<div class="warning-item">${w}</div>`)
    .join('');
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  showUploadScreen();
  console.log('[DCF] App skeleton initialised. State:', state);
  console.log('[DCF] Section placeholders:', SECTION_IDS);
});
