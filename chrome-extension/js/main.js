/**
 * CodeGreeks File Studio Master Application Controller
 * Engineered by CodeGreeks Technologies (https://codegreeks.com.ng/)
 * Universal client-side file transformation studio.
 */

import {
  MEDIA_MATRIX, SUPPORTED_FAMILIES, VECTOR_GLYPHS, TOTAL_SYSTEM_FORMATS,
  canonicalExtension, extractFileExtension, stripFileExtension, detectMediaFamily,
  queryAvailableTargets, requiresTranscodeEngine, supportsTuningProfile, isSegmentedOutput,
  sanitizeFileName, sanitizeHtmlEntities, formatByteMetric, formatElapsedSeconds, formatPlaybackDuration,
} from './registry.js';

import {
  retrievePreferences, persistPreferences, generateDefaultPreferences,
  COMPRESSION_TUNING, CODEGREEKS_THEME_KEY, OMNI_THEME_KEY
} from './config.js';

import {
  stageTaskForTransit, retrieveStagedTask, discardStagedTask, purgeExpiredTransitTasks
} from './queue_bridge.js';

import { zipSync } from '../lib/fflate.js';

const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

const urlParams = new URLSearchParams(location.search);
const IS_DESKTOP_ENV = typeof window.desktopAPI !== 'undefined' && Boolean(window.desktopAPI?.isDesktop);
const IS_STANDALONE_TAB = urlParams.get('mode') === 'tab' || IS_DESKTOP_ENV;
const extApi = globalThis.browser || globalThis.chrome;
const IS_EXTENSION_ENV = typeof extApi !== 'undefined' && Boolean(extApi.runtime?.id);
const APP_VERSION = IS_EXTENSION_ENV ? extApi.runtime.getManifest().version : '2.1.0';

if (IS_STANDALONE_TAB) document.body.classList.add('workspace-tab');
if (IS_DESKTOP_ENV) document.body.classList.add('workspace-desktop');

// Session State
let userConfig;
let activeSession = {
  sourceFile: null,
  familyKey: null,
  inputExt: null,
  targetExt: null,
  eligibleTargets: [],
  isConverting: false,
  tuningPreset: 'balanced',
  segmentedMode: 'zip',
  pageRangeSelection: null,
  detectedTotalPages: null,
  handoffActive: false,
};
let completedResult = null;

/* ================= UTILITY & THEME ================= */

function injectVectorGlyphs(container = document) {
  for (const element of $$('[data-glyph]', container)) {
    if (!element.firstChild) {
      element.innerHTML = VECTOR_GLYPHS[element.dataset.glyph] || '';
    }
  }
}

function switchViewStage(targetStageId) {
  for (const page of $$('.cg-view-stage, .omni-view-stage')) {
    page.hidden = page.id !== `stage-${targetStageId}`;
  }
  if (IS_STANDALONE_TAB) updateBreadcrumbTracker(targetStageId);
}

function presentToast(messageText, durationMs = 3600) {
  const toastEl = $('#cg-toast') || $('#omni-toast');
  if (!toastEl) return;
  toastEl.textContent = messageText;
  toastEl.hidden = false;
  clearTimeout(presentToast.timerId);
  presentToast.timerId = setTimeout(() => {
    toastEl.hidden = true;
  }, durationMs);
}

function updateThemeToggleIcon() {
  const themeBtn = $('#btn-workspace-theme');
  if (!themeBtn) return;
  const isDark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  themeBtn.dataset.glyph = isDark ? 'sun' : 'moon';
  themeBtn.title = isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme';
  themeBtn.innerHTML = VECTOR_GLYPHS[themeBtn.dataset.glyph] || '';
}

function synchronizeColorTheme() {
  const mode = userConfig.colorTheme;
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.dataset.theme = mode;
  } else {
    delete document.documentElement.dataset.theme;
  }
  try {
    localStorage.setItem(CODEGREEKS_THEME_KEY, mode);
    localStorage.setItem(OMNI_THEME_KEY, mode);
  } catch {
    /* local storage restricted */
  }
  updateThemeToggleIcon();
}

/* ================= FORMAT DERIVATIONS ================= */

const isFormatAllowed = (family, ext) =>
  !userConfig.familyConfigs[family].blacklistedFormats.includes(canonicalExtension(ext));

const getVisibleTargetOptions = (family, inExt) =>
  queryAvailableTargets(family, inExt).filter((target) => isFormatAllowed(family, target));

function pickDefaultOutput(family, targets) {
  const prefOut = userConfig.familyConfigs[family].defaultFormat;
  return targets.includes(prefOut) ? prefOut : targets[0] || MEDIA_MATRIX[family].fallbackTarget;
}

function rankMediaFamilies() {
  const familyList = [...userConfig.ordering];
  if (userConfig.sortStrategy === 'alphabetical') {
    familyList.sort((a, b) => MEDIA_MATRIX[a].displayName.localeCompare(MEDIA_MATRIX[b].displayName));
  } else if (userConfig.sortStrategy === 'frequency') {
    familyList.sort(
      (a, b) =>
        (userConfig.usageTally[b] || 0) - (userConfig.usageTally[a] || 0) ||
        userConfig.ordering.indexOf(a) - userConfig.ordering.indexOf(b)
    );
  }
  return familyList;
}

async function persistAndRefresh() {
  await persistPreferences(userConfig);
  synchronizeColorTheme();
  renderHubCategories();
  if (IS_STANDALONE_TAB) refreshWorkspaceSidebar();
}

/* ================= STAGE 1: UPLOAD & DISCOVERY ================= */

function renderHubCategories() {
  const categoryGrid = $('#category-pills');
  categoryGrid.innerHTML = '';

  const activeFamilies = rankMediaFamilies().filter((id) => !userConfig.familyConfigs[id].suppressed);

  for (const familyId of activeFamilies) {
    const familyData = MEDIA_MATRIX[familyId];
    const allowedInputs = [...new Set(familyData.acceptedInputs.filter((f) => isFormatAllowed(familyId, f)).map(canonicalExtension))];

    const cardButton = document.createElement('button');
    cardButton.className = `category-card card-${familyId}`;
    cardButton.innerHTML = `
      <div class="card-icon">${VECTOR_GLYPHS[familyData.glyphKey] || VECTOR_GLYPHS.document}</div>
      <div class="card-info">
        <span class="card-title">${familyData.displayName}</span>
        <span class="card-formats">${allowedInputs.slice(0, 3).map((s) => s.toUpperCase()).join(' · ')}${allowedInputs.length > 3 ? ` +${allowedInputs.length - 3}` : ''}</span>
      </div>
      <span class="card-target-preview">→ ${userConfig.familyConfigs[familyId].defaultFormat.toUpperCase()}</span>
    `;

    cardButton.addEventListener('click', () => triggerFileBrowser(familyId));
    categoryGrid.appendChild(cardButton);
  }

  const allFormatsCount = new Set(
    activeFamilies.flatMap((id) =>
      [...MEDIA_MATRIX[id].acceptedInputs, ...MEDIA_MATRIX[id].potentialOutputs]
        .map(canonicalExtension)
        .filter((fmt) => isFormatAllowed(id, fmt))
    )
  ).size;

  $('#format-count-badge').textContent = `${allFormatsCount} Formats Supported`;
}

