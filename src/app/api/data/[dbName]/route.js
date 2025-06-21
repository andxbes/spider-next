// src/app/api/data/[dbName]/route.js
import { NextResponse } from 'next/server';
import { getAllPages } from '@/spider/db';

export async function GET(req, { params }) {
    const { dbName } = await params;

    if (!dbName) {
        return NextResponse.json({ message: 'Database name is required' }, { status: 400 });
    }

    try {
        const pages = getAllPages(dbName);
        return NextResponse.json(pages);
    } catch (error) {
        console.error(`Ошибка при получении данных для ${dbName}:`, error);
        return NextResponse.json({ message: 'Не удалось получить данные', error: error.message }, { status: 500 });
    }
}
