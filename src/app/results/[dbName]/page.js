// src/app/results/[dbName]/page.js
"use client"; // Это Client Component

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation'; // Для App Router

export default function ResultsPage() {
    const params = useParams();
    const dbName = params.dbName; // Получаем dbName из параметров маршрута

    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });

    // Эффект для загрузки данных при монтировании компонента или изменении dbName
    useEffect(() => {
        if (!dbName) return; // Не выполняем запрос, если dbName не определен

        const fetchData = async () => {
            setLoading(true); // Устанавливаем состояние загрузки
            setError(null);   // Сбрасываем предыдущие ошибки
            try {
                // Запрашиваем данные из вашего нового API-эндпоинта
                const res = await fetch(`/api/data/${dbName}`);
                if (!res.ok) {
                    // Обработка ошибок HTTP (например, 404, 500)
                    throw new Error(`HTTP ошибка! Статус: ${res.status}`);
                }
                const data = await res.json();
                setPages(data); // Обновляем состояние страниц
            } catch (err) {
                console.error("Не удалось загрузить данные страниц:", err);
                setError("Не удалось загрузить данные страниц: " + err.message); // Сохраняем сообщение об ошибке
            } finally {
                setLoading(false); // Завершаем состояние загрузки
            }
        };

        fetchData(); // Вызываем функцию загрузки данных
    }, [dbName]); // Зависимости эффекта: перезапускать при изменении dbName

    // Мемоизированный список страниц для сортировки
    const sortedPages = useMemo(() => {
        let sortableItems = [...pages]; // Создаем копию для сортировки
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                // Обработка null/undefined значений для сортировки (помещаем их в конец)
                if (aValue === null || aValue === undefined) aValue = '';
                if (bValue === null || bValue === undefined) bValue = '';

                // Сравнение строк
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortConfig.direction === 'ascending'
                        ? aValue.localeCompare(bValue)
                        : bValue.localeCompare(aValue);
                }
                // Сравнение чисел или других сравнимых типов
                if (aValue < bValue) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0; // Элементы равны
            });
        }
        return sortableItems;
    }, [pages, sortConfig]); // Зависимости useMemo

    // Обработчик для изменения конфигурации сортировки
    const handleSort = (key) => {
        let direction = 'ascending';
        // Если уже сортируем по этому ключу и направление восходящее, меняем на нисходящее
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction }); // Обновляем конфигурацию сортировки
    };

    // Вспомогательная функция для отображения индикатора сортировки
    const getSortIndicator = (key) => {
        if (sortConfig.key === key) {
            return sortConfig.direction === 'ascending' ? ' ▲' : ' ▼'; // Стрелка вверх/вниз
        }
        return ''; // Нет индикатора
    };

    // Отображение состояния загрузки
    if (loading) {
        return (
            <div className="container mx-auto p-4 text-center">
                <p className="text-xl text-gray-700">Загрузка данных...</p>
            </div>
        );
    }

    // Отображение состояния ошибки
    if (error) {
        return (
            <div className="container mx-auto p-4 text-center text-red-600">
                <p className="text-xl">Ошибка: {error}</p>
            </div>
        );
    }

    // Если данные загружены, но страниц нет
    if (pages.length === 0) {
        return (
            <div className="container mx-auto p-4 text-center">
                <h1 className="text-3xl font-bold mb-6 text-gray-800">Результаты для "{dbName}"</h1>
                <p className="text-xl text-gray-600">Страницы не найдены для этого домена.</p>
            </div>
        );
    }

    // Основное отображение таблицы результатов
    return (
        <div className="container mx-auto p-4 max-w-7xl font-sans">
            <h1 className="text-4xl font-extrabold mb-8 text-center text-gray-800">
                Результаты сканирования для "{dbName}"
            </h1>

            <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            {/* Заголовки таблицы с возможностью сортировки */}
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
                                Заголовок (Meta Title) {getSortIndicator('metaTitle')}
                            </th>
                            <th
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                onClick={() => handleSort('metaDescription')}
                            >
                                Описание (Meta Description) {getSortIndicator('metaDescription')}
                            </th>
                            <th
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                onClick={() => handleSort('responseStatus')}
                            >
                                Статус {getSortIndicator('responseStatus')}
                            </th>
                            <th
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                onClick={() => handleSort('responseTime')}
                            >
                                Время ответа (мс) {getSortIndicator('responseTime')}
                            </th>
                            {/* Заголовки без сортировки */}
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Заголовки (H1-H6)
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Входящие ссылки
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {sortedPages.map((page) => (
                            <tr key={page.id}>
                                <td className="px-6 py-4 whitespace-normal text-sm font-medium text-blue-600 hover:underline">
                                    <a href={page.url} target="_blank" rel="noopener noreferrer">
                                        {page.url}
                                    </a>
                                </td>
                                <td className="px-6 py-4 whitespace-normal text-sm text-gray-800">
                                    {page.metaTitle || 'N/A'} {/* Если заголовок пуст, отображаем 'N/A' */}
                                </td>
                                <td className="px-6 py-4 whitespace-normal text-sm text-gray-800">
                                    {page.metaDescription || 'N/A'} {/* Если описание пусто, отображаем 'N/A' */}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                                    {page.responseStatus !== null ? page.responseStatus : 'N/A'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                                    {page.responseTime !== null ? page.responseTime : 'N/A'}
                                </td>
                                <td className="px-6 py-4 whitespace-normal text-sm text-gray-800">
                                    {page.headers && page.headers.length > 0 ? (
                                        <ul className="list-disc list-inside">
                                            {page.headers.map((h, i) => (
                                                <li key={i}>
                                                    <span className="font-semibold">{h.type.toUpperCase()}:</span> {h.value}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : 'Нет'}
                                </td>
                                <td className="px-6 py-4 whitespace-normal text-sm text-gray-800">
                                    {page.incomingLinks && page.incomingLinks.length > 0 ? (
                                        <ul className="list-disc list-inside">
                                            {page.incomingLinks.map((link, i) => (
                                                <li key={i} className="break-all">
                                                    <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                                                        {link}
                                                    </a>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : 'Нет'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