function computeAcceptFilter(familyKey) {
  const selectedFamilies = familyKey ? [familyKey] : SUPPORTED_FAMILIES.filter((id) => !userConfig.familyConfigs[id].suppressed);
  return selectedFamilies
    .flatMap((id) => MEDIA_MATRIX[id].acceptedInputs.filter((f) => isFormatAllowed(id, f)).map((e) => `.${e}`))
    .join(',');
}

async function triggerFileBrowser(familyKey = null) {
  if (IS_DESKTOP_ENV) {
    const filters = [];
    if (familyKey && MEDIA_MATRIX[familyKey]) {
      const allowedExts = MEDIA_MATRIX[familyKey].acceptedInputs
        .filter((f) => isFormatAllowed(familyKey, f))
        .map(canonicalExtension);
      filters.push({ name: MEDIA_MATRIX[familyKey].displayName, extensions: allowedExts });
    }
    filters.push({ name: 'All Supported Formats', extensions: ['*'] });

    const selected = await window.desktopAPI.selectFiles({ multiple: false, filters });
    if (selected && selected.length > 0) {
      const item = selected[0];
      try {
        const res = await fetch(`file:///${item.path.replace(/\\/g, '/')}`);
        const blob = await res.blob();
        const fileObj = new File([blob], item.name, { type: blob.type || 'application/octet-stream' });
        fileObj.nativePath = item.path;
        ingestSourceFile(fileObj, familyKey);
      } catch (err) {
        console.warn('Native file fetch fallback:', err);
      }
    }
    return;
  }

  const fileInput = $('#master-file-picker');
  fileInput.value = '';
  fileInput.accept = computeAcceptFilter(familyKey);
  fileInput.dataset.selectedFamily = familyKey || '';
  fileInput.click();
}

$('#master-file-picker').addEventListener('change', (e) => {
  const chosenFile = e.target.files[0];
  if (chosenFile) ingestSourceFile(chosenFile, e.target.dataset.selectedFamily || null);
});

$('#btn-browse-any').addEventListener('click', (e) => {
  e.stopPropagation();
  triggerFileBrowser(null);
});

$('#drop-trigger-box')?.addEventListener('click', (e) => {
  if (e.target.closest('#btn-sample-demo') || e.target.closest('#btn-browse-any')) return;
  triggerFileBrowser(null);
});

$('#btn-sample-demo')?.addEventListener('click', (e) => {
  e.stopPropagation();
  generateDemoSample();
});

// Drag & Drop Handling
let dragDepthCounter = 0;
const getDropCurtain = () => $('#cg-drop-curtain') || $('#omni-drop-curtain');
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types?.includes('Files') && !activeSession.isConverting) {
    dragDepthCounter++;
    const curtain = getDropCurtain();
    if (curtain) {
      curtain.hidden = false;
      curtain.classList.add('active');
    }
  }
});

window.addEventListener('dragleave', () => {
  if (--dragDepthCounter <= 0) {
    dragDepthCounter = 0;
    const curtain = getDropCurtain();
    if (curtain) {
      curtain.hidden = true;
      curtain.classList.remove('active');
    }
  }
});

window.addEventListener('dragover', (e) => e.preventDefault());

window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepthCounter = 0;
  const curtain = getDropCurtain();
  if (curtain) {
    curtain.hidden = true;
    curtain.classList.remove('active');
  }
  const droppedFile = e.dataTransfer?.files?.[0];
  if (droppedFile && !activeSession.isConverting) {
    ingestSourceFile(droppedFile, null);
  }
});

/* ================= STAGE 2: CONFIGURE & PREVIEW ================= */

function ingestSourceFile(file, expectedFamily) {
  if (IS_DESKTOP_ENV && file && file.path && !file.nativePath) {
    file.nativePath = file.path;
  }

  const detectedFamily = detectMediaFamily(file);
  const rawExtension = extractFileExtension(file.name);
  const fallbackHome = () => switchViewStage('upload');

  if (!detectedFamily) {
    fallbackHome();
    return presentToast(`.${rawExtension || 'unknown'} files are not currently recognized.`);
  }

  if (expectedFamily && expectedFamily !== detectedFamily) {
    fallbackHome();
    return presentToast(`That is a ${MEDIA_MATRIX[detectedFamily].singularTitle.toLowerCase()} file — selected under ${MEDIA_MATRIX[detectedFamily].displayName}.`);
  }

  if (userConfig.familyConfigs[detectedFamily].suppressed) {
    fallbackHome();
    return presentToast(`${MEDIA_MATRIX[detectedFamily].displayName} is currently turned off in Settings.`);
  }

  if (!isFormatAllowed(detectedFamily, rawExtension)) {
    fallbackHome();
    return presentToast(`.${rawExtension.toUpperCase()} is disabled in Settings.`);
  }

  const eligibleTargets = getVisibleTargetOptions(detectedFamily, rawExtension);
  if (!eligibleTargets.length) {
    fallbackHome();
    return presentToast(`No enabled conversion targets available for .${rawExtension}.`);
  }

  activeSession = {
    sourceFile: file,
    familyKey: detectedFamily,
    inputExt: rawExtension,
    targetExt: pickDefaultOutput(detectedFamily, eligibleTargets),
    eligibleTargets,
    isConverting: false,
    tuningPreset: userConfig.tuningPreset,
    segmentedMode: userConfig.segmentedPackaging,
    pageRangeSelection: null,
    detectedTotalPages: null,
    handoffActive: false,
  };

  // Populate File Inspector
  $('#src-family-badge').className = `family-badge badge-${detectedFamily}`;
  $('#src-family-badge').innerHTML = VECTOR_GLYPHS[detectedFamily] || VECTOR_GLYPHS.document;
  $('#src-filename-display').textContent = stripFileExtension(file.name);
  $('#src-ext-tag').textContent = `.${rawExtension}`;
  $('#src-meta-sub').textContent = formatByteMetric(file.size);

  inspectFileMetadata(file, detectedFamily, rawExtension);

  // Output filename field
  $('#dst-name-input').value = userConfig.preserveSourceBasename
    ? stripFileExtension(file.name)
    : `${stripFileExtension(file.name)}_converted`;

  // Reset secondary panels
  $('#page-range-input').value = '';
  $('#page-range-drawer').hidden = true;
  $('#row-page-selector').classList.remove('expanded');

  $('#format-search-input').value = '';
  renderTargetFormatChips();
  updateSegmentedButtonState('#segment-tuning-quality', activeSession.tuningPreset);
  updateSegmentedButtonState('#segment-multi-mode', activeSession.segmentedMode);
  setProcessingBusyState(false);

  $('#conversion-error-banner').hidden = true;
  $('#conversion-progress-box').hidden = true;

  switchViewStage('configure');
}

