// src/app/api/data/[dbName]/route.js
import { getAllPages } from '@/spider/db';
import { NextResponse } from 'next/server';


export async function GET(req, { params }) {
    const { dbName } = params; // Получаем динамический параметр из URL

    if (!dbName) {
        return NextResponse.json({ message: 'dbName обязателен' }, { status: 400 });
    }

    try {
        const pages = getAllPages(dbName);
        return NextResponse.json(pages, { status: 200 });
    } catch (error) {
        console.error(`[API] Ошибка при получении данных для ${dbName}:`, error);
        return NextResponse.json({ message: 'Не удалось получить данные.', error: error.message }, { status: 500 });
    }
}
