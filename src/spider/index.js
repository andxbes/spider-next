// spider/index.js - Основной скрипт спайдера
const cheerio = require('cheerio');
const RobotsParser = require('robots-parser');
const { parseString } = require('xml2js');
const { URL } = require('url');
const { initDb, savePageData, saveHeader, saveIncomingLink } = require('./db');

// Аргументы, передаваемые из родительского процесса (Next.js API):
// process.argv[2] = URL для сканирования (строка)
// process.argv[3] = Флаг перезаписи базы данных ('true' или 'false')
const inputUrl = process.argv[2];
const overwriteDb = process.argv[3] === 'true'; // Конвертируем строку 'true'/'false' в boolean

// Валидация входных данных
if (!inputUrl) {
    console.error('[SPIDER] Не указан URL для сканирования. Завершение работы.');
    process.exit(1);
}

let startUrl;
let domain;
try {
    const parsedInputUrl = new URL(inputUrl);
    startUrl = parsedInputUrl.origin; // Например, https://example.com
    domain = parsedInputUrl.hostname; // Например, example.com
} catch (error) {
    console.error(`[SPIDER] Некорректный формат URL: ${inputUrl}. Завершение работы.`, error);
    process.exit(1);
}

const dbName = domain; // Имя базы данных будет совпадать с доменным именем

const visitedUrls = new Set(); // URL, которые уже были посещены
const urlsToVisit = new Set();  // URL, которые нужно посетить
const incomingLinksMap = new Map(); // Карта для отслеживания входящих ссылок: {targetUrl: Set<sourceUrl>}

let robots; // Объект для работы с robots.txt

/**
 * Отправляет сообщение о прогрессе родительскому процессу через IPC.
 * @param {string} message - Общее текстовое сообщение о статусе.
 * @param {string|null} [currentUrl=null] - Текущий обрабатываемый URL.
 * @param {number|null} [totalUrls=null] - Общее количество URL в очереди (или приблизительное).
 * @param {number|null} [scannedCount=null] - Количество уже просканированных URL.
 * @param {string} [statusType='progress'] - Тип статуса ('progress', 'completed', 'error').
 */
function sendProgress(message, currentUrl = null, totalUrls = null, scannedCount = null, statusType = 'progress') {
    // Проверяем, есть ли канал IPC. Если скрипт запущен напрямую (без spawn), process.send не существует.
    if (process.send) {
        process.send({
            type: statusType,
            message,
            currentUrl,
            totalUrls,
            scannedCount,
            dbName // Включаем dbName для идентификации статуса на стороне API
        });
    } else {
        console.log(`[SPIDER_LOG] ${message} - ${currentUrl || ''} (${scannedCount || 0}/${totalUrls || 0})`);
    }
}

/**
 * Загружает и парсит файл robots.txt для целевого домена.
 */
async function fetchRobotsTxt() {
    try {
        const robotsTxtUrl = `${startUrl}/robots.txt`;
        sendProgress(`Загрузка robots.txt с: ${robotsTxtUrl}`);
        const response = await fetch(robotsTxtUrl);
        if (!response.ok) {
            console.warn(`[SPIDER] Не удалось загрузить robots.txt (${response.statusText}). Продолжаем без него.`);
            robots = new RobotsParser(robotsTxtUrl, ''); // Создаем пустой парсер, если файл не найден
            return;
        }
        const text = await response.text();
        robots = new RobotsParser(robotsTxtUrl, text);
        sendProgress('robots.txt загружен и проанализирован.');
    } catch (error) {
        console.error(`[SPIDER] Ошибка при загрузке или парсинге robots.txt: ${error.message}`);
        robots = new RobotsParser(`${startUrl}/robots.txt`, ''); // Создаем пустой парсер в случае ошибки
    }
}

/**
 * Загружает и парсит файл sitemap.xml для целевого домена.
 * Добавляет найденные URL в очередь для сканирования, если они внутренние и разрешены robots.txt.
 */
