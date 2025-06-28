// src/app/api/sites/route.js
import { NextResponse } from 'next/server';
import { getAllScannedSites } from '@/spider/db'; // Используем алиас @/
import { runStaleScansCleanup } from '../scan/state';

export async function GET() {
    runStaleScansCleanup(); // Очищаем зависшие сканирования перед отправкой списка
    try {
        const sites = getAllScannedSites();
        return NextResponse.json(sites);
    } catch (error) {
        console.error('Error fetching scanned sites:', error);
        return NextResponse.json({ message: 'Failed to fetch scanned sites', error: error.message }, { status: 500 });
    }
}