async function inspectFileMetadata(file, family, ext) {
  const metaLabel = $('#src-meta-sub');
  const token = (inspectFileMetadata.sequence = (inspectFileMetadata.sequence || 0) + 1);
  const updateMeta = (annotation) => {
    if (token === inspectFileMetadata.sequence) {
      metaLabel.textContent = `${formatByteMetric(file.size)} · ${annotation}`;
    }
  };

  try {
    if (ext === 'pdf') {
      const { inspectPdfDocument } = await import('./core/document_engine.js');
      const { pageCount } = await inspectPdfDocument(file);
      activeSession.detectedTotalPages = pageCount;
      updateMeta(`${pageCount} page${pageCount === 1 ? '' : 's'}`);
      refreshOptionsView();
    } else if (family === 'image' && !['heic', 'heif', 'tif', 'tiff'].includes(ext)) {
      const imgUrl = URL.createObjectURL(file);
      const tempImg = new Image();
      tempImg.src = imgUrl;
      await tempImg.decode();
      if (tempImg.naturalWidth) updateMeta(`${tempImg.naturalWidth}×${tempImg.naturalHeight}px`);
      URL.revokeObjectURL(imgUrl);
    } else if (family === 'video' || family === 'audio') {
      const mediaUrl = URL.createObjectURL(file);
      const mediaEl = document.createElement(family === 'video' ? 'video' : 'audio');
      mediaEl.preload = 'metadata';
      mediaEl.src = mediaUrl;
      await new Promise((res, rej) => {
        mediaEl.onloadedmetadata = res;
        mediaEl.onerror = rej;
        setTimeout(rej, 3000);
      });
      if (isFinite(mediaEl.duration)) {
        const durFormatted = formatPlaybackDuration(mediaEl.duration);
        updateMeta(family === 'video' && mediaEl.videoWidth ? `${durFormatted} · ${mediaEl.videoWidth}×${mediaEl.videoHeight}` : durFormatted);
      }
      URL.revokeObjectURL(mediaUrl);
    }
  } catch {
    /* Non-critical metadata read */
  }
}

function renderTargetFormatChips(filterQuery = '') {
  const container = $('#format-chips-grid');
  container.innerHTML = '';
  const query = filterQuery.toLowerCase().trim().replace(/^\./, '');

  const filteredTargets = query
    ? activeSession.eligibleTargets.filter((t) => t.toLowerCase().includes(query))
    : activeSession.eligibleTargets;

  if (!filteredTargets.length) {
    container.innerHTML = `<span class="empty-format-hint">No formats matching "${filterQuery}"</span>`;
    return;
  }

  for (const targetFormat of filteredTargets) {
    const chipButton = document.createElement('button');
    chipButton.className = `format-chip ${targetFormat === activeSession.targetExt ? 'selected' : ''}`;
    chipButton.textContent = targetFormat.toUpperCase();
    chipButton.title = `Convert to .${targetFormat}`;
    chipButton.addEventListener('click', () => selectTargetFormat(targetFormat));
    container.appendChild(chipButton);
  }

  refreshOptionsView();
}

function selectTargetFormat(formatExt) {
  activeSession.targetExt = formatExt;
  for (const chip of $$('.format-chip')) {
    chip.classList.toggle('selected', chip.textContent.toLowerCase() === formatExt.toLowerCase());
  }
  refreshOptionsView();
}

$('#format-search-input').addEventListener('input', (e) => {
  renderTargetFormatChips(e.target.value);
});

function parseCustomPageRanges(rangeString, maximumPages) {
  const clean = rangeString.trim();
  if (!clean || /^all$/i.test(clean)) return null;
  const pageResultSet = new Set();

  for (const token of clean.split(/[,\s]+/).filter(Boolean)) {
    const match = /^(\d+)(?:-(\d+)?)?$/.exec(token);
    if (!match) throw new Error(`"${token}" is not a valid page number or range.`);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : token.endsWith('-') ? maximumPages || start : start;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    for (let page = lower; page <= upper; page++) {
      if (!maximumPages || page <= maximumPages) pageResultSet.add(page);
    }
  }

  return [...pageResultSet].sort((a, b) => a - b);
}

function refreshOptionsView() {
  const { familyKey, inputExt, targetExt } = activeSession;
  $('#dst-ext-preview').textContent = `.${targetExt}`;

  // Tuning / Quality visibility
  const showQuality = supportsTuningProfile(familyKey, inputExt, targetExt);
  $('#row-tuning-quality').hidden = !showQuality;

  // PDF Page Selection
  const isPdf = inputExt === 'pdf';
  $('#row-page-selector').hidden = !isPdf;

  const multiOutput = isSegmentedOutput(inputExt, targetExt);
  $('#row-multi-segmented').hidden = !multiOutput;

  if (isPdf) {
    let range;
    try {
      range = parseCustomPageRanges($('#page-range-input').value, activeSession.detectedTotalPages);
    } catch {
      range = undefined;
    }
    const count = range ? range.length : activeSession.detectedTotalPages;
    let summaryText = range === undefined ? 'Invalid range' : range ? `${count} of ${activeSession.detectedTotalPages ?? '?'}` : `All${count ? ` (${count})` : ''}`;
    if (multiOutput && range !== undefined && count !== 1) {
      summaryText += activeSession.segmentedMode === 'zip' ? ' · ZIP Archive' : ' · Individual Files';
    }
    $('#page-range-summary').textContent = summaryText;
  }

  let informativeNote = '';
  const willPopTab = shouldPromoteToStandaloneTab(activeSession);
  const tabAnnotation = willPopTab ? ' Opens in dedicated tab.' : '';

  if (familyKey === 'document' && targetExt === 'pdf') {
    informativeNote = 'Clean rasterized PDF page rendering.';
  } else if (familyKey === 'document' && targetExt === 'docx') {
    informativeNote = 'Exports standard WordprocessingML formatting.';
  } else if (familyKey === 'video' && ['mp4', 'mov', 'mkv', 'webm'].includes(targetExt)) {
    informativeNote = (activeSession.tuningPreset === 'compact' ? 'Optimizes compression for smaller file size.' : 'Retains maximum source fidelity with stream copy.') + tabAnnotation;
  } else if (willPopTab) {
    informativeNote = 'Large media file — converts in a dedicated background tab.';
  } else if (targetExt === 'ico') {
    informativeNote = 'Builds multi-resolution icon bundle (16px to 256px).';
  }

  $('#conversion-hint-note').textContent = informativeNote;
}

const TAB_TRANSFER_THRESHOLD = 10 * 1024 * 1024; // 10 MB
function shouldPromoteToStandaloneTab({ sourceFile, familyKey, inputExt, targetExt }) {
  if (IS_STANDALONE_TAB || !IS_EXTENSION_ENV || !sourceFile || !requiresTranscodeEngine(familyKey, inputExt, targetExt)) {
    return false;
  }
  return sourceFile.size > TAB_TRANSFER_THRESHOLD;
}

