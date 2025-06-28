// src/app/api/scan/state.js
import { updateScanStatus, getAllScannedSites } from '@/spider/db';

// Общее состояние в памяти для всех API-роутов, которые импортируют этот модуль.
export const scanProcesses = new Map();

let staleScansCleaned = false;

/**
 * Находит сканирования, которые были прерваны перезапуском сервера, и помечает их как 'error'.
 * Выполняется только один раз за время жизни процесса сервера.
 */
export function runStaleScansCleanup() {
    if (staleScansCleaned) {
        return;
    }

    console.log('[API_CLEANUP] Выполняется одноразовая проверка на зависшие сканирования...');
    try {
        const allSites = getAllScannedSites();
        for (const site of allSites) {
            if ((site.status === 'pending' || site.status === 'scanning') && !scanProcesses.has(site.dbName)) {
                console.warn(`[API_CLEANUP] Найдено зависшее сканирование для ${site.dbName}. Установка статуса 'error'.`);
                updateScanStatus(site.dbName, 'error');
            }
        }
    } catch (e) {
        console.error('[API_CLEANUP] Ошибка во время очистки зависших сканирований:', e);
    }
    staleScansCleaned = true;
}
