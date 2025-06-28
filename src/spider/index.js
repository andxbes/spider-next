// src/spider/index.js
const cheerio = require('cheerio');
const robots = require('robots-parser');
const { URL } = require('url');
const { initDb, savePageData, saveHeader, saveIncomingLink, getScannedUrls, getDiscoveredUrls } = require('./db');
const { parentPort } = require('worker_threads');

// НОВАЯ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ для отправки логов в родительский процесс
function logToParent(level, ...args) {
    if (parentPort) {
        // Преобразуем все аргументы в строку для надежной передачи
        const message = args.map(arg => {
            if (arg instanceof Error) return arg.stack || arg.message;
            if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg, null, 2);
            return String(arg);
        }).join(' ');

        parentPort.postMessage({
            type: 'log',
            level: level, // 'info', 'warn', 'error'
            message: message
        });
    }
}

// Проверяем версию Node.js для определения, нужен ли node-fetch
let fetch;
if (parseFloat(process.versions.node) < 18) {
    // Для Node.js < 18 требуется явный импорт node-fetch
    // Убедитесь, что 'node-fetch' установлен: npm install node-fetch
    fetch = require('node-fetch');
    logToParent("info", "[SPIDER_INIT] Using node-fetch for Node.js < 18.");
} else {
    // В Node.js 18+ fetch глобально доступен
    fetch = global.fetch;
    logToParent("info", "[SPIDER_INIT] Using built-in fetch for Node.js >= 18.");
}


const userAgent = 'Mozilla/5.0 (compatible; MyAwesomeSpider/1.0; +http://your-spider-website.com)';
const crawledUrls = new Set();
const urlsToCrawl = [];
let baseUrl = '';
let robotsParser;
let dbName = '';
let maxConcurrency = 5; // Количество одновременно сканируемых страниц
let activeCrawlers = 0;
let totalUrlsFound = 0; // Для отслеживания общего количества найденных URL
let processedUrlsCount = 0; // Для отслеживания количества обработанных URL


/**
 * Загружает страницу и измеряет время ответа.
 * @param {string} url - URL для загрузки.
 * @returns {Promise<{html: string|null, responseStatus: number|null, responseTime: number|null, finalUrl: string}>}
 */
async function fetchPage(url) {
    let responseStatus = null;
    let responseTime = null; // Время ответа в миллисекундах
    let html = null;
    let finalUrl = url; // Конечный URL после возможных редиректов

    const start = Date.now();
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
            },
            redirect: 'follow', // Следовать редиректам
        });
        responseTime = Date.now() - start; // Измеряем время ответа

        responseStatus = response.status;
        finalUrl = response.url; // Получаем конечный URL после редиректов

        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            html = await response.text();
            logToParent('info', `[SPIDER_FETCH] Успешно загружен HTML для ${url} (Статус: ${responseStatus}, Время: ${responseTime} мс)`);
        } else {
            logToParent('warn', `[SPIDER_FETCH] Не HTML контент или ошибка для ${url}. Статус: ${responseStatus}, Content-Type: ${response.headers.get('content-type') || 'N/A'}`);
        }
    } catch (error) {
        responseTime = Date.now() - start; // Измеряем время даже при ошибке
        logToParent('error', `[SPIDER_FETCH] Ошибка при загрузке ${url}:`, error);
        // Устанавливаем статус для сетевых ошибок
        if (error.code === 'ENOTFOUND') {
            responseStatus = 0; // Ошибка DNS
        } else if (error.code === 'ECONNREFUSED') {
            responseStatus = -2; // Соединение отклонено
        } else if (error.code === 'ERR_INVALID_URL') {
            responseStatus = -3; // Некорректный URL
        }
        else {
            responseStatus = -1; // Общая ошибка сети
        }
    }

    return { html, responseStatus, responseTime, finalUrl };
}


/**
 * Основная функция сканирования.
 */