function updateSegmentedButtonState(containerSelector, activeValue) {
  for (const btn of $$(`${containerSelector} button`)) {
    btn.classList.toggle('active', btn.dataset.val === activeValue);
  }
}

function bindSegmentedSelector(containerSelector, onSelect) {
  $(containerSelector).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-val]');
    if (!btn || btn.disabled) return;
    updateSegmentedButtonState(containerSelector, btn.dataset.val);
    onSelect(btn.dataset.val);
  });
}

bindSegmentedSelector('#segment-tuning-quality', (val) => {
  activeSession.tuningPreset = val;
  refreshOptionsView();
});

bindSegmentedSelector('#segment-multi-mode', (val) => {
  activeSession.segmentedMode = val;
  refreshOptionsView();
});

$('#btn-toggle-pages').addEventListener('click', () => {
  const drawer = $('#page-range-drawer');
  drawer.hidden = !drawer.hidden;
  $('#row-page-selector').classList.toggle('expanded', !drawer.hidden);
  if (!drawer.hidden) $('#page-range-input').focus();
});

$('#page-range-input').addEventListener('input', refreshOptionsView);
$('#btn-change-source').addEventListener('click', () => {
  if (!activeSession.isConverting) triggerFileBrowser(activeSession.familyKey);
});

$('#btn-back-to-upload').addEventListener('click', async () => {
  if (!activeSession.isConverting) return switchViewStage('upload');

  const userConfirmed = await displayConfirmationModal({
    heading: 'Abort active conversion?',
    bodyText: 'Your file is currently processing. Going back will cancel the conversion.',
    cancelLabel: 'Keep Running',
    confirmLabel: 'Stop & Abort',
  });

  if (!userConfirmed || !activeSession.isConverting) return;
  activeSession.isConverting = false;
  location.replace(location.pathname + (IS_STANDALONE_TAB ? '?mode=tab' : ''));
});

function displayConfirmationModal({ heading, bodyText, cancelLabel = 'Cancel', confirmLabel = 'OK' }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'cg-modal-backdrop';
    backdrop.innerHTML = `
      <div class="cg-dialog" role="alertdialog" aria-modal="true">
        <h3 class="dialog-title">${sanitizeHtmlEntities(heading)}</h3>
        <p class="dialog-text">${sanitizeHtmlEntities(bodyText)}</p>
        <div class="dialog-button-bar">
          <button class="btn-dialog-secondary" id="dlg-btn-cancel">${sanitizeHtmlEntities(cancelLabel)}</button>
          <button class="btn-dialog-destructive" id="dlg-btn-confirm">${sanitizeHtmlEntities(confirmLabel)}</button>
        </div>
      </div>
    `;

    const cleanUp = (result) => {
      window.removeEventListener('keydown', onEscKey);
      backdrop.remove();
      resolve(result);
    };

    const onEscKey = (e) => {
      if (e.key === 'Escape') cleanUp(false);
    };

    $('#dlg-btn-cancel', backdrop).addEventListener('click', () => cleanUp(false));
    $('#dlg-btn-confirm', backdrop).addEventListener('click', () => cleanUp(true));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanUp(false);
    });

    window.addEventListener('keydown', onEscKey);
    document.body.appendChild(backdrop);
    $('#dlg-btn-cancel', backdrop).focus();
  });
}

function setProcessingBusyState(busy) {
  activeSession.isConverting = busy;
  const launchButton = $('#btn-execute-conversion');
  launchButton.disabled = busy;
  launchButton.classList.toggle('in-progress', busy);
  $('#execute-label').textContent = busy ? 'Converting…' : 'Start Conversion';

  for (const element of $$(
    '#stage-configure input, #stage-configure .format-chip, #stage-configure .segmented-control button, #btn-change-source, #btn-toggle-pages'
  )) {
    element.disabled = busy;
  }

  $('#keep-popup-advisory').textContent = IS_STANDALONE_TAB
    ? 'Keep this tab active until completed.'
    : 'Keep this popup open until completed.';
  $('#keep-popup-advisory').hidden = !busy || !IS_EXTENSION_ENV;
}

window.addEventListener('beforeunload', (e) => {
  if (!activeSession.isConverting || !navigator.userActivation?.hasBeenActive) return;
  e.preventDefault();
  e.returnValue = '';
});

function setProgressBarProgress(fraction) {
  const bar = $('#progress-fill-bar');
  if (fraction == null) {
    bar.classList.add('indeterminate');
    bar.style.width = '';
    $('#progress-percentage-label').textContent = '';
    return;
  }
  bar.classList.remove('indeterminate');
  const clamped = Math.max(0, Math.min(1, fraction));
  bar.style.width = `${(clamped * 100).toFixed(1)}%`;
  $('#progress-percentage-label').textContent = `${Math.round(clamped * 100)}%`;
}

const updateStatusCaption = (text) => {
  $('#progress-activity-label').textContent = text;
};

$('#btn-execute-conversion').addEventListener('click', executeConversionWorkflow);

async function executeConversionWorkflow() {
  if (activeSession.isConverting || !activeSession.sourceFile) return;

  const { sourceFile, familyKey, inputExt, targetExt, tuningPreset, segmentedMode } = activeSession;
  let parsedPages = null;

  if (inputExt === 'pdf') {
    try {
      parsedPages = parseCustomPageRanges($('#page-range-input').value, activeSession.detectedTotalPages);
    } catch (rangeError) {
      return presentConversionError(rangeError.message);
    }
    if (parsedPages && !parsedPages.length) {
      return presentConversionError('The requested page range falls outside this document.');
    }
  }

  const outputBaseName = sanitizeFileName($('#dst-name-input').value || stripFileExtension(sourceFile.name));
  const conversionJob = {
    sourceFile,
    familyKey,
    inputExt,
    targetExt,
    tuningPreset,
    segmentedMode,
    pageRange: parsedPages,
    outputBaseName,
  };

  if (shouldPromoteToStandaloneTab(activeSession)) {
    const transitTaskId = `task-${Date.now()}`;
    await stageTaskForTransit(transitTaskId, conversionJob);
    await extApi.tabs.create({ url: extApi.runtime.getURL(`app.html?mode=tab&job=${transitTaskId}`) });
    window.close();
    return;
  }

  await performEngineConversion(conversionJob);
}

function presentConversionError(errorMessage) {
  $('#conversion-progress-box').hidden = true;
  const errorEl = $('#conversion-error-banner');
  errorEl.textContent = errorMessage;
  errorEl.hidden = false;
}

