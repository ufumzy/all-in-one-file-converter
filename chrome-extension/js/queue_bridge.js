/**
 * CodeGreeks File Studio Queue Bridge
 * High-capacity IndexedDB vault for handoff of large conversion jobs from popup to dedicated tab.
 */

const VAULT_NAME = 'codegreeks_transfer_vault';
const LEGACY_VAULT_NAME = 'omni_transfer_vault';
const STORE_NAME = 'transit_queue';

function openVault(dbName = VAULT_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function executeVaultTx(accessMode, callback, dbName = VAULT_NAME) {
  const db = await openVault(dbName);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, accessMode);
    const store = transaction.objectStore(STORE_NAME);
    const resultToken = callback(store);
    transaction.oncomplete = () => {
      db.close();
      resolve(resultToken && 'result' in resultToken ? resultToken.result : undefined);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export const stageTaskForTransit = (taskId, taskPayload) =>
  executeVaultTx('readwrite', (store) => store.put(taskPayload, taskId));

export const retrieveStagedTask = async (taskId) => {
  try {
    const result = await executeVaultTx('readonly', (store) => store.get(taskId));
    if (result) return result;
  } catch {
    /* Continue to legacy fallback */
  }
  try {
    return await executeVaultTx('readonly', (store) => store.get(taskId), LEGACY_VAULT_NAME);
  } catch {
    return undefined;
  }
};

export const discardStagedTask = (taskId) =>
  executeVaultTx('readwrite', (store) => store.delete(taskId));

export async function purgeExpiredTransitTasks(maxAgeMs = 60000, preserveId = null) {
  try {
    const keys = await executeVaultTx('readonly', (store) => store.getAllKeys());
    const now = Date.now();
    const staleKeys = (keys || []).filter((key) => {
      if (key === preserveId) return false;
      const timestamp = Number(String(key).replace(/^task-/, ''));
      return !timestamp || now - timestamp > maxAgeMs;
    });

    if (staleKeys.length) {
      await executeVaultTx('readwrite', (store) => {
        for (const staleKey of staleKeys) store.delete(staleKey);
      });
    }
    return staleKeys.length;
  } catch {
    return 0;
  }
}
