// lib/scanMetadata.js
const fs = require('fs');
const path = require('path');

// Путь к файлу, где будут храниться метаданные о сканированиях
const METADATA_FILE = path.resolve(process.cwd(), 'scan_metadata.json');

/**
 * Читает метаданные из файла.
 * @returns {Array<Object>} Массив объектов метаданных сканирований.
 */
function readMetadata() {
    if (!fs.existsSync(METADATA_FILE)) {
        return [];
    }
    try {
        const data = fs.readFileSync(METADATA_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`[METADATA] Ошибка чтения метаданных: ${error.message}`);
        return []; // Возвращаем пустой массив в случае ошибки парсинга или чтения
    }
}

/**
 * Записывает метаданные в файл.
 * @param {Array<Object>} metadata - Массив объектов метаданных для записи.
 */
function writeMetadata(metadata) {
    try {
        fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
    } catch (error) {
        console.error(`[METADATA] Ошибка записи метаданных: ${error.message}`);
    }
}

/**
 * Добавляет новую запись о сканировании или обновляет существующую.
 * Если для данного домена уже есть запись, она будет перезаписана.
 * @param {string} domain - Домен сайта.
 * @param {string} dbName - Имя файла базы данных для этого домена.
 * @param {string} status - Текущий статус сканирования ('pending', 'completed', 'error').
 */
function addScanEntry(domain, dbName, status) {
    const metadata = readMetadata();
    const now = new Date().toISOString();

    // Удаляем старые записи для того же домена, чтобы избежать дубликатов
    const existingIndex = metadata.findIndex(entry => entry.domain === domain);
    if (existingIndex !== -1) {
        metadata.splice(existingIndex, 1);
    }

    metadata.push({
        id: dbName, // Используем dbName как уникальный ID записи
        domain: domain,
        dbName: dbName,
        scannedAt: now,
        status: status,
    });
    writeMetadata(metadata);
    console.log(`[METADATA] Добавлена/Обновлена запись для ${domain}, статус: ${status}`);
}

/**
 * Обновляет статус существующей записи сканирования.
 * @param {string} dbName - Имя базы данных записи, которую нужно обновить.
 * @param {string} status - Новый статус ('pending', 'completed', 'error').
 */
function updateScanStatus(dbName, status) {
    const metadata = readMetadata();
    const index = metadata.findIndex(entry => entry.dbName === dbName);
    if (index !== -1) {
        metadata[index].status = status;
        if (status === 'completed' || status === 'error') {
            metadata[index].completedAt = new Date().toISOString(); // Отметка времени завершения
        }
        writeMetadata(metadata);
        console.log(`[METADATA] Обновлен статус для ${dbName}: ${status}`);
    } else {
        console.warn(`[METADATA] Не удалось найти запись для обновления статуса: ${dbName}`);
    }
}

/**
 * Получает все записи о сканированиях.
 * @returns {Array<Object>} Массив всех записей метаданных.
 */
function getScanEntries() {
    return readMetadata();
}

/**
 * Получает одну запись о сканировании по имени базы данных.
 * @param {string} dbName - Имя базы данных записи.
 * @returns {Object|undefined} Объект метаданных или undefined, если не найден.
 */
function getScanEntry(dbName) {
    const metadata = readMetadata();
    return metadata.find(entry => entry.dbName === dbName);
}

module.exports = {
    addScanEntry,
    updateScanStatus,
    getScanEntries,
    getScanEntry,
};
