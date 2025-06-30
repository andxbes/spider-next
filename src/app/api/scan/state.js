// src/app/api/scan/state.js
import { getAllScannedSites, updateScanStatus } from "../../../spider/db";

/**
 * Карта для хранения активных процессов сканирования.
 * Ключ: dbName (домен сайта)
 * Значение: { worker, status, progress, logs }
 */
export const scanProcesses = new Map();

let staleScansCleaned = false;

// Функция для очистки "зависших" сканирований при старте сервера
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
