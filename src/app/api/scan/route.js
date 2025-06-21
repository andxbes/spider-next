// src/app/api/scan/route.js
import { NextResponse } from 'next/server';
import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';

// Импорт getDbPath теперь использует алиас @/
import { getDbPath, updateScanStatus, getAllScannedSites } from '@/spider/db';


// Global map to keep track of active scanning processes.
// In a production environment, for persistent state across serverless function invocations,
// you would typically use a database (e.g., Redis) instead of in-memory storage.
const scanProcesses = new Map();

export async function POST(req) {
    const { url, overwrite } = await req.json();

    if (!url) {
        return NextResponse.json({ message: 'URL is required' }, { status: 400 });
    }

    let dbName;
    try {
        dbName = new URL(url).hostname;
    } catch (e) {
        return NextResponse.json({ message: 'Invalid URL provided', error: e.message }, { status: 400 });
    }

    // If a scan for this domain is already running, return its status
    if (scanProcesses.has(dbName)) {
        const existingProcess = scanProcesses.get(dbName);
        return NextResponse.json({ message: `Scan for ${dbName} is already running.`, status: existingProcess.status || 'pending', progress: existingProcess.progress }, { status: 200 });
    }

    try {
        // --- ИСПРАВЛЕНО ЗДЕСЬ: Более надежный способ определить путь к файлу воркера ---
        const spiderPath = path.join(process.cwd(), 'src', 'spider', 'index.js');

        // Check if the file actually exists before trying to create a worker
        if (!fs.existsSync(spiderPath)) {
            console.error(`[API] Worker script NOT FOUND at calculated path: ${spiderPath}`);
            return NextResponse.json({ message: 'Worker script not found on server.', error: `Script not found: ${spiderPath}` }, { status: 500 });
        }
        console.log(`[API] Launching Worker Thread from: ${spiderPath}`);

        const worker = new Worker(spiderPath, {
            stdout: true, // Redirect worker's console.log to main process stdout
            stderr: true, // Redirect worker's console.error to main process stderr
        });

        // Store process information
        const currentScanningProcess = {
            worker: worker,
            status: 'pending',
            progress: null, // Initialize progress as null
            startTime: Date.now(),
            dbName: dbName,
            errorMessage: null, // To store worker-specific errors
        };
        scanProcesses.set(dbName, currentScanningProcess);

        // Handle messages from the worker
        worker.on('message', (msg) => {
            if (msg.type === 'progress') {
                currentScanningProcess.status = 'scanning';
                currentScanningProcess.progress = {
                    message: msg.message,
                    currentUrl: msg.currentUrl,
                    totalUrls: msg.totalUrls,
                    scannedCount: msg.scannedCount,
                };
                // console.log(`[API-PROGRESS] ${msg.message}`); // Optional: log progress
            } else if (msg.type === 'completed') {
                currentScanningProcess.status = 'completed';
                updateScanStatus(msg.dbName, 'completed'); // Update metadata DB
                console.log(`[API] Scan for ${msg.dbName} completed successfully.`);
                // We might want to remove it from map after a delay or when UI no longer needs status
                // For now, keep it for the GET /api/scan to return 'completed'
                // setTimeout(() => scanProcesses.delete(msg.dbName), 5000);
            } else if (msg.type === 'error') {
                currentScanningProcess.status = 'error';
                currentScanningProcess.errorMessage = msg.message;
                updateScanStatus(msg.dbName, 'error'); // Update metadata DB
                console.error(`[API] Error from scanner worker for ${msg.dbName}:`, msg.message);
                // setTimeout(() => scanProcesses.delete(msg.dbName), 5000);
            }
        });

        // Handle worker exit (completion or crash)
        worker.on('exit', (code) => {
            console.log(`[API] Spider process for ${dbName} exited with code ${code}`);
            if (code !== 0) {
                currentScanningProcess.status = 'error';
                currentScanningProcess.errorMessage = currentScanningProcess.errorMessage || `Worker exited with non-zero code: ${code}`;
                updateScanStatus(dbName, 'error'); // Update metadata DB on exit error
            } else if (currentScanningProcess.status === 'pending' || currentScanningProcess.status === 'scanning') {
                // If worker exits with 0 but didn't send 'completed' message, it's an unexpected early exit
                currentScanningProcess.status = 'error';
                currentScanningProcess.errorMessage = currentScanningProcess.errorMessage || 'Worker exited unexpectedly before completion message.';
                updateScanStatus(dbName, 'error'); // Update metadata DB on unexpected exit
            }
            // You can delete it from the map here if you want it to be immediately restartable
            // Or keep it for a while to let frontend fetch the final status/error
            // scanProcesses.delete(dbName);
        });

        // Handle errors in the worker thread itself (e.g., uncaught exceptions)
        worker.on('error', (err) => {
            currentScanningProcess.status = 'error';
            currentScanningProcess.errorMessage = err.message;
            updateScanStatus(dbName, 'error'); // Update metadata DB on worker error
            console.error(`[API] Uncaught error in worker thread for ${dbName}:`, err);
        });

        // Send the initial 'start' message to the worker after setting up listeners
        worker.postMessage({ type: 'start', url: url, overwrite: overwrite });
        updateScanStatus(dbName, 'pending'); // Set initial status in metadata DB

        return NextResponse.json({ message: 'Scan initiated', dbName: dbName, status: 'pending' }, { status: 202 });

    } catch (error) {
        console.error('[API] Error launching Worker Thread:', error);
        return NextResponse.json({ message: 'Failed to launch scan', error: error.message }, { status: 500 });
    }
}

export async function GET(req) {
    const url = new URL(req.url);
    const dbName = url.searchParams.get('dbName');

    if (!dbName) {
        return NextResponse.json({ message: 'dbName is required' }, { status: 400 });
    }

    const processInfo = scanProcesses.get(dbName);

    if (processInfo) {
        // Return current live status if process is active
        return NextResponse.json({
            status: processInfo.status,
            progress: processInfo.progress, // Will be null initially, then updated by worker messages
            startTime: processInfo.startTime,
            errorMessage: processInfo.errorMessage,
        }, { status: 200 });
    } else {
        // If process is not in memory, check if a database for it exists
        // This suggests a previous scan completed or wasn't launched via this server instance.
        // We'll rely on sites_metadata table for definitive status
        const allSites = getAllScannedSites();
        const siteMetadata = allSites.find(site => site.dbName === dbName);

        if (siteMetadata) {
            return NextResponse.json({
                status: siteMetadata.status,
                progress: null, // No live progress if not active
                message: `Scan status from database: ${siteMetadata.status}`,
            }, { status: 200 });
        } else {
            // If no active process and no metadata, then it's idle
            return NextResponse.json({
                status: 'idle',
                progress: null,
                message: 'No active scan for this domain, and no metadata found.',
            }, { status: 200 });
        }
    }
}