async function performEngineConversion(job) {
  const { sourceFile, familyKey, inputExt, targetExt, outputBaseName } = job;
  setProcessingBusyState(true);
  $('#conversion-error-banner').hidden = true;
  $('#conversion-progress-box').hidden = false;
  updateStatusCaption('Preparing workspace…');
  setProgressBarProgress(null);

  const startTime = performance.now();
  const runtimeOptions = {
    tuningPreset: job.tuningPreset,
    familyKey,
    pageRange: job.pageRange,
    onStatusUpdate: updateStatusCaption,
    onProgressUpdate: setProgressBarProgress,
  };

  try {
    let payloadParts; // [{ blob, pageIndex? }]
    let savedNativePath = null;
    let pythonSuccess = false;

    if (IS_DESKTOP_ENV && sourceFile?.nativePath && typeof window.desktopAPI?.convertWithPython === 'function') {
      try {
        updateStatusCaption('Accelerating with CodeGreeks Python Engine…');
        const pyResult = await window.desktopAPI.convertWithPython({
          source_path: sourceFile.nativePath,
          target_format: targetExt,
          output_name: outputBaseName,
          tuning_preset: job.tuningPreset,
          page_range: job.pageRange,
        });

        if (pyResult && pyResult.success && pyResult.output_path) {
          const fileRes = await fetch(`file:///${pyResult.output_path.replace(/\\/g, '/')}`);
          const fileBlob = await fileRes.blob();
          payloadParts = [{ blob: fileBlob }];
          savedNativePath = pyResult.output_path;
          runtimeOptions.strategyMethod = 'CodeGreeks Python Engine (Offline)';
          pythonSuccess = true;
        }
      } catch (pyErr) {
        console.info('Python engine fallback to WebAssembly engine:', pyErr?.message);
      }
    }

    if (!pythonSuccess) {
      if (familyKey === 'image') {
        const { processImageConversion } = await import('./core/image_engine.js');
        payloadParts = [{ blob: await processImageConversion(sourceFile, inputExt, targetExt, runtimeOptions) }];
      } else if (familyKey === 'document') {
        const { processDocumentConversion } = await import('./core/document_engine.js');
        const docResult = await processDocumentConversion(sourceFile, inputExt, targetExt, runtimeOptions, outputBaseName);
        payloadParts = docResult.outputBlobs || [{ blob: docResult.outputBlob }];
      } else {
        const { processMediaConversion } = await import('./core/media_engine.js');
        payloadParts = [{ blob: await processMediaConversion(sourceFile, inputExt, targetExt, runtimeOptions) }];
      }
    }

    setProgressBarProgress(1);
    updateStatusCaption('Packaging final file…');

    let finalizedFiles;
    if (payloadParts.length === 1) {
      finalizedFiles = [{ blob: payloadParts[0].blob, filename: `${outputBaseName}.${targetExt}` }];
    } else {
      const maxIndexDigits = String(Math.max(...payloadParts.map((p, i) => p.pageIndex || i + 1))).length;
      const namedFiles = payloadParts.map((item, idx) => ({
        blob: item.blob,
        filename: `${outputBaseName}_page_${String(item.pageIndex || idx + 1).padStart(Math.max(maxIndexDigits, 2), '0')}.${targetExt}`,
      }));

      if (job.segmentedMode === 'individual') {
        finalizedFiles = namedFiles;
      } else {
        const zipArchive = {};
        for (const fileItem of namedFiles) {
          zipArchive[fileItem.filename] = new Uint8Array(await fileItem.blob.arrayBuffer());
        }
        finalizedFiles = [
          {
            blob: new Blob([zipSync(zipArchive, { level: 0 })], { type: 'application/zip' }),
            filename: `${outputBaseName}_archive.zip`,
          },
        ];
      }
    }

    const durationSeconds = (performance.now() - startTime) / 1000;
    userConfig.usageTally[familyKey] = (userConfig.usageTally[familyKey] || 0) + 1;
    persistPreferences(userConfig);

    completedResult = {
      files: finalizedFiles,
      unitCount: payloadParts.length,
      familyKey,
      inputExt,
      targetExt,
      durationSeconds,
      strategyMethod: runtimeOptions.strategyMethod,
      downloadIds: savedNativePath ? [savedNativePath] : [],
      hasBeenSaved: Boolean(savedNativePath),
    };

    if (userConfig.instantDownload && !savedNativePath) {
      await commitResultDownloads();
    }

    displayCompletionStage();
    recordConversionHistory({
      displayName: finalizedFiles.length > 1 ? `${finalizedFiles.length} files` : finalizedFiles[0].filename,
      familyKey,
      inputExt,
      targetExt,
      totalBytes: finalizedFiles.reduce((acc, f) => acc + f.blob.size, 0),
      timestamp: Date.now(),
      downloadId: completedResult.downloadIds[0] ?? null,
    });
  } catch (conversionError) {
    console.warn('Conversion pipeline error:', conversionError);
    presentConversionError(conversionError?.message || 'The conversion encountered an unexpected error.');
  } finally {
    setProcessingBusyState(false);
  }
}

async function commitResultDownloads() {
  for (let idx = 0; idx < completedResult.files.length; idx++) {
    if (idx > 0) await new Promise((res) => setTimeout(res, 120));
    const targetFile = completedResult.files[idx];
    completedResult.downloadIds.push(await triggerFileSave(targetFile.blob, targetFile.filename));
  }
  completedResult.hasBeenSaved = true;
}

async function triggerFileSave(fileBlob, outputFilename) {
  if (IS_DESKTOP_ENV) {
    try {
      const arrayBuffer = await fileBlob.arrayBuffer();
      const saveRes = await window.desktopAPI.saveConvertedBuffer(
        outputFilename,
        new Uint8Array(arrayBuffer),
        userConfig.destinationSubfolder || null
      );
      if (saveRes?.savedPath) {
        return saveRes.savedPath;
      }
    } catch (desktopErr) {
      console.warn('Desktop native save failed, using fallback:', desktopErr);
    }
  }

  const objectUrl = URL.createObjectURL(fileBlob);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);

  const subfolder = userConfig.destinationSubfolder
    .split(/[\\/]+/)
    .map((s) => sanitizeFileName(s))
    .filter((s) => s && s.toLowerCase() !== 'converted')
    .join('/');

  if (IS_EXTENSION_ENV && extApi.downloads) {
    try {
      return await extApi.downloads.download({
        url: objectUrl,
        filename: subfolder ? `${subfolder}/${outputFilename}` : outputFilename,
        conflictAction: userConfig.promptFileCollision ? 'prompt' : 'uniquify',
      });
    } catch (downloadErr) {
      console.warn('Browser downloads API failed, triggering DOM anchor:', downloadErr);
    }
  }

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = outputFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return null;
}

/* ================= STAGE 3: COMPLETE ================= */

function displayCompletionStage() {
  const resultData = completedResult;
  const primaryItem = resultData.files[0];
  const combinedBytes = resultData.files.reduce((sum, f) => sum + f.blob.size, 0);
  const targetLabel = resultData.targetExt.toUpperCase();

  $('#done-file-title').textContent = resultData.files.length > 1 ? `${resultData.files.length} Files Ready` : primaryItem.filename;

  $('#done-file-subtitle').textContent =
    resultData.unitCount > 1
      ? `${resultData.unitCount} ${targetLabel} elements · ${formatByteMetric(combinedBytes)}${resultData.files.length > 1 ? ' · individual' : ' · archive'}`
      : `${targetLabel} Document · ${formatByteMetric(combinedBytes)}`;

  $('#stat-flow-tag').textContent = `${resultData.inputExt.toUpperCase()} → ${targetLabel}`;
  $('#stat-filesize-tag').textContent = formatByteMetric(combinedBytes);
  $('#stat-duration-tag').textContent = formatElapsedSeconds(resultData.durationSeconds);

  refreshSavedStatusUI();
  switchViewStage('complete');
}

