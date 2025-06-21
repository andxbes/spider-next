// src/app/api/status/route.js
import { NextResponse } from 'next/server';
import { getScanEntry } from '../../../lib/scanMetadata';


// В этом файле нужно повторно объявить scanProgressStore или получить его из другого места
// Для демонстрации, мы временно используем ту же логику что и в scan/route.js
const scanProgressStore = {}; // ! Это будет отдельный экземпляр в реальной serverless среде !

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const dbName = searchParams.get('dbName');

    if (!dbName) {
        return NextResponse.json({ message: 'dbName обязателен' }, { status: 400 });
    }

    const scanEntry = getScanEntry(dbName);

    if (!scanEntry) {
        return NextResponse.json({ message: 'Запись о сканировании не найдена.' }, { status: 404 });
    }

    // В продакшн-среде `setScanProgress` из `scan/route.js` не сможет обновить эту глобальную переменную.
    // Это место, где вам потребуется читать прогресс из персистентного хранилища.
    const progressData = scanProgressStore[dbName] || null;


    return NextResponse.json({
        scanMetadata: scanEntry,
        progress: progressData
    }, { status: 200 });
}