async function fetchSitemapXml() {
    try {
        const sitemapUrl = `${startUrl}/sitemap.xml`;
        sendProgress(`Загрузка sitemap.xml с: ${sitemapUrl}`);
        const response = await fetch(sitemapUrl);
        if (!response.ok) {
            console.warn(`[SPIDER] Не удалось загрузить sitemap.xml (${response.statusText}). Продолжаем без него.`);
            return;
        }
        const text = await response.text();
        await new Promise((resolve, reject) => {
            parseString(text, (err, result) => {
                if (err) {
                    console.error(`[SPIDER] Ошибка при парсинге sitemap.xml: ${err.message}`);
                    return reject(err);
                }
                if (result && result.urlset && result.urlset.url) {
                    result.urlset.url.forEach(entry => {
                        const url = entry.loc[0];
                        // Проверяем, является ли URL внутренним и разрешен ли robots.txt
                        if (isInternalUrl(url) && (robots ? robots.isAllowed(url, 'User-agent') : true)) {
                            urlsToVisit.add(url);
                        }
                    });
                    sendProgress(`Добавлено ${result.urlset.url.length} URL из sitemap.xml в очередь.`);
                }
                resolve();
            });
        });
    } catch (error) {
        console.error(`[SPIDER] Ошибка при загрузке или парсинге sitemap.xml: ${error.message}`);
    }
}

/**
 * Проверяет, принадлежит ли URL текущему домену.
 * @param {string} url - URL для проверки.
 * @returns {boolean} True, если URL является внутренним, иначе False.
 */
function isInternalUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname === domain;
    } catch (e) {
        // console.warn(`[SPIDER] Некорректный URL при проверке isInternalUrl: ${url}`);
        return false;
    }
}

/**
 * Сканирует одну страницу: загружает, парсит HTML, извлекает данные и ссылки.
 * @param {string} url - URL страницы для сканирования.
 * @param {string|null} [sourcePageUrl=null] - URL страницы, с которой была найдена текущая ссылка (для входящих ссылок).
 */
async function crawlPage(url, sourcePageUrl = null) {
    // Проверяем, был ли URL уже посещен, является ли он внешним, или запрещен ли robots.txt
    if (visitedUrls.has(url) || !isInternalUrl(url) || (robots && !robots.isAllowed(url, 'User-agent'))) {
        return; // Пропускаем URL
    }

    visitedUrls.add(url); // Отмечаем URL как посещенный
    urlsToVisit.delete(url); // Удаляем из очереди ожидания, так как он обрабатывается

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`[SPIDER] Не удалось получить ${url}: ${response.statusText}`);
            return;
        }

        const contentType = response.headers.get('content-type');
        // Пропускаем не-HTML контент (изображения, CSS, JS и т.д.)
        if (!contentType || !contentType.includes('text/html')) {
            // console.log(`[SPIDER] Пропуск ${url} из-за не-HTML контента: ${contentType}`);
            return;
        }

        const html = await response.text();
        const $ = cheerio.load(html); // Загружаем HTML в Cheerio для парсинга

        // Извлечение meta title и meta description
        const metaTitle = $('title').text().trim() || $('meta[property="og:title"]').attr('content')?.trim() || '';
        const metaDescription = $('meta[name="description"]').attr('content')?.trim() || $('meta[property="og:description"]').attr('content')?.trim() || '';

        // Сохранение данных страницы в БД
        let pageId;
        try {
            pageId = savePageData(url, metaTitle, metaDescription);
        } catch (dbError) {
            // Если возникла ошибка, например, из-за дубликата (хотя `INSERT OR IGNORE` должен это обрабатывать)
            console.error(`[SPIDER] Ошибка при сохранении данных страницы ${url}: ${dbError.message}`);
            return;
        }

        // Сохранение входящей ссылки, если она есть
        if (pageId && sourcePageUrl) {
            saveIncomingLink(pageId, sourcePageUrl);
        }

        // Извлечение и сохранение заголовков (H1-H6)
        $('h1, h2, h3, h4, h5, h6').each((i, el) => {
            const type = el.tagName.toUpperCase();
            const value = $(el).text().trim();
            if (value && pageId) { // Сохраняем только непустые заголовки
                saveHeader(pageId, type, value);
            }
        });

        // Поиск всех ссылок на странице
        $('a[href]').each((i, el) => {
            let href = $(el).attr('href');
            try {
                // Преобразование относительных URL в абсолютные
                const absoluteUrl = new URL(href, url).href;

                // Если ссылка внутренняя, еще не посещена и разрешена robots.txt, добавляем в очередь
                if (isInternalUrl(absoluteUrl) && !visitedUrls.has(absoluteUrl) && (robots ? robots.isAllowed(absoluteUrl, 'User-agent') : true)) {
                    urlsToVisit.add(absoluteUrl);
                    // Добавляем текущую страницу как источник для абсолютной ссылки
                    if (!incomingLinksMap.has(absoluteUrl)) {
                        incomingLinksMap.set(absoluteUrl, new Set());
                    }
                    incomingLinksMap.get(absoluteUrl).add(url);
                }
            } catch (e) {
                // Игнорируем некорректные или непарсибельные URL
            }
        });

    } catch (error) {
        console.error(`[SPIDER] Критическая ошибка при сканировании ${url}: ${error.message}`);
    }
}