function refreshSavedStatusUI() {
  const folderTarget = userConfig.destinationSubfolder.trim() ? `Downloads / ${userConfig.destinationSubfolder.trim()}` : 'your Downloads folder';

  $('#done-saved-caption').innerHTML = completedResult.hasBeenSaved
    ? `Successfully converted on your device.<br>Saved to <b>${sanitizeHtmlEntities(folderTarget)}</b>.`
    : 'File converted on this device.<br>Click below to download your file.';

  $('#btn-save-again').hidden = completedResult.hasBeenSaved;
  $('#badge-saved-success').hidden = !completedResult.hasBeenSaved;
}

$('#btn-save-again').addEventListener('click', async () => {
  await commitResultDownloads();
  refreshSavedStatusUI();
});

$('#done-file-title').addEventListener('click', () => {
  const targetDownloadId = completedResult?.downloadIds?.[0];
  if (targetDownloadId != null) {
    if (IS_DESKTOP_ENV && typeof targetDownloadId === 'string') {
      window.desktopAPI.showInFolder(targetDownloadId);
      return;
    }
    if (IS_EXTENSION_ENV) {
      if (typeof extApi.downloads?.show === 'function') {
        extApi.downloads.show(targetDownloadId);
      } else if (typeof extApi.downloads?.open === 'function') {
        extApi.downloads.open(targetDownloadId);
      }
    }
  }
});

const returnToStudioHome = () => {
  completedResult = null;
  activeSession.sourceFile = null;
  switchViewStage('upload');
};

$('#btn-convert-another').addEventListener('click', returnToStudioHome);
$('#btn-close-done').addEventListener('click', returnToStudioHome);

/* ================= SETTINGS DRAWER ================= */

function openSettingsDrawer() {
  updateSegmentedButtonState('#segment-sort-pref', userConfig.sortStrategy);
  updateSegmentedButtonState('#segment-default-quality', userConfig.tuningPreset);
  updateSegmentedButtonState('#segment-default-multi', userConfig.segmentedPackaging);
  updateSegmentedButtonState('#segment-theme-pref', userConfig.colorTheme);

  $('#pref-preserve-basename').checked = userConfig.preserveSourceBasename;
  $('#pref-auto-download').checked = userConfig.instantDownload;
  $('#pref-prompt-overwrite').checked = userConfig.promptFileCollision;
  $('#pref-custom-subfolder').value = userConfig.destinationSubfolder;

  $('#folder-summary-display').textContent = userConfig.destinationSubfolder.trim()
    ? `Downloads / ${userConfig.destinationSubfolder.trim()}`
    : 'Downloads (Root)';

  $('#app-version-caption').textContent = `CodeGreeks Studio v${APP_VERSION} · ${TOTAL_SYSTEM_FORMATS} Formats`;

  renderFamilySettingsList();
  switchViewStage('settings');
}

function renderFamilySettingsList() {
  const listRoot = $('#settings-family-list');
  listRoot.innerHTML = '';

  for (const familyId of rankMediaFamilies()) {
    const familyData = MEDIA_MATRIX[familyId];
    const cfg = userConfig.familyConfigs[familyId];
    const allowedOutputs = familyData.potentialOutputs.filter((o) => !cfg.blacklistedFormats.includes(canonicalExtension(o)));

    const itemLi = document.createElement('li');
    itemLi.className = `settings-family-card ${cfg.suppressed ? 'suppressed' : ''}`;
    itemLi.dataset.familyId = familyId;
    itemLi.innerHTML = `
      <div class="family-head">
        <span class="family-icon">${VECTOR_GLYPHS[familyData.glyphKey]}</span>
        <div class="family-meta">
          <b>${familyData.displayName}</b>
          <small>Default Target → <span class="accent-text">${cfg.defaultFormat.toUpperCase()}</span></small>
        </div>
        <button class="btn-toggle-family-formats" aria-label="Toggle Formats">${VECTOR_GLYPHS.chevron_down}</button>
        <label class="switch-control">
          <input type="checkbox" class="family-visibility-switch" ${cfg.suppressed ? '' : 'checked'} aria-label="Enable ${familyData.displayName}">
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="family-body" hidden>
        <div class="sub-label">DEFAULT OUTPUT</div>
        <div class="pills-cluster">
          ${allowedOutputs.map((opt) => `<button class="format-pill ${opt === cfg.defaultFormat ? 'selected' : ''}" data-default-target="${opt}">${opt.toUpperCase()}</button>`).join('')}
        </div>
        <div class="sub-label">ACTIVE FORMATS</div>
        <div class="pills-cluster">
          ${[...new Set([...familyData.acceptedInputs, ...familyData.potentialOutputs].map(canonicalExtension))].map((f) => `<button class="format-pill ${cfg.blacklistedFormats.includes(f) ? 'inactive' : 'selected'}" data-toggle-format="${f}">${f.toUpperCase()}</button>`).join('')}
        </div>
      </div>
    `;

    listRoot.appendChild(itemLi);
  }
}

$('#settings-family-list').addEventListener('click', async (e) => {
  const card = e.target.closest('.settings-family-card');
  if (!card) return;
  const familyId = card.dataset.familyId;
  const cfg = userConfig.familyConfigs[familyId];

  const defaultBtn = e.target.closest('[data-default-target]');
  if (defaultBtn) {
    cfg.defaultFormat = defaultBtn.dataset.defaultTarget;
    await persistAndRefresh();
    return renderFamilySettingsList();
  }

  const toggleFmtBtn = e.target.closest('[data-toggle-format]');
  if (toggleFmtBtn) {
    const formatName = toggleFmtBtn.dataset.toggleFormat;
    if (cfg.blacklistedFormats.includes(formatName)) {
      cfg.blacklistedFormats = cfg.blacklistedFormats.filter((x) => x !== formatName);
    } else {
      cfg.blacklistedFormats.push(formatName);
    }
    await persistAndRefresh();
    return renderFamilySettingsList();
  }

  if (e.target.closest('.btn-toggle-family-formats')) {
    const body = $('.family-body', card);
    body.hidden = !body.hidden;
    card.classList.toggle('expanded', !body.hidden);
  }
});

$('#settings-family-list').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('family-visibility-switch')) return;
  const familyId = e.target.closest('.settings-family-card').dataset.familyId;
  const activeCount = SUPPORTED_FAMILIES.filter((x) => !userConfig.familyConfigs[x].suppressed).length;

  if (!e.target.checked && activeCount === 1) {
    e.target.checked = true;
    return presentToast('At least one media category must remain active.');
  }

  userConfig.familyConfigs[familyId].suppressed = !e.target.checked;
  await persistAndRefresh();
  renderFamilySettingsList();
});

