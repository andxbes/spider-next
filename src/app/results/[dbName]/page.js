// src/app/results/[dbName]/page.js
'use client'; // Это Client Component

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation'; // Для App Router useParams и useRouter из next/navigation
import Head from 'next/head'; // Для управления <head>

export default function ResultsPage() {
    const router = useRouter();
    const params = useParams(); // Получаем параметры маршрута
    const { dbName } = params; // Имя базы данных из URL

    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortColumn, setSortColumn] = useState(null);
    const [sortDirection, setSortDirection] = useState('asc'); // 'asc' or 'desc'

    const fetchPageData = useCallback(async (name) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/data/${name}`);
            if (res.ok) {
                const data = await res.json();
                setPages(data);
            } else {
                const errorData = await res.json();
                setError(`Не удалось получить данные: ${errorData.message}`);
            }
        } catch (err) {
            setError(`Произошла непредвиденная ошибка: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (dbName) {
            fetchPageData(dbName);
        }
    }, [dbName, fetchPageData]);

    const handleSort = (column) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const sortedPages = [...pages].sort((a, b) => {
        if (!sortColumn) return 0;

        const aValue = a[sortColumn];
        const bValue = b[sortColumn];

        if (aValue === null || aValue === undefined) return sortDirection === 'asc' ? 1 : -1;
        if (bValue === null || bValue === undefined) return sortDirection === 'asc' ? -1 : 1;

        if (typeof aValue === 'string' && typeof bValue === 'string') {
            return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
        }
        if (typeof aValue === 'number' && typeof bValue === 'number') {
            return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        }
        // Для дат
        if (sortColumn === 'scannedAt') {
            const dateA = new Date(aValue);
            const dateB = new Date(bValue);
            return sortDirection === 'asc' ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
        }
        return 0;
    });

    const getSortIndicator = (column) => {
        if (sortColumn === column) {
            return sortDirection === 'asc' ? ' ▲' : ' ▼';
        }
        return '';
    };

    if (!dbName) {
        return <div className="container mx-auto p-4 text-center text-gray-600">Загрузка...</div>;
    }

    if (loading) {
        return <div className="container mx-auto p-4 text-center text-blue-600">Загрузка данных для {dbName}...</div>;
    }

    if (error) {
        return <div className="container mx-auto p-4 text-red-600">Ошибка: {error}</div>;
    }

    return (
        <div className="container mx-auto p-4 font-sans">
            {/* Использование Next.js <Head> для метаданных страницы */}
            <Head>
                <title>Результаты для {dbName}</title>
            </Head>
            <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">Результаты сканирования для <span className="text-blue-600">{dbName}</span></h1>
            <button
                onClick={() => router.push('/')}
                className="mb-6 py-2 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-150 flex items-center space-x-2"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Назад на Главную</span>
            </button>

            {sortedPages.length === 0 ? (
                <p className="text-gray-600 text-center py-8 bg-white rounded-lg shadow-md">
                    Страницы для этого домена не найдены. Возможно, сканирование еще не завершено или сайт пуст.
                </p>
            ) : (
                <div className="overflow-x-auto bg-white shadow-md rounded-lg border border-gray-100">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    onClick={() => handleSort('url')}
                                >
                                    URL {getSortIndicator('url')}
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    onClick={() => handleSort('metaTitle')}
                                >
                                    Meta Title {getSortIndicator('metaTitle')}
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    onClick={() => handleSort('metaDescription')}
                                >
                                    Meta Description {getSortIndicator('metaDescription')}
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                    Заголовки (H1-H6)
                                </th>
                                <th
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    onClick={() => handleSort('scannedAt')}
                                >
                                    Дата сканирования {getSortIndicator('scannedAt')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {sortedPages.map((page) => (
                                <tr key={page.url} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm break-all">
                                            {page.url}
                                        </a>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-900 break-words max-w-xs">{page.metaTitle}</td>
                                    <td className="px-6 py-4 text-sm text-gray-500 break-words max-w-xs">{page.metaDescription}</td>
                                    <td className="px-6 py-4 text-sm text-gray-500 break-words max-w-xs">
                                        {page.headers && page.headers.split(',').map((header, index) => (
                                            <div key={index}>{header.trim()}</div>
                                        ))}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {new Date(page.scannedAt).toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
