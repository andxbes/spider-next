// src/app/api/scan/route.js
import { NextResponse } from 'next/server';
import { Worker } from 'worker_threads';
import path from 'path';
import { URL } from 'url';
import { scanProcesses, runStaleScansCleanup } from './state';
import { updateScanStatus } from '../../../spider/db';

// Запускаем очистку один раз при старте сервера
runStaleScansCleanup();

/**
 * @description Запускает новый процесс сканирования
 * @method POST
 */
export async function POST(request) {
    try {
        const { url, overwrite, concurrency } = await request.json();

        if (!url) {
            return NextResponse.json({ message: 'URL is required' }, { status: 400 });
        }

        let domain;
        let dbName;
        try {
            const parsedUrl = new URL(url);
            domain = parsedUrl.hostname;
            dbName = domain; // Используем домен как имя БД
        } catch (error) {
            return NextResponse.json({ message: 'Invalid URL format' }, { status: 400 });
        }

        if (scanProcesses.has(dbName)) {
            return NextResponse.json({ message: `Scan for ${dbName} is already running.` }, { status: 409 }); // 409 Conflict
        }

        updateScanStatus(dbName, 'pending');

        const worker = new Worker(path.resolve(process.cwd(), 'src/spider/index.js'));

        scanProcesses.set(dbName, {
            worker,
            status: 'pending',
            isStopping: false, // Флаг для корректной обработки отмены
            progress: null,
        });

        worker.on('message', (message) => {
            const processInfo = scanProcesses.get(dbName);
            if (!processInfo) return;

            // Обновляем статус в БД на 'scanning' при первом сообщении о прогрессе
            if (message.type === 'progress') {
                if (processInfo.status === 'pending') {
                    updateScanStatus(dbName, 'scanning');
                }
                processInfo.status = 'scanning';
                processInfo.progress = message;
            } else if (message.type === 'completed') {
                console.log(`[API] Scan completed for ${dbName}`);
                updateScanStatus(dbName, 'completed');
                scanProcesses.delete(dbName); // <-- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ
                worker.terminate();
            } else if (message.type === 'error') {
                console.error(`[API] Scan error for ${dbName}: ${message.message}`);
                updateScanStatus(dbName, 'error');
                scanProcesses.delete(dbName); // <-- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ
                worker.terminate();
            }
        });

        worker.on('error', (error) => {
            const processInfo = scanProcesses.get(dbName);
            if (processInfo && !processInfo.isStopping) {
                console.error(`[API] Worker error for ${dbName}:`, error);
                updateScanStatus(dbName, 'error');
                scanProcesses.delete(dbName);
            }
        });

        worker.on('exit', (code) => {
            const processInfo = scanProcesses.get(dbName);
            // Если процесс еще отслеживается и не был помечен для остановки, это сбой.
            if (processInfo && !processInfo.isStopping) {
                if (code !== 0) {
                    console.error(`[API] Worker for ${dbName} crashed with exit code ${code}`);
                    updateScanStatus(dbName, 'error');
                    scanProcesses.delete(dbName);
                }
            } else if (processInfo && processInfo.isStopping) {
                // Если была отмена, просто удаляем из карты, статус уже установлен.
                scanProcesses.delete(dbName);
            }
        });

        worker.postMessage({ type: 'start', url, overwrite, concurrency });

        return NextResponse.json({ message: `Scan started for ${domain}`, dbName }, { status: 202 });

    } catch (error) {
        console.error('[API_SCAN_POST] Error:', error);
        return NextResponse.json({ message: 'An internal server error occurred.' }, { status: 500 });
    }
}

/**
 * @description Получает статус текущего сканирования
 * @method GET
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const dbName = searchParams.get('dbName');

    if (!dbName) {
        return NextResponse.json({ message: 'dbName query parameter is required' }, { status: 400 });
    }

    const processInfo = scanProcesses.get(dbName);

    if (processInfo) {
        return NextResponse.json({ status: processInfo.status, progress: processInfo.progress });
    } else {
        // Процесс не в памяти, значит он завершен или была ошибка.
        // Клиент получит финальный статус через /api/sites
        return NextResponse.json({ status: 'completed', progress: null });
    }
}

/**
 * @description Останавливает (отменяет) активный процесс сканирования
 * @method DELETE
 */
export async function DELETE(request) {
    const { searchParams } = new URL(request.url);
    const dbName = searchParams.get('dbName');

    if (!dbName) {
        return NextResponse.json({ message: 'dbName query parameter is required' }, { status: 400 });
    }

    const processInfo = scanProcesses.get(dbName);

    if (!processInfo) {
        return NextResponse.json({ message: `Scan for ${dbName} is not running.` }, { status: 404 });
    }

    try {
        console.log(`[API] Stopping scan for ${dbName}...`);
        processInfo.isStopping = true; // Помечаем, что остановка преднамеренная
        await processInfo.worker.terminate(); // Завершаем воркер
        console.log(`[API] Worker for ${dbName} terminated.`);

        updateScanStatus(dbName, 'cancelled'); // Устанавливаем статус "Отменено"
        scanProcesses.delete(dbName); // Удаляем из активных процессов

        return NextResponse.json({ message: `Scan for ${dbName} has been cancelled.` }, { status: 200 });
    } catch (error) {
        console.error(`[API] Error stopping worker for ${dbName}:`, error);
        updateScanStatus(dbName, 'error');
        scanProcesses.delete(dbName);
        return NextResponse.json({ message: 'An error occurred while stopping the scan.' }, { status: 500 });
    }
}