bindSegmentedSelector('#segment-sort-pref', async (val) => {
  userConfig.sortStrategy = val;
  await persistAndRefresh();
  renderFamilySettingsList();
});

bindSegmentedSelector('#segment-default-quality', (val) => {
  userConfig.tuningPreset = val;
  persistAndRefresh();
});

bindSegmentedSelector('#segment-default-multi', (val) => {
  userConfig.segmentedPackaging = val;
  persistAndRefresh();
});

bindSegmentedSelector('#segment-theme-pref', (val) => {
  userConfig.colorTheme = val;
  persistAndRefresh();
});

$('#pref-preserve-basename').addEventListener('change', (e) => {
  userConfig.preserveSourceBasename = e.target.checked;
  persistAndRefresh();
});

$('#pref-auto-download').addEventListener('change', (e) => {
  userConfig.instantDownload = e.target.checked;
  persistAndRefresh();
});

$('#pref-prompt-overwrite').addEventListener('change', (e) => {
  userConfig.promptFileCollision = e.target.checked;
  persistAndRefresh();
});

$('#pref-custom-subfolder').addEventListener('change', (e) => {
  userConfig.destinationSubfolder = e.target.value
    .split(/[\\/]+/)
    .map((s) => s.replace(/[:*?"<>|]/g, '').trim())
    .filter(Boolean)
    .join('/');
  persistAndRefresh();
  $('#folder-summary-display').textContent = userConfig.destinationSubfolder.trim()
    ? `Downloads / ${userConfig.destinationSubfolder.trim()}`
    : 'Downloads (Root)';
});

$('#btn-folder-expand').addEventListener('click', () => {
  const panel = $('#folder-config-box');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) $('#pref-custom-subfolder').focus();
});

$('#btn-about-expand').addEventListener('click', () => {
  const aboutBox = $('#about-info-box');
  aboutBox.hidden = !aboutBox.hidden;
});

$('#btn-reset-preferences').addEventListener('click', async () => {
  userConfig = generateDefaultPreferences();
  await persistAndRefresh();
  openSettingsDrawer();
  presentToast('Settings reset to default values.');
});

$('#btn-open-settings').addEventListener('click', openSettingsDrawer);
$('#btn-settings-back').addEventListener('click', () => switchViewStage('upload'));

$('#btn-workspace-settings')?.addEventListener('click', openSettingsDrawer);
$('#btn-desktop-back-upload')?.addEventListener('click', () => $('#btn-back-to-upload')?.click());
$('#btn-desktop-back-settings')?.addEventListener('click', () => {
  switchViewStage(activeSession.sourceFile ? 'configure' : 'upload');
});
$('#btn-tab-back-home')?.addEventListener('click', returnToStudioHome);

$('#tab-nav-brand')?.addEventListener('click', async () => {
  if (activeSession.isConverting) {
    const shouldAbort = await triggerActionDialog(
      'Abort Current Conversion?',
      'A file conversion is currently executing. Leaving now will cancel the progress.',
      'Cancel Conversion',
      'Keep Running'
    );
    if (!shouldAbort) return;
  }
  returnToStudioHome();
});

$('#workspace-breadcrumbs')?.addEventListener('click', async (e) => {
  const stepLi = e.target.closest('li[data-step]');
  if (!stepLi) return;
  const targetStep = stepLi.dataset.step;
  if (targetStep === 'upload') {
    if (activeSession.isConverting) {
      const shouldAbort = await triggerActionDialog(
        'Abort Current Conversion?',
        'A file conversion is currently executing. Leaving now will cancel the progress.',
        'Cancel Conversion',
        'Keep Running'
      );
      if (!shouldAbort) return;
    }
    returnToStudioHome();
  } else if (targetStep === 'configure') {
    if (activeSession.sourceFile && !activeSession.isConverting) {
      switchViewStage('configure');
    }
  } else if (targetStep === 'complete') {
    if (completedResult && !activeSession.isConverting) {
      switchViewStage('complete');
    }
  }
});

$('#btn-workspace-theme')?.addEventListener('click', async () => {
  const isDark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const nextTheme = isDark ? 'light' : 'dark';
  userConfig.colorTheme = nextTheme;
  await persistPreferences(userConfig);
  synchronizeColorTheme();
  updateSegmentedButtonState('#segment-theme-pref', nextTheme);
  presentToast(`Switched to ${nextTheme === 'dark' ? 'Dark' : 'Light'} theme`);
});

$('#btn-expand-tab').addEventListener('click', () => {
  if (IS_EXTENSION_ENV) {
    extApi.tabs.create({ url: extApi.runtime.getURL('app.html?mode=tab') });
    window.close();
  }
});

/* ================= HISTORY LEDGER ================= */

const CODEGREEKS_HISTORY_KEY = 'codegreeks_conversion_history';
const LEGACY_HISTORY_KEY = 'omni_conversion_history';

async function fetchConversionHistory() {
  try {
    if (IS_EXTENSION_ENV && extApi.storage?.local) {
      const stored = await extApi.storage.local.get([CODEGREEKS_HISTORY_KEY, LEGACY_HISTORY_KEY]);
      return stored[CODEGREEKS_HISTORY_KEY] || stored[LEGACY_HISTORY_KEY] || [];
    }
    return JSON.parse(
      localStorage.getItem(CODEGREEKS_HISTORY_KEY) ||
      localStorage.getItem(LEGACY_HISTORY_KEY) ||
      '[]'
    );
  } catch {
    return [];
  }
}

async function clearConversionHistory() {
  try {
    if (IS_EXTENSION_ENV && extApi.storage?.local) {
      await extApi.storage.local.remove([CODEGREEKS_HISTORY_KEY, LEGACY_HISTORY_KEY]);
    }
    localStorage.removeItem(CODEGREEKS_HISTORY_KEY);
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    /* ignore */
  }
  await renderHistoryLedgerList();
  presentToast('Conversion history cleared.');
}

async function recordConversionHistory(entry) {
  try {
    const list = [entry, ...(await fetchConversionHistory())].slice(0, 10);
    if (IS_EXTENSION_ENV && extApi.storage?.local) {
      await extApi.storage.local.set({ [CODEGREEKS_HISTORY_KEY]: list });
    } else {
      localStorage.setItem(CODEGREEKS_HISTORY_KEY, JSON.stringify(list));
    }
  } catch {
    /* History logging is optional */
  }
  if (IS_STANDALONE_TAB) renderHistoryLedgerList();
}

async function renderHistoryLedgerList() {
  const historyList = $('#history-ledger-list');
  if (!historyList) return;

  const records = await fetchConversionHistory();
  const countBadge = $('#history-count-badge');
  if (countBadge) countBadge.textContent = records.length;

  historyList.innerHTML = '';

  if (!records.length) {
    historyList.innerHTML = '<li class="history-empty-note">No recent conversions yet. Files you convert in this session will appear here.</li>';
    return;
  }

  for (const item of records.slice(0, 8)) {
    const li = document.createElement('li');
    li.className = 'history-item-row';
    li.innerHTML = `
      <span class="history-item-icon ${item.familyKey}">${VECTOR_GLYPHS[item.familyKey] || VECTOR_GLYPHS.document}</span>
      <div class="history-item-details">
        <span class="history-item-name" title="${sanitizeHtmlEntities(item.displayName)}">${sanitizeHtmlEntities(item.displayName)}</span>
        <span class="history-item-meta">${item.inputExt.toUpperCase()} → ${item.targetExt.toUpperCase()} · ${formatByteMetric(item.totalBytes)}</span>
      </div>
      <span class="history-item-time">${formatTimeAgo(item.timestamp)}</span>
    `;

    const canAccessDownload = IS_EXTENSION_ENV && (typeof extApi.downloads?.show === 'function' || typeof extApi.downloads?.open === 'function');
    const isDesktopDownload = IS_DESKTOP_ENV && typeof item.downloadId === 'string';
    if (item.downloadId != null && (canAccessDownload || isDesktopDownload)) {
      li.classList.add('actionable');
      li.title = isDesktopDownload ? 'Show file in folder' : (typeof extApi.downloads?.show === 'function' ? 'Show in downloads folder' : 'Open file');
      li.addEventListener('click', () => {
        if (isDesktopDownload) {
          window.desktopAPI.showInFolder(item.downloadId);
          return;
        }
        if (typeof extApi.downloads?.show === 'function') extApi.downloads.show(item.downloadId);
        else if (typeof extApi.downloads?.open === 'function') extApi.downloads.open(item.downloadId);
      });
    }

    historyList.appendChild(li);
  }
}

$('#btn-clear-history-log')?.addEventListener('click', clearConversionHistory);

function formatTimeAgo(epochMs) {
  const deltaSec = (Date.now() - epochMs) / 1000;
  if (deltaSec < 60) return 'Just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return new Date(epochMs).toLocaleDateString();
}

/* ================= WORKSPACE TAB MODE ================= */

function updateBreadcrumbTracker(currentStage) {
  const stages = ['upload', 'configure', 'complete'];
  const curIdx = stages.indexOf(currentStage);

  for (const stepItem of $$('#workspace-breadcrumbs [data-step]')) {
    const stepIdx = stages.indexOf(stepItem.dataset.step);
    stepItem.classList.toggle('active', stepIdx === curIdx);
    stepItem.classList.toggle('completed', curIdx > -1 && stepIdx < curIdx);
  }
}

function refreshWorkspaceSidebar() {
  $('#tab-metric-formats').textContent = `${TOTAL_SYSTEM_FORMATS} Formats`;
  renderHistoryLedgerList();
}

/* ================= DEMO SAMPLE GENERATOR ================= */

async function generateDemoSample() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  // Vibrant aesthetic CodeGreeks tech gradient backdrop
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, '#181715');
  gradient.addColorStop(0.5, '#2b1b14');
  gradient.addColorStop(1, '#0e0e11');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);

  // Geometric elements in CodeGreeks vermilion & gold
  ctx.fillStyle = '#e2482c';
  ctx.beginPath();
  ctx.roundRect(460, 200, 360, 280, 24);
  ctx.fill();

  ctx.fillStyle = '#eda23c';
  ctx.beginPath();
  ctx.arc(840, 220, 60, 0, Math.PI * 2);
  ctx.fill();

  // Status dot
  ctx.fillStyle = '#248a58';
  ctx.beginPath();
  ctx.arc(430, 230, 30, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fffdf8';
  ctx.font = '700 52px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CodeGreeks Studio', 640, 560);

  const sampleBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  ingestSourceFile(new File([sampleBlob], 'codegreeks_sample.png', { type: 'image/png' }), null);
}