/**
 * Запускает процесс сканирования.
 */
async function startSpider() {
    sendProgress(`Инициализация базы данных для ${dbName}...`);
    initDb(dbName, overwriteDb); // Инициализация БД (возможно, с перезаписью)

    await fetchRobotsTxt(); // Загрузка robots.txt
    await fetchSitemapXml(); // Загрузка sitemap.xml

    // Если после загрузки sitemap и robots очередь все еще пуста,
    // добавляем начальный URL, если он разрешен.
    if (urlsToVisit.size === 0) {
        if (robots && robots.isAllowed(startUrl, 'User-agent')) {
            urlsToVisit.add(startUrl);
            sendProgress(`Нет URL из sitemap/robots.txt. Начинаем с: ${startUrl}.`);
        } else {
            sendProgress("Нет URL для сканирования. Проверьте robots.txt и sitemap.xml или начальный URL.", null, null, null, 'error');
            process.exit(1); // Выход с ошибкой
        }
    }

    // Преобразуем Set в массив, который будет использоваться как очередь
    const queue = Array.from(urlsToVisit);
    urlsToVisit.clear(); // Очищаем Set, так как элементы будут добавляться в `queue`

    let scannedCount = 0;
    const initialTotalUrls = queue.length; // Начальное количество элементов в очереди

    while (queue.length > 0) {
        const currentUrl = queue.shift(); // Берем первый URL из очереди
        const sources = incomingLinksMap.has(currentUrl) ? Array.from(incomingLinksMap.get(currentUrl)) : null;

        // Отправляем прогресс родительскому процессу
        sendProgress(
            `Сканирование страницы`,
            currentUrl,
            initialTotalUrls + urlsToVisit.size, // Общее количество может увеличиваться по мере нахождения новых ссылок
            ++scannedCount
        );

        await crawlPage(currentUrl, sources ? sources[0] : null); // Сканируем страницу

        // Добавляем новые URL, найденные во время обхода текущей страницы, в конец очереди
        // Используем Array.from(urlsToVisit), так как Set urlsToVisit может меняться внутри цикла crawlPage
        for (const url of Array.from(urlsToVisit)) {
            if (!visitedUrls.has(url) && !queue.includes(url)) {
                queue.push(url);
                urlsToVisit.delete(url); // Удаляем из временного Set после добавления в очередь `queue`
            }
        }
    }

    // Сохраняем все входящие ссылки, которые могли быть собраны, но чьи целевые страницы не были просканированы (например, из-за внешнего домена или robots.txt)
    for (const [targetUrl, sources] of incomingLinksMap.entries()) {
        let pageId;
        try {
            // Пытаемся сохранить данные страницы, если ее еще нет (только URL)
            pageId = savePageData(targetUrl, '', '');
        } catch (dbError) {
            console.error(`[SPIDER] Ошибка при сохранении целевого URL для входящих ссылок ${targetUrl}: ${dbError.message}`);
            continue;
        }

        if (pageId) {
            for (const sourceUrl of sources) {
                saveIncomingLink(pageId, sourceUrl);
            }
        }
    }

    sendProgress('Сканирование завершено.', null, null, null, 'completed');
    process.exit(0); // Нормальное завершение работы
}

// Запуск спайдера
startSpider();
