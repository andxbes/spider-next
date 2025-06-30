// src/app/results/[dbName]/page.js
"use client"; // Это Client Component

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Modal from '@/components/Modal'; // Импортируем компонент модального окна
import Link from 'next/link';

const PAGE_SIZE = 100;

export default function ResultsPage() {
    const params = useParams();
    const dbName = params.dbName;

    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true); // Для начальной загрузки
    const [isFetchingMore, setIsFetchingMore] = useState(false); // Для подгрузки
    const [error, setError] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'url', direction: 'ascending' });
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [searchQuery, setSearchQuery] = useState(''); // Debounced search query
    const [searchInput, setSearchInput] = useState(''); // Immediate input value
    const [contentType, setContentType] = useState(''); // Content type filter
    const [totalCount, setTotalCount] = useState(0); // Общее количество найденных страниц

    // Ref для IntersectionObserver
    const observer = useRef();

    const fetchPages = useCallback(async (pageToFetch, shouldReset = false) => {
        if (!dbName) return;

        const stateSetter = shouldReset ? setLoading : setIsFetchingMore;
        stateSetter(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                page: pageToFetch,
                limit: PAGE_SIZE,
                sortKey: sortConfig.key,
                sortDirection: sortConfig.direction,
                searchQuery: searchQuery, // Используем debounced значение
                contentType: contentType,
            });
            const res = await fetch(`/api/data/${dbName}?${params.toString()}`);
            if (!res.ok) {
                throw new Error(`HTTP ошибка! Статус: ${res.status}`);
            }
            const { pages: newPages, total } = await res.json();

            setPages(prevPages => (shouldReset ? newPages : [...prevPages, ...newPages]));
            setTotalCount(total); // Обновляем общее количество
            setCurrentPage(pageToFetch);
            setHasMore((pageToFetch * PAGE_SIZE) < total);

        } catch (err) {
            console.error("Не удалось загрузить данные страниц:", err);
            setError("Не удалось загрузить данные страниц: " + err.message);
        } finally {
            stateSetter(false);
        }
    }, [dbName, sortConfig.key, sortConfig.direction, searchQuery, contentType]);

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearchQuery(searchInput);
        }, 500); // 500ms delay

        return () => {
            clearTimeout(timer);
        };
    }, [searchInput]);

    const lastPageElementRef = useCallback(node => {
        if (isFetchingMore) return; // Не пересоздаем наблюдатель во время загрузки
        if (observer.current) observer.current.disconnect(); // Отключаем старый
        observer.current = new IntersectionObserver(entries => {
            // Если элемент виден и есть еще страницы для загрузки
            if (entries[0].isIntersecting && hasMore) {
                fetchPages(currentPage + 1, false);
            }
        });
        if (node) observer.current.observe(node); // Начинаем наблюдение за новым элементом
    }, [isFetchingMore, hasMore, currentPage, fetchPages]);

    // Состояние для модального окна
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalContent, setModalContent] = useState({ title: '', data: [] });


    // Начальная загрузка и загрузка при изменении сортировки, поиска или фильтра
    useEffect(() => {
        if (dbName) {
            setPages([]);
            setCurrentPage(1);
            setHasMore(true);
            fetchPages(1, true);
        }
    }, [dbName, sortConfig, searchQuery, contentType, fetchPages]);

    const handleSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        // Это вызовет useEffect для перезагрузки данных
        setSortConfig({ key, direction });
    };

    const getSortIndicator = (key) => {
        if (sortConfig.key === key) {
            return sortConfig.direction === 'ascending' ? ' ▲' : ' ▼';
        }
        return '';
    };

    // Функция для открытия модального окна
    const openModal = (title, data) => {
        setModalContent({ title, data });
        setIsModalOpen(true);
    };

    // Функция для закрытия модального окна
    const closeModal = () => {
        setIsModalOpen(false);
        setModalContent({ title: '', data: [] }); // Очищаем содержимое при закрытии
    };

    if (loading) {
        return (
            <div className="container mx-auto p-4 text-center">
                <p className="text-xl text-gray-100">Загрузка данных...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="container mx-auto p-4 text-center text-red-600">
                <p className="text-xl">Ошибка: {error}</p>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4 max-w-full font-sans">
            <div className='flex justify-between items-center mb-8 '>
                <Link className='flex items-center' href={'/'}>
                    &#9668; Back
                </Link>
                <h1 className="text-4xl font-extrabold text-center text-gray-100">
                    Результаты сканирования для &quot;{dbName}&quot;
                </h1>
            </div>
            <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 overflow-x-auto">
                {/* Панель поиска и фильтрации */}
                <div className="flex flex-col sm:flex-row justify-between items-center mb-6 space-y-4 sm:space-y-0">
                    <div className="flex-grow w-full sm:w-auto sm:mr-4">
                        <input
                            type="text"
                            placeholder="Поиск по URL, Title, Description..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-blue-500 focus:border-blue-500 transition"
                        />
                    </div>
                    <div className="w-full sm:w-auto">
                        <select
                            value={contentType}
                            onChange={(e) => setContentType(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg text-gray-700 bg-white focus:ring-blue-500 focus:border-blue-500 transition"
                        >
                            <option value="">Все типы контента</option>
                            <option value="HTML_PAGE">HTML страницы</option>
                            <option value="NON_HTML_OR_ERROR">Не HTML / Ошибки</option>
                            <option value="DISALLOWED">Запрещено robots.txt</option>
                            <option value="INTERNAL_ERROR">Внутренние ошибки</option>
                        </select>
                    </div>
                </div>
                {/* Счетчик результатов */}
                <div className="mb-4 text-sm text-gray-600">
                    Найдено страниц: <span className="font-bold">{totalCount}</span>
                </div>

                {pages.length > 0 ? (
                    <>
                        <table className="min-w-max divide-y divide-gray-200">
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
                                    {/* Изменяем заголовки для модального окна */}
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        H1-H6
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Исходящие ссылки
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Входящие ссылки
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {pages.map((page) => (
                                    <tr key={page.id}>
                                        <td className="px-6 py-4 whitespace-normal text-sm font-medium text-blue-600 hover:underline break-words max-w-[300px]">
                                            <a href={page.url} target="_blank" rel="noopener noreferrer">
                                                {page.url}
                                            </a>
                                        </td>
                                        <td className="px-6 py-4 whitespace-normal text-sm text-gray-800 break-words max-w-xs">
                                            {page.metaTitle || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-normal text-sm text-gray-800 break-words max-w-xs">
                                            {page.metaDescription || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                                            {page.responseStatus !== null ? page.responseStatus : 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                                            {page.responseTime !== null ? page.responseTime : 'N/A'}
                                        </td>
                                        {/* Кнопка для Заголовков */}
                                        <td className="px-6 py-4 whitespace-normal text-sm text-gray-800">
                                            {page.headers && page.headers.length > 0 ? (
                                                <button
                                                    onClick={() => openModal('Заголовки (H1-H6)', page.headers.map(h => ({ type: h.type.toUpperCase(), value: h.value })))}
                                                    className="text-blue-600 hover:underline text-sm"
                                                >
                                                    Посмотреть ({page.headers.length})
                                                </button>
                                            ) : 'Нет'}
                                        </td>
                                        {/* Кнопка для Входящих ссылок */}
                                        <td className="px-6 py-4 whitespace-normal text-sm text-gray-800">
                                            {page.outgoingLinks && page.outgoingLinks.length > 0 ? (
                                                <button
                                                    onClick={() => openModal('Исходящие ссылки', page.outgoingLinks)}
                                                    className="text-blue-600 hover:underline text-sm"
                                                >
                                                    Посмотреть ({page.outgoingLinks.length})
                                                </button>
                                            ) : 'Нет'}
                                        </td>
                                        {/* Кнопка для Входящих ссылок */}
                                        <td className="px-6 py-4 whitespace-normal text-sm text-gray-800">
                                            {page.incomingLinks && page.incomingLinks.length > 0 ? (
                                                <button
                                                    onClick={() => openModal('Входящие ссылки (Источники)', page.incomingLinks)}
                                                    className="text-blue-600 hover:underline text-sm"
                                                >
                                                    Посмотреть ({page.incomingLinks.length})
                                                </button>
                                            ) : 'Нет'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {/* Этот невидимый div будет отслеживаться IntersectionObserver, чтобы запустить загрузку */}
                        {/* Он не будет рендериться, если больше нет страниц, что остановит вызовы */}
                        {hasMore && <div ref={lastPageElementRef} style={{ height: '1px' }} />}
                        {/* Индикатор загрузки, который виден во время подгрузки */}
                        {isFetchingMore && (
                            <div className="text-center p-4">
                                <p className="text-gray-600">Загрузка...</p>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-center py-10">
                        <p className="text-xl text-gray-600">Страницы, соответствующие вашему запросу, не найдены.</p>
                    </div>
                )}
            </div>

            {/* Компонент модального окна */}
            <Modal isOpen={isModalOpen} onClose={closeModal} title={modalContent.title}>
                {modalContent.data && modalContent.data.length > 0 ? (
                    <ul className="list-disc list-inside space-y-1">
                        {modalContent.data.map((item, index) => (
                            <li key={index} className="break-all">
                                {typeof item === 'object' && item !== null ? (
                                    <>
                                        <span className="font-semibold">{item.type}:</span> {item.value}
                                    </>
                                ) : (
                                    <a href={item} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                        {item}
                                    </a>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p>Нет да нных для отображения.</p>
                )}
            </Modal>
        </div >
    );
}
