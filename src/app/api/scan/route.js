// src/app/api/scan/route.js
import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { addScanEntry, updateScanStatus, getScanEntry } from '../../../lib/scanMetadata';
import { URL } from 'url';

// Этот объект будет хранить ссылки на дочерние процессы сканирования.
// Это упрощенный подход для одного экземпляра сервера.
// В production-среде (особенно serverless) потребуется более надежный механизм.
let currentScanningProcess = null;

// Временное хранилище для детального прогресса каждого сканирования
// (для App Router требуется передача через замыкание или глобальный/модульный скоуп)
const scanProgressStore = {};

export function setScanProgress(dbName, progressData) {
    scanProgressStore[dbName] = progressData;
}

export async function POST(req) {
    const { url, overwrite } = await req.json();

    if (!url) {
        return NextResponse.json({ message: 'URL обязателен' }, { status: 400 });
    }

    if (currentScanningProcess) {
        return NextResponse.json({ message: 'Сканирование уже выполняется. Пожалуйста, подождите.' }, { status: 409 });
    }

    let domainName;
    try {
        domainName = new URL(url).hostname;
    } catch (error) {
        return NextResponse.json({ message: 'Некорректный формат URL.' }, { status: 400 });
    }

    const dbName = domainName;

    addScanEntry(domainName, dbName, 'pending');
    setScanProgress(dbName, { message: 'Инициализация сканирования...', currentUrl: null, totalUrls: null, scannedCount: null });

    const spiderPath = './src/spider/index.js'; // Путь к скрипту спайдера относительно корня проекта
    const args = [url, overwrite.toString()];

    currentScanningProcess = spawn('node', [spiderPath, ...args], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    currentScanningProcess.stdout.on('data', (data) => {
        console.log(`[SPIDER_STDOUT]: ${data}`);
    });

    currentScanningProcess.stderr.on('data', (data) => {
        console.error(`[SPIDER_STDERR]: ${data}`);
    });

    currentScanningProcess.on('message', (message) => {
        if (message.dbName !== dbName) {
            return;
        }

        if (message.type === 'progress') {
            setScanProgress(dbName, {
                message: message.message,
                currentUrl: message.currentUrl,
                totalUrls: message.totalUrls,
                scannedCount: message.scannedCount,
            });
        } else if (message.type === 'completed') {
            updateScanStatus(dbName, 'completed');
            setScanProgress(dbName, null);
            currentScanningProcess = null;
        } else if (message.type === 'error') {
            updateScanStatus(dbName, 'error');
            setScanProgress(dbName, null);
            currentScanningProcess = null;
        }
    });

    currentScanningProcess.on('close', (code) => {
        console.log(`[API] Процесс спайдера для ${dbName} завершился с кодом ${code}`);
        if (code !== 0 && currentScanningProcess) {
            updateScanStatus(dbName, 'error');
            setScanProgress(dbName, null);
        }
        currentScanningProcess = null;
    });

    currentScanningProcess.on('error', (err) => {
        console.error('[API] Ошибка при запуске процесса спайдера:', err);
        updateScanStatus(dbName, 'error');
        setScanProgress(dbName, null);
        currentScanningProcess = null;
    });

    return NextResponse.json({ message: 'Сканирование начато.', dbName: dbName }, { status: 202 });
}

// Переименованная функция POST для использования в других API (если нужно)
// Это обходной путь для App Router, так как напрямую импортировать 'currentScanningProcess' и 'scanProgressStore' из `route.js` проблематично.
// Лучше вынести `setScanProgress` в отдельный файл, как было предложено в предыдущем варианте.
// Для простоты, здесь я дублирую `scanProgressStore` и `setScanProgress` в `status/route.js`.
// В идеале, `scanProgressStore` должен быть общим сервисом (например, Redis, или файловая система).
export const _currentScanningProcess = () => currentScanningProcess;
