// src/spider/db.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let siteDbInstance = null; // Для баз данных конкретных сайтов (pages, headers, links)
let metadataDbInstance = null; // Для общей базы данных sites_metadata.db

const METADATA_DB_FILE_NAME = 'sites_metadata.db';

// --- Функции для общей базы данных метаданных ---
function getMetadataDbConnection() {
    const dbDir = path.resolve(process.cwd(), 'databases');
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const metadataPath = path.resolve(dbDir, METADATA_DB_FILE_NAME);

    // Проверяем, существует ли экземпляр и открыт ли он
    if (metadataDbInstance && metadataDbInstance.open) {
        return metadataDbInstance; // Возвращаем существующее открытое соединение
    }

    // Если нет или закрыто, создаем новое
    try {
        metadataDbInstance = new Database(metadataPath, { verbose: console.log });
        // Убеждаемся, что таблица существует в этой конкретной базе данных
        metadataDbInstance.exec(`
            CREATE TABLE IF NOT EXISTS sites_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dbName TEXT UNIQUE NOT NULL,
                domain TEXT NOT NULL,
                scannedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending' -- pending, completed, error
            );
        `);
        return metadataDbInstance;
    } catch (error) {
        console.error("[DB] Ошибка при инициализации базы данных метаданных:", error);
        metadataDbInstance = null; // Устанавливаем в null в случае ошибки
        throw error; // Перебрасываем ошибку для индикации сбоя
    }
}

// Автоматически инициализируем базу данных метаданных при импорте этого модуля
try {
    getMetadataDbConnection();
} catch (e) {
    console.error("Не удалось инициализировать базу данных метаданных при загрузке модуля:", e);
}


// --- Функции для отдельных баз данных сайтов ---
function getSiteDbPath(siteName) {
    const safeSiteName = siteName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.resolve(process.cwd(), 'databases', `${safeSiteName}.db`);
}

function initSiteDb(siteName, overwrite = false) { // Переименовано из initDb
    const dbDir = path.resolve(process.cwd(), 'databases');
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = getSiteDbPath(siteName);

    if (overwrite && fs.existsSync(dbPath)) {
        console.log(`[DB] Удаление существующей базы данных сайта: ${dbPath}`);
        fs.unlinkSync(dbPath);
    }

    // Закрываем предыдущий экземпляр базы данных сайта, если он был открыт
    if (siteDbInstance && siteDbInstance.open) {
        siteDbInstance.close();
        siteDbInstance = null;
    }

    siteDbInstance = new Database(dbPath, { verbose: console.log });

    // ВНИМАНИЕ: Таблица sites_metadata удалена отсюда!
    siteDbInstance.exec(`
        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            metaTitle TEXT,
            metaDescription TEXT,
            scannedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            contentType TEXT DEFAULT 'HTML_PAGE',
            responseStatus INTEGER,   -- HTTP статус код
            responseTime INTEGER      -- Время ответа в мс
        );

        CREATE TABLE IF NOT EXISTS headers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pageId INTEGER,
            type TEXT NOT NULL,
            value TEXT NOT NULL,
            FOREIGN KEY (pageId) REFERENCES pages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS incoming_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pageId INTEGER,
            sourceUrl TEXT NOT NULL,
            FOREIGN KEY (pageId) REFERENCES pages(id) ON DELETE CASCADE
        );
    `);
    console.log(`[DB] База данных сайта для ${siteName} инициализирована.`);
    return siteDbInstance; // Возвращаем новый экземпляр
}

function savePageData(url, metaTitle, metaDescription, contentType, responseStatus, responseTime) {
    if (!siteDbInstance) {
        console.error("База данных сайта не инициализирована. Невозможно сохранить данные страницы.");
        return null;
    }
    const stmt = siteDbInstance.prepare('INSERT OR IGNORE INTO pages (url, metaTitle, metaDescription, contentType, responseStatus, responseTime) VALUES (?, ?, ?, ?, ?, ?)');
    const info = stmt.run(url, metaTitle, metaDescription, contentType, responseStatus, responseTime);
    if (info.changes === 0) {
        const existingPage = siteDbInstance.prepare('SELECT id FROM pages WHERE url = ?').get(url);
        return existingPage ? existingPage.id : null;
    }
    return info.lastInsertRowid;
}

