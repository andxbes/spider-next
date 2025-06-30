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
        metadataDbInstance = new Database(metadataPath, {
            // verbose: console.log 
        });
        // Убеждаемся, что таблица существует в этой конкретной базе данных
        metadataDbInstance.exec(`
            CREATE TABLE IF NOT EXISTS sites_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dbName TEXT UNIQUE NOT NULL,
                domain TEXT NOT NULL,
                startUrl TEXT, -- The full URL used to start the scan
                scannedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'pending' -- pending, scanning, completed, error, cancelled
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

    siteDbInstance = new Database(dbPath, {
        // verbose: console.log 
    });

    // Устанавливаем PRAGMA для повышения производительности.
    // WAL (Write-Ahead Logging) позволяет одновременно читать и писать в БД, что идеально для нашего случая.
    // Остальные настройки уменьшают количество обращений к диску, ускоряя запись.
    siteDbInstance.exec('PRAGMA journal_mode = WAL;');
    siteDbInstance.exec('PRAGMA synchronous = NORMAL;');
    siteDbInstance.exec('PRAGMA cache_size = -64000;'); // ~64MB cache
    siteDbInstance.exec('PRAGMA temp_store = MEMORY;');

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

        CREATE TABLE IF NOT EXISTS outgoing_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pageId INTEGER,
            destinationUrl TEXT NOT NULL, -- URL, на который ведет ссылка (цель)
            FOREIGN KEY (pageId) REFERENCES pages(id) ON DELETE CASCADE,
            UNIQUE(pageId, destinationUrl)
        );

        -- === ИНДЕКСЫ ДЛЯ УСКОРЕНИЯ ===

        -- Индексы для ускорения сортировки на странице результатов
        CREATE INDEX IF NOT EXISTS idx_pages_responseStatus ON pages (responseStatus);
        CREATE INDEX IF NOT EXISTS idx_pages_responseTime ON pages (responseTime);
        -- Индексы для текстовых полей также могут помочь, но они могут быть большими
        CREATE INDEX IF NOT EXISTS idx_pages_metaTitle ON pages (metaTitle);
        CREATE INDEX IF NOT EXISTS idx_pages_metaDescription ON pages (metaDescription);
        
        -- Индексы для ускорения "JOIN-подобных" операций при выборке деталей страницы (заголовков и ссылок)
        CREATE INDEX IF NOT EXISTS idx_headers_pageId ON headers (pageId);
        CREATE INDEX IF NOT EXISTS idx_outgoing_links_pageId ON outgoing_links (pageId);

        -- Индекс для ускорения поиска обнаруженных URL при возобновлении сканирования
        CREATE INDEX IF NOT EXISTS idx_outgoing_links_destinationUrl ON outgoing_links (destinationUrl);
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

function saveOutgoingLink(pageId, destinationUrl) {
    if (!siteDbInstance) return;
    const stmt = siteDbInstance.prepare('INSERT OR IGNORE INTO outgoing_links (pageId, destinationUrl) VALUES (?, ?)');
    stmt.run(pageId, destinationUrl);
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

function updateScanStatus(dbName, status, startUrl = null) {
    try {
        const metadataDb = getMetadataDbConnection();
        // Если предоставлен startUrl, это начало нового или возобновленного сканирования.
        // Мы создаем или обновляем запись со всеми деталями.
        if (startUrl) {
            const domain = new URL(startUrl).hostname;
            const stmt = metadataDb.prepare(`
                INSERT INTO sites_metadata (dbName, domain, startUrl, status)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(dbName) DO UPDATE SET
                    status = EXCLUDED.status,
                    startUrl = EXCLUDED.startUrl,
                    scannedAt = CURRENT_TIMESTAMP;
            `);
            stmt.run(dbName, domain, startUrl, status);
        } else {
            // Если startUrl не предоставлен, мы обновляем только статус и временную метку существующей записи.
            const stmt = metadataDb.prepare(`
                UPDATE sites_metadata SET status = ?, scannedAt = CURRENT_TIMESTAMP WHERE dbName = ?;
            `);
            stmt.run(status, dbName);
        }
        console.log(`[DB] Обновлен статус для ${dbName} на: ${status} в ${METADATA_DB_FILE_NAME}`);
    } catch (error) {
        console.error(`[DB_UPDATE_STATUS] Ошибка при обновлении статуса для ${dbName} в базе данных метаданных:`, error);
    }
}

/**
 * Получает все данные страницы (включая заголовки и входящие ссылки) для указанной базы данных сайта.
 * Открывает временное соединение для чтения.
 * @param {string} dbName - Имя базы данных сайта (обычно домен).
 * @param {object} options - Опции для пагинации и сортировки.
 * @param {number} options.limit - Количество записей на странице.
 * @param {number} options.page - Номер страницы.
 * @param {string} options.sortKey - Ключ для сортировки.
 * @param {string} options.sortDirection - Направление сортировки ('ascending' или 'descending').
 * @returns {{pages: Array<Object>, total: number}} Объект с массивом страниц и общим количеством.
 */
function getAllPagesData(dbName, { limit = 100, page = 1, sortKey = 'url', sortDirection = 'ascending' } = {}) {
    const dbPath = getSiteDbPath(dbName);
    if (!fs.existsSync(dbPath)) {
        console.warn(`[DB] База данных сайта не найдена для: ${dbName} по пути ${dbPath}`);
        return { pages: [], total: 0 };
    }

    // Валидация параметров сортировки для предотвращения SQL-инъекций
    const allowedSortKeys = ['url', 'metaTitle', 'metaDescription', 'responseStatus', 'responseTime'];
    const safeSortKey = allowedSortKeys.includes(sortKey) ? sortKey : 'url';
    const safeSortDirection = sortDirection === 'descending' ? 'DESC' : 'ASC';

    const offset = (page - 1) * limit;

    // Открываем новое соединение только для чтения
    let localSiteDb;
    try {
        localSiteDb = new Database(dbPath, { readonly: true });

        // Сначала получаем общее количество страниц
        const totalStmt = localSiteDb.prepare('SELECT COUNT(*) as count FROM pages');
        const totalResult = totalStmt.get();
        const total = totalResult.count;

        // Затем получаем пагинированный и отсортированный список
        const pagesQuery = `
            SELECT id, url, metaTitle, metaDescription, scannedAt, contentType, responseStatus, responseTime 
            FROM pages 
            ORDER BY ${safeSortKey} ${safeSortDirection}
            LIMIT ? OFFSET ?
        `;
        const pagesStmt = localSiteDb.prepare(pagesQuery);
        const pages = pagesStmt.all(limit, offset);

        if (pages.length === 0) {
            return { pages: [], total };
        }

        const pageIds = pages.map(p => p.id);
        const pageUrls = pages.map(p => p.url);
        const pageIdPlaceholders = pageIds.map(() => '?').join(',');
        const pageUrlPlaceholders = pageUrls.map(() => '?').join(',');

        // 1. Получаем все заголовки для текущего набора страниц
        const headersStmt = localSiteDb.prepare(`SELECT pageId, type, value FROM headers WHERE pageId IN (${pageIdPlaceholders})`);
        const allHeaders = headersStmt.all(...pageIds);
        const headersByPageId = allHeaders.reduce((acc, h) => {
            (acc[h.pageId] = acc[h.pageId] || []).push({ type: h.type, value: h.value });
            return acc;
        }, {});

        // 2. Получаем все ИСХОДЯЩИЕ ссылки для текущего набора страниц
        const outgoingLinksStmt = localSiteDb.prepare(`SELECT pageId, destinationUrl FROM outgoing_links WHERE pageId IN (${pageIdPlaceholders})`);
        const allOutgoingLinks = outgoingLinksStmt.all(...pageIds);
        const outgoingLinksByPageId = allOutgoingLinks.reduce((acc, l) => {
            (acc[l.pageId] = acc[l.pageId] || []).push(l.destinationUrl);
            return acc;
        }, {});

        // 3. Получаем все ВХОДЯЩИЕ ссылки для текущего набора страниц
        const incomingLinksStmt = localSiteDb.prepare(`
            SELECT p.url as sourceUrl, ol.destinationUrl
            FROM outgoing_links ol
            JOIN pages p ON p.id = ol.pageId
            WHERE ol.destinationUrl IN (${pageUrlPlaceholders})
        `);
        const allIncomingLinks = incomingLinksStmt.all(...pageUrls);
        const incomingLinksByUrl = allIncomingLinks.reduce((acc, l) => {
            (acc[l.destinationUrl] = acc[l.destinationUrl] || []).push(l.sourceUrl);
            return acc;
        }, {});

        const pagesWithDetails = pages.map(page => ({
            ...page,
            headers: headersByPageId[page.id] || [],
            outgoingLinks: [...new Set(outgoingLinksByPageId[page.id] || [])],
            incomingLinks: [...new Set(incomingLinksByUrl[page.url] || [])],
        }));

        return { pages: pagesWithDetails, total };

    } catch (error) {
        console.error(`[DB] Ошибка при получении данных страницы из ${dbName}.db:`, error);
        return { pages: [], total: 0 };
    } finally {
        if (localSiteDb) {
            localSiteDb.close(); // Закрываем соединение только для чтения
        }
    }
}

/**
 * Получает все URL-адреса из таблицы pages для указанной базы данных сайта.
 * Используется для возобновления сканирования, чтобы не обрабатывать уже известные URL.
 * @param {string} dbName - Имя базы данных сайта.
 * @returns {string[]} Массив URL-адресов.
 */
function getScannedUrls(dbName) {
    const dbPath = getSiteDbPath(dbName);
    if (!fs.existsSync(dbPath)) {
        return [];
    }
    let localSiteDb;
    try {
        localSiteDb = new Database(dbPath, { readonly: true });
        const stmt = localSiteDb.prepare('SELECT url FROM pages');
        return stmt.all().map(row => row.url);
    } catch (error) {
        console.error(`[DB] Ошибка при получении отсканированных URL-адресов из ${dbName}.db:`, error);
        return [];
    } finally {
        if (localSiteDb) {
            localSiteDb.close();
        }
    }
}

/**
 * Получает все уникальные URL-адреса, на которые есть ссылки (обнаруженные URL).
 * Используется для возобновления сканирования, чтобы найти еще не обработанные страницы.
 * @param {string} dbName - Имя базы данных сайта.
 * @returns {string[]} Массив уникальных URL-адресов.
 */
function getAllDestinationUrls(dbName) {
    const dbPath = getSiteDbPath(dbName);
    if (!fs.existsSync(dbPath)) {
        return [];
    }
    let localSiteDb;
    try {
        localSiteDb = new Database(dbPath, { readonly: true });
        // DISTINCT гарантирует, что мы получим только уникальные URL
        const stmt = localSiteDb.prepare('SELECT DISTINCT destinationUrl FROM outgoing_links');
        return stmt.all().map(row => row.destinationUrl);
    } catch (error) {
        console.error(`[DB] Ошибка при получении обнаруженных URL-адресов из ${dbName}.db:`, error);
        return [];
    } finally {
        if (localSiteDb) {
            localSiteDb.close();
        }
    }
}

// Экспортируем функции с понятными именами
module.exports = {
    getDbPath: getSiteDbPath, // Экспортируем getSiteDbPath как getDbPath для совместимости
    initDb: initSiteDb,       // Экспортируем initSiteDb как initDb для совместимости
    savePageData,
    saveHeader,
    saveOutgoingLink,
    getAllScannedSites,
    updateScanStatus,
    getAllPages: getAllPagesData, // Экспортируем getAllPagesData как getAllPages
    getScannedUrls,
    getAllDestinationUrls,
};