/* ================= INITIALIZATION & BOOTSTRAP ================= */

(async function bootstrapApplication() {
  injectVectorGlyphs();
  userConfig = await retrievePreferences();
  synchronizeColorTheme();

  renderHubCategories();
  if (IS_STANDALONE_TAB) refreshWorkspaceSidebar();
  switchViewStage('upload');

  if (IS_DESKTOP_ENV) {
    try {
      const pyStatus = await window.desktopAPI.getPythonStatus();
      if (pyStatus?.available) {
        console.log('[CodeGreeks Desktop] Python engine connected:', pyStatus);
        const formatMetric = $('#tab-metric-formats');
        if (formatMetric) {
          formatMetric.textContent = `${TOTAL_SYSTEM_FORMATS} Formats • Python ${pyStatus.python} Active`;
          formatMetric.title = `CodeGreeks Engine v${pyStatus.version} (100% Offline)\nPIL: ${pyStatus.capabilities?.pil ? 'Ready' : 'N/A'}\nPyMuPDF: ${pyStatus.capabilities?.fitz ? 'Ready' : 'N/A'}`;
        }
      }

      if (window.desktopAPI.onFilesOpened) {
        window.desktopAPI.onFilesOpened(async (files) => {
          if (files && files.length > 0) {
            const item = files[0];
            try {
              const res = await fetch(`file:///${item.path.replace(/\\/g, '/')}`);
              const blob = await res.blob();
              const fileObj = new File([blob], item.name, { type: blob.type || 'application/octet-stream' });
              fileObj.nativePath = item.path;
              ingestSourceFile(fileObj, null);
            } catch (err) {
              console.warn('Error ingesting file opened from menu:', err);
            }
          }
        });
      }
    } catch (e) {
      console.warn('Desktop initialization notice:', e);
    }
  }

  const curtain = getDropCurtain();
  if (curtain) {
    curtain.hidden = true;
    curtain.classList.remove('active');
  }

  const handoffJobId = urlParams.get('job');
  purgeExpiredTransitTasks(60000, handoffJobId);

  if (handoffJobId) {
    const stagedTask = await retrieveStagedTask(handoffJobId).catch(() => null);
    await discardStagedTask(handoffJobId).catch(() => {});
    history.replaceState(null, '', `${location.pathname}?mode=tab`);

    if (!stagedTask) {
      return presentToast('The queued conversion expired. Please select the file again.');
    }

    ingestSourceFile(stagedTask.sourceFile, null);
    activeSession.handoffActive = true;
    $('#dst-name-input').value = stagedTask.outputBaseName;
    selectTargetFormat(stagedTask.targetExt);

    activeSession.tuningPreset = stagedTask.tuningPreset;
    updateSegmentedButtonState('#segment-tuning-quality', stagedTask.tuningPreset);

    activeSession.segmentedMode = stagedTask.segmentedMode;
    updateSegmentedButtonState('#segment-multi-mode', stagedTask.segmentedMode);

    if (stagedTask.pageRange) {
      $('#page-range-input').value = stagedTask.pageRange.join(', ');
    }

    refreshOptionsView();
    performEngineConversion(stagedTask);
  }
})();