function saveHeader(pageId, type, value) {
    if (!siteDbInstance) return;
    const stmt = siteDbInstance.prepare('INSERT INTO headers (pageId, type, value) VALUES (?, ?, ?)');
    stmt.run(pageId, type, value);
}

function saveIncomingLink(pageId, sourceUrl) {
    if (!siteDbInstance) return;
    const stmt = siteDbInstance.prepare('INSERT OR IGNORE INTO incoming_links (pageId, sourceUrl) VALUES (?, ?)');
    stmt.run(pageId, sourceUrl);
}

function getAllScannedSites() {
    try {
        const metadataDb = getMetadataDbConnection();
        const stmt = metadataDb.prepare('SELECT * FROM sites_metadata ORDER BY scannedAt DESC');
        return stmt.all();
    } catch (error) {
        console.error("[DB] Ошибка при получении всех просканированных сайтов из базы данных метаданных:", error);
        return [];
    }
}

function updateScanStatus(dbName, status) {
    try {
        const metadataDb = getMetadataDbConnection();
        const stmt = metadataDb.prepare(`
            INSERT INTO sites_metadata (dbName, domain, status)
            VALUES (?, ?, ?)
            ON CONFLICT(dbName) DO UPDATE SET
                status = EXCLUDED.status,
                scannedAt = CURRENT_TIMESTAMP;
        `);
        stmt.run(dbName, dbName, status); // Предполагается, что dbName также является доменным именем
        console.log(`[DB] Обновлен статус для ${dbName} на: ${status} в ${METADATA_DB_FILE_NAME}`);
    } catch (error) {
        console.error(`[DB_UPDATE_STATUS] Ошибка при обновлении статуса для ${dbName} в базе данных метаданных:`, error);
    }
}

/**
 * Получает все данные страницы (включая заголовки и входящие ссылки) для указанной базы данных сайта.
 * Открывает временное соединение для чтения.
 * @param {string} dbName - Имя базы данных сайта (обычно домен).
 * @returns {Array<Object>} Массив объектов страниц с их деталями.
 */
function getAllPagesData(dbName) { // Переименована из getPageData для ясности
    const dbPath = getSiteDbPath(dbName);
    if (!fs.existsSync(dbPath)) {
        console.warn(`[DB] База данных сайта не найдена для: ${dbName} по пути ${dbPath}`);
        return [];
    }

    // Открываем новое соединение только для чтения
    let localSiteDb;
    try {
        localSiteDb = new Database(dbPath, { readonly: true, verbose: console.log });
        const pagesStmt = localSiteDb.prepare('SELECT id, url, metaTitle, metaDescription, scannedAt, contentType, responseStatus, responseTime FROM pages ORDER BY url');
        const pages = pagesStmt.all();

        // Получаем заголовки и входящие ссылки для каждой страницы
        const headersStmt = localSiteDb.prepare('SELECT type, value FROM headers WHERE pageId = ?');
        const incomingLinksStmt = localSiteDb.prepare('SELECT sourceUrl FROM incoming_links WHERE pageId = ?');

        const pagesWithDetails = pages.map(page => {
            const headers = headersStmt.all(page.id);
            const incomingLinks = incomingLinksStmt.all(page.id).map(link => link.sourceUrl); // Извлекаем только URL

            return {
                ...page,
                headers,
                incomingLinks,
            };
        });
        console.log(`[DB] Получено ${pagesWithDetails.length} страниц из ${dbName}.db`);
        return pagesWithDetails;

    } catch (error) {
        console.error(`[DB] Ошибка при получении данных страницы из ${dbName}.db:`, error);
        return [];
    } finally {
        if (localSiteDb) {
            localSiteDb.close(); // Закрываем соединение только для чтения
        }
    }
}


// Экспортируем функции с понятными именами
module.exports = {
    getDbPath: getSiteDbPath, // Экспортируем getSiteDbPath как getDbPath для совместимости
    initDb: initSiteDb,       // Экспортируем initSiteDb как initDb для совместимости
    savePageData,
    saveHeader,
    saveIncomingLink,
    getAllScannedSites,
    updateScanStatus,
    getAllPages: getAllPagesData, // Экспортируем getAllPagesData как getAllPages
};
