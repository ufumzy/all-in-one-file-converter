/**
 * CodeGreeks File Studio Configuration & Preferences Store
 * Engineered by CodeGreeks Technologies (https://codegreeks.com.ng/)
 * Synchronized settings module with resilient fallback to localStorage.
 */

import { MEDIA_MATRIX, SUPPORTED_FAMILIES } from './registry.js';

export const CODEGREEKS_PREFS_KEY = 'codegreeks_converter_preferences';
export const CODEGREEKS_THEME_KEY = 'codegreeks_ui_theme';
// Backward compatibility aliases
export const OMNI_PREFS_KEY = CODEGREEKS_PREFS_KEY;
export const OMNI_THEME_KEY = CODEGREEKS_THEME_KEY;
const LEGACY_PREFS_KEY = 'omni_converter_preferences';

const extApi = globalThis.browser || globalThis.chrome;
const hasSyncStorage = () => typeof extApi !== 'undefined' && !!extApi.storage?.sync;

export function generateDefaultPreferences() {
  const familyConfigs = {};
  for (const familyId of SUPPORTED_FAMILIES) {
    familyConfigs[familyId] = {
      suppressed: false,
      blacklistedFormats: [],
      defaultFormat: MEDIA_MATRIX[familyId].fallbackTarget,
    };
  }
  return {
    version: 3,
    ordering: [...SUPPORTED_FAMILIES],
    sortStrategy: 'custom', // 'custom' | 'frequency' | 'alphabetical'
    usageTally: {},
    familyConfigs,
    tuningPreset: 'balanced', // 'compact' | 'balanced' | 'pristine'
    preserveSourceBasename: true,
    segmentedPackaging: 'zip', // 'zip' | 'individual'
    instantDownload: true,
    destinationSubfolder: '',
    promptFileCollision: false,
    colorTheme: 'auto', // 'light' | 'dark' | 'auto'
  };
}

export async function retrievePreferences() {
  const defaults = generateDefaultPreferences();
  let stored = null;

  try {
    if (hasSyncStorage()) {
      const response = await extApi.storage.sync.get([CODEGREEKS_PREFS_KEY, LEGACY_PREFS_KEY]);
      stored = response ? (response[CODEGREEKS_PREFS_KEY] || response[LEGACY_PREFS_KEY]) : null;
    }
  } catch (err) {
    console.warn('Sync retrieval failed, checking local backup:', err);
  }

  if (!stored) {
    try {
      stored = JSON.parse(
        localStorage.getItem(CODEGREEKS_PREFS_KEY) ||
        localStorage.getItem(LEGACY_PREFS_KEY) ||
        'null'
      );
    } catch {
      stored = null;
    }
  }

  if (!stored) return defaults;

  // Normalize and migrate
  if (typeof stored.tuningPreset !== 'string') {
    stored.tuningPreset = stored.quality === 'small' ? 'compact' : stored.quality === 'best' ? 'pristine' : 'balanced';
  }
  if (stored.multiPage) {
    stored.segmentedPackaging = stored.multiPage === 'separate' ? 'individual' : 'zip';
  }
  if (typeof stored.autoDownload === 'boolean') {
    stored.instantDownload = stored.autoDownload;
  }
  if (typeof stored.keepName === 'boolean') {
    stored.preserveSourceBasename = stored.keepName;
  }

  const verifiedOrder = (stored.ordering || stored.order || []).filter((id) => SUPPORTED_FAMILIES.includes(id));
  for (const familyId of SUPPORTED_FAMILIES) {
    if (!verifiedOrder.includes(familyId)) verifiedOrder.push(familyId);
  }

  const mergedFamilies = {};
  for (const familyId of SUPPORTED_FAMILIES) {
    const rawFamily = stored.familyConfigs?.[familyId] || stored.cats?.[familyId] || {};
    mergedFamilies[familyId] = {
      suppressed: Boolean(rawFamily.suppressed ?? rawFamily.hidden),
      blacklistedFormats: Array.isArray(rawFamily.blacklistedFormats || rawFamily.hiddenFormats)
        ? rawFamily.blacklistedFormats || rawFamily.hiddenFormats
        : [],
      defaultFormat: rawFamily.defaultFormat || rawFamily.defaultOut || MEDIA_MATRIX[familyId].fallbackTarget,
    };
  }

  return {
    ...defaults,
    ...stored,
    ordering: verifiedOrder,
    familyConfigs: mergedFamilies,
  };
}

export async function persistPreferences(prefsObject) {
  try {
    if (hasSyncStorage()) {
      await extApi.storage.sync.set({ [CODEGREEKS_PREFS_KEY]: prefsObject });
    }
  } catch (err) {
    console.warn('Failed to sync preferences:', err);
  }

  try {
    localStorage.setItem(CODEGREEKS_PREFS_KEY, JSON.stringify(prefsObject));
  } catch (err) {
    console.warn('Failed to save local preferences backup:', err);
  }
}

export const COMPRESSION_TUNING = {
  compact: { img: 0.72, scale: 1.5, label: 'Compact' },
  balanced: { img: 0.86, scale: 2.0, label: 'Balanced' },
  pristine: { img: 0.96, scale: 3.0, label: 'Pristine' },
};
