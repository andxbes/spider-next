// src/app/api/data/[dbName]/route.js
import { NextResponse } from 'next/server';
import { getAllPages } from '@/spider/db';

export async function GET(req, { params }) {
    const { dbName } = await params;
    const { searchParams } = new URL(req.url);

    if (!dbName) {
        return NextResponse.json({ message: 'Database name is required' }, { status: 400 });
    }

    // Получаем параметры пагинации и сортировки из запроса
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const sortKey = searchParams.get('sortKey') || 'url';
    const sortDirection = searchParams.get('sortDirection') || 'ascending';
    // Получаем новые параметры для поиска и фильтрации
    const searchQuery = searchParams.get('searchQuery') || '';
    const contentType = searchParams.get('contentType') || '';

    try {
        // Передаем все параметры, включая новые, в функцию БД
        const { pages, total } = getAllPages(dbName, { page, limit, sortKey, sortDirection, searchQuery, contentType });
        // Возвращаем данные вместе с общим количеством
        return NextResponse.json({ pages, total });
    } catch (error) {
        console.error(`Ошибка при получении данных для ${dbName}:`, error);
        return NextResponse.json({ message: 'Не удалось получить данные', error: error.message }, { status: 500 });
    }
}
