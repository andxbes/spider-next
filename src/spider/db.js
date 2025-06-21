// spider/db.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let dbInstance = null; // Переменная для хранения активного экземпляра базы данных

/**
 * Получает путь к файлу базы данных на основе имени сайта.
 * БД будут храниться в подпапке 'databases' в корне проекта.
 * @param {string} siteName - Имя сайта (домен).
 * @returns {string} Полный путь к файлу базы данных.
 */
function getDbPath(siteName) {
    const safeSiteName = siteName.replace(/[^a-zA-Z0-9_.-]/g, '_'); // Очищаем имя для безопасного использования в пути к файлу
    // process.cwd() возвращает текущую рабочую директорию, т.е. корень Next.js проекта
    return path.resolve(process.cwd(), 'databases', `${safeSiteName}.db`);
}

/**
 * Инициализирует базу данных для заданного сайта.
 * Если overwrite true и файл существует, он будет удален.
 * @param {string} siteName - Имя сайта (домен), для которого создается/открывается БД.
 * @param {boolean} [overwrite=false] - Если true, удаляет существующую БД перед созданием новой.
 */
function initDb(siteName, overwrite = false) {
    const dbDir = path.resolve(process.cwd(), 'databases');
    // Создаем папку 'databases', если она не существует
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = getDbPath(siteName);

    if (overwrite && fs.existsSync(dbPath)) {
        console.log(`[DB] Удаление существующей базы данных: ${dbPath}`);
        fs.unlinkSync(dbPath); // Удаляем файл базы данных
    }

    // Если база данных уже открыта (например, для другого сайта), закрываем её
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null; // Сбрасываем экземпляр
    }

    // Открываем или создаем новую базу данных
    dbInstance = new Database(dbPath, { verbose: console.log }); // verbose для отладки вывода в консоль

    // Создание таблиц, если они не существуют
    dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            metaTitle TEXT,
            metaDescription TEXT,
            scannedAt DATETIME DEFAULT CURRENT_TIMESTAMP -- Автоматическая отметка времени сканирования
        );

        CREATE TABLE IF NOT EXISTS headers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pageId INTEGER,
            type TEXT NOT NULL, -- например, H1, H2, H3
            value TEXT NOT NULL,
            FOREIGN KEY (pageId) REFERENCES pages(id) ON DELETE CASCADE -- Удаляем заголовки при удалении страницы
        );

        CREATE TABLE IF NOT EXISTS incoming_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pageId INTEGER,
            sourceUrl TEXT NOT NULL, -- URL страницы, откуда идет ссылка на данную страницу
            FOREIGN KEY (pageId) REFERENCES pages(id) ON DELETE CASCADE
        );
    `);
    console.log(`[DB] База данных для ${siteName} инициализирована по адресу ${dbPath}.`);
}

/**
 * Сохраняет данные страницы в базу данных.
 * Использует INSERT OR IGNORE, чтобы избежать дубликатов по URL.
 * @param {string} url - URL страницы.
 * @param {string} metaTitle - Мета-заголовок страницы.
 * @param {string} metaDescription - Мета-описание страницы.
 * @returns {number} ID вставленной или существующей страницы.
 */
function savePageData(url, metaTitle, metaDescription) {
    if (!dbInstance) {
        throw new Error("База данных не инициализирована. Вызовите initDb() сначала.");
    }
    const stmt = dbInstance.prepare('INSERT OR IGNORE INTO pages (url, metaTitle, metaDescription) VALUES (?, ?, ?)');
    const info = stmt.run(url, metaTitle, metaDescription);
    if (info.changes > 0) {
        // Если запись была вставлена, возвращаем её ID
        return info.lastInsertRowid;
    } else {
        // Если запись уже существовала, получаем её ID
        return dbInstance.prepare('SELECT id FROM pages WHERE url = ?').get(url).id;
    }
}

/**
 * Сохраняет заголовок (H1-H6) для страницы.
 * @param {number} pageId - ID страницы, к которой относится заголовок.
 * @param {string} type - Тип заголовка (например, 'H1').
 * @param {string} value - Текстовое значение заголовка.
 */
function saveHeader(pageId, type, value) {
    if (!dbInstance) {
        throw new Error("База данных не инициализирована. Вызовите initDb() сначала.");
    }
    const stmt = dbInstance.prepare('INSERT INTO headers (pageId, type, value) VALUES (?, ?, ?)');
    stmt.run(pageId, type, value);
}

/**
 * Сохраняет входящую ссылку на страницу.
 * @param {number} pageId - ID целевой страницы.
 * @param {string} sourceUrl - URL страницы-источника, откуда идет ссылка.
 */
function saveIncomingLink(pageId, sourceUrl) {
    if (!dbInstance) {
        throw new Error("База данных не инициализирована. Вызовите initDb() сначала.");
    }
    const stmt = dbInstance.prepare('INSERT OR IGNORE INTO incoming_links (pageId, sourceUrl) VALUES (?, ?)');
    stmt.run(pageId, sourceUrl);
}

/**
 * Получает все данные страниц для заданного сайта.
 * Открывает базу данных в режиме только для чтения, чтобы не мешать другим операциям.
 * @param {string} siteName - Имя сайта (домен).
 * @returns {Array<Object>} Массив объектов, представляющих страницы.
 */
function getAllPages(siteName) {
    const dbPath = getDbPath(siteName);
    if (!fs.existsSync(dbPath)) {
        console.warn(`[DB] База данных не найдена по пути: ${dbPath}`);
        return [];
    }
    let tempDb = null;
    try {
        tempDb = new Database(dbPath, { readonly: true });
        // Объединяем данные страниц и заголовков
        const pages = tempDb.prepare(`
            SELECT
                p.url,
                p.metaTitle,
                p.metaDescription,
                p.scannedAt,
                GROUP_CONCAT(h.type || ': ' || h.value) as headers
            FROM pages p
            LEFT JOIN headers h ON p.id = h.pageId
            GROUP BY p.id, p.url, p.metaTitle, p.metaDescription, p.scannedAt
            ORDER BY p.url
        `).all();
        console.log(`[DB] Загружено ${pages.length} страниц для ${siteName}.`);
        return pages;
    } catch (error) {
        console.error(`[DB] Ошибка при получении данных для ${siteName}: ${error.message}`);
        return [];
    } finally {
        if (tempDb) {
            tempDb.close(); // Всегда закрываем соединение после использования
        }
    }
}

module.exports = {
    initDb,
    savePageData,
    saveHeader,
    saveIncomingLink,
    getAllPages,
    // getDbPath // Не экспортируем, так как используется внутри
};