async function crawl() {
    logToParent("info", "[SPIDER_CRAWL] Начинаем основной цикл сканирования...");
    // Цикл продолжается, пока есть URL-ы для обработки или активные краулеры
    while (urlsToCrawl.length > 0 || activeCrawlers > 0) {
        // Запускаем новые краулеры, если есть свободные слоты и URL-ы для обработки
        if (activeCrawlers < maxConcurrency && urlsToCrawl.length > 0) {
            const currentUrl = urlsToCrawl.shift(); // Берем URL из очереди
            // Важно: добавляем currentUrl в crawledUrls сразу, чтобы избежать повторной обработки
            // если он снова появится в очереди до завершения обработки.
            crawledUrls.add(currentUrl);
            activeCrawlers++;
            processedUrlsCount++; // Увеличиваем счетчик обработанных URL

            // Отправляем прогресс в родительский процесс (API route)
            if (parentPort) {
                parentPort.postMessage({
                    type: 'progress',
                    dbName: dbName,
                    message: `Сканирование ${processedUrlsCount} из ${totalUrlsFound} страниц`,
                    currentUrl: currentUrl,
                    totalUrls: totalUrlsFound,
                    scannedCount: processedUrlsCount,
                });
            }
            logToParent('info', `[SPIDER_QUEUE] Обработка: ${currentUrl} (Осталось в очереди: ${urlsToCrawl.length}, Активных: ${activeCrawlers})`);

            // Запускаем асинхронную функцию для обработки текущего URL
            (async () => {
                try {
                    const parsedUrl = new URL(currentUrl);
                    const domain = parsedUrl.hostname;

                    // Проверяем robots.txt (если он загружен)
                    if (robotsParser && !robotsParser.isAllowed(currentUrl, userAgent)) {
                        logToParent('warn', `[SPIDER_ROBOTS] ${currentUrl} запрещен robots.txt`);
                        // Сохраняем запись для запрещенного URL со статусом 0 и временем 0
                        savePageData(currentUrl, 'Disallowed by robots.txt', null, 'DISALLOWED', 0, 0);
                        return; // Пропускаем дальнейшую обработку
                    }

                    const { html, responseStatus, responseTime, finalUrl } = await fetchPage(currentUrl);

                    // Если был редирект, и конечный URL новый, добавляем его в очередь
                    if (finalUrl !== currentUrl && !crawledUrls.has(finalUrl)) {
                        logToParent('info', `[SPIDER_REDIRECT] ${currentUrl} редирект на ${finalUrl}`);
                        crawledUrls.add(finalUrl); // Добавляем конечный URL в обработанные
                        urlsToCrawl.push(finalUrl); // Добавляем в очередь для обработки
                        totalUrlsFound++; // Учитываем новый URL
                    }

                    if (html) {
                        const $ = cheerio.load(html);
                        const metaTitle = $('title').text() || $('meta[property="og:title"]').attr('content') || null;
                        const metaDescription = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || null;

                        const contentType = 'HTML_PAGE'; // Пока всегда HTML_PAGE, можно расширить

                        // Сохраняем данные страницы, включая статус и время ответа
                        const pageId = savePageData(finalUrl, metaTitle, metaDescription, contentType, responseStatus, responseTime);

                        // Извлечение и сохранение заголовков (H1-H6)
                        const headers = [];
                        for (let i = 1; i <= 6; i++) {
                            $(`h${i}`).each((index, element) => {
                                const headerText = $(element).text().trim();
                                if (headerText) { // Сохраняем только непустые заголовки
                                    headers.push({ type: `h${i}`, value: headerText });
                                }
                            });
                        }
                        headers.forEach(header => saveHeader(pageId, header.type, header.value));

                        // Извлечение и сохранение ссылок
                        $('a').each((index, element) => {
                            const href = $(element).attr('href');
                            if (href) {
                                try {
                                    const absoluteUrl = new URL(href, finalUrl).href;
                                    const absoluteUrlParsed = new URL(absoluteUrl);

                                    // Проверяем, что ссылка ведет на тот же домен
                                    if (absoluteUrlParsed.hostname === domain) {
                                        // Сохраняем входящую ссылку
                                        saveIncomingLink(pageId, absoluteUrl);

                                        // Добавляем URL в очередь, если он еще не был обработан и не находится в очереди
                                        if (!crawledUrls.has(absoluteUrl) && !urlsToCrawl.includes(absoluteUrl)) {
                                            crawledUrls.add(absoluteUrl); // Добавляем в Set, чтобы избежать дубликатов
                                            urlsToCrawl.push(absoluteUrl); // Добавляем в очередь
                                            totalUrlsFound++; // Учитываем новый найденный URL
                                        }
                                    }
                                } catch (e) {
                                    // console.warn(`[SPIDER_LINK] Некорректная ссылка: ${href} на ${currentUrl}`);
                                }
                            }
                        });

                    } else {
                        // Если HTML не получен (например, ошибка загрузки, не HTML контент)
                        logToParent('info', `[SPIDER_PROCESS] Сохранение записи для ${currentUrl} без HTML.`);
                        // Сохраняем запись даже без HTML, чтобы иметь информацию о статусе и времени
                        savePageData(finalUrl, null, null, 'NON_HTML_OR_ERROR', responseStatus, responseTime);
                    }
                } catch (error) {
                    logToParent('error', `[SPIDER_ERROR] Непредвиденная ошибка при обработке ${currentUrl}:`, error);
                    // В случае внутренней ошибки, также сохраняем запись
                    savePageData(currentUrl, null, null, 'INTERNAL_ERROR', -1, -1); // Статус -1 для внутренних ошибок
                } finally {
                    activeCrawlers--; // Уменьшаем счетчик активных краулеров, независимо от исхода
                }
            })(); // Конец асинхронной IIFE
        } else {
            // Если нет активных краулеров и URL-ов для обработки, выходим из цикла
            if (urlsToCrawl.length === 0 && activeCrawlers === 0) {
                break;
            }
            // Если нет свободных слотов или URL-ов, ждем немного, чтобы не загружать CPU
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    logToParent("info", "[SPIDER_CRAWL] Основной цикл сканирования завершен.");
}

// Запуск спайдера через worker_threads
if (parentPort) {
    // Отправляем сообщение, что воркер жив, сразу после запуска
    logToParent('info', '[SPIDER_WORKER] Worker thread has started.');

    parentPort.on('message', async (message) => {
        logToParent('info', `[SPIDER_WORKER] Получено сообщение типа: ${message.type}`);
        if (message.type === 'start') {
            // Сбрасываем состояние воркера перед каждым новым сканированием
            crawledUrls.clear();
            urlsToCrawl.length = 0;
            activeCrawlers = 0;
            totalUrlsFound = 0;
            processedUrlsCount = 0;
            robotsParser = undefined;
            dbName = '';
            baseUrl = '';

            const { url, overwrite, concurrency } = message;
            baseUrl = url;

            if (concurrency && concurrency > 0) {
                maxConcurrency = concurrency;
                logToParent('info', `[SPIDER_WORKER] Установлено количество потоков: ${maxConcurrency}`);
            }

            try {
                dbName = new URL(baseUrl).hostname;
            } catch (error) {
                logToParent('error', `[SPIDER_WORKER] Некорректный базовый URL: ${baseUrl}`, error);
                if (parentPort) {
                    parentPort.postMessage({ type: 'error', message: `Некорректный базовый URL: ${baseUrl}` });
                }
                return; // Прерываем выполнение, если URL некорректен
            }

            initDb(dbName, overwrite);
            logToParent('info', `[SPIDER_WORKER] Сканирование начато для: ${baseUrl}, База данных: ${dbName}`);

            // --- НОВАЯ ЛОГИКА ВОЗОБНОВЛЕНИЯ СКАНИРОВАНИЯ ---
            if (!overwrite) {
                logToParent('info', `[SPIDER_RESUME] Режим возобновления. Загрузка состояния из БД ${dbName}.db`);

                // 1. Загружаем все УЖЕ ОБРАБОТАННЫЕ URL
                const previouslyScanned = getScannedUrls(dbName);
                previouslyScanned.forEach(url => crawledUrls.add(url));
                logToParent('info', `[SPIDER_RESUME] Загружено ${crawledUrls.size} ранее обработанных URL.`);

                // 2. Находим все ОБНАРУЖЕННЫЕ URL (на которые есть ссылки)
                const discoveredUrls = getDiscoveredUrls(dbName);
                logToParent('info', `[SPIDER_RESUME] Найдено ${discoveredUrls.length} уникальных ссылок в базе.`);

                // 3. Добавляем в очередь только те, которые еще не были обработаны
                discoveredUrls.forEach(url => {
                    if (!urlsToCrawl.includes(url)) {
                        urlsToCrawl.push(url);
                    }
                });

                totalUrlsFound = crawledUrls.size + urlsToCrawl.length;
                processedUrlsCount = crawledUrls.size; // Уже обработанные страницы
                logToParent('info', `[SPIDER_RESUME] Поставлено в очередь ${urlsToCrawl.length} новых страниц для сканирования.`);
            }

            // Получаем и парсим robots.txt
            try {
                const robotsTxtUrl = new URL('/robots.txt', baseUrl).href;
                const robotsTxtRes = await fetch(robotsTxtUrl, {
                    headers: { 'User-Agent': userAgent }
                });
                if (robotsTxtRes.ok) {
                    const robotsTxtContent = await robotsTxtRes.text();
                    robotsParser = robots(robotsTxtUrl, robotsTxtContent);
                    logToParent('info', `[SPIDER_ROBOTS] robots.txt загружен для ${baseUrl}`);
                } else {
                    logToParent('warn', `[SPIDER_ROBOTS] robots.txt не найден или ошибка для ${baseUrl}. Статус: ${robotsTxtRes.status}`);
                    robotsParser = robots(robotsTxtUrl, ''); // Создаем пустой парсер, если robots.txt не найден
                }
            } catch (error) {
                logToParent('error', `[SPIDER_ROBOTS] Ошибка при загрузке robots.txt для ${baseUrl}:`, error);
                robotsParser = robots(new URL('/robots.txt', baseUrl).href, ''); // Продолжаем без robots.txt
            }

            // Инициализация очереди, если она пуста после попытки возобновления
            if (urlsToCrawl.length === 0) {
                logToParent('info', `[SPIDER_INIT] Очередь пуста, начинаем с базового URL: ${baseUrl}`);
                if (!crawledUrls.has(baseUrl)) {
                    crawledUrls.add(baseUrl);
                    urlsToCrawl.push(baseUrl);
                    totalUrlsFound = crawledUrls.size;
                }
            } else {
                logToParent('info', `[SPIDER_INIT] Начинаем с ${urlsToCrawl.length} URL в очереди из предыдущей сессии.`);
            }

            await crawl(); // Запускаем основной цикл сканирования

            // Отправляем сообщение о завершении сканирования
            if (parentPort) {
                parentPort.postMessage({ type: 'completed', dbName: dbName });
                logToParent('info', `[SPIDER_WORKER] Сканирование для ${dbName} завершено.`);
            }
        }
    });
}
// Нет 'else' блока здесь, чтобы избежать сообщения "Прямой запуск не рекомендуется."
// Если этот скрипт запускается не как воркер, он просто ничего не делает.
