// src/app/results/[dbName]/page.js
"use client"; // Это Client Component

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Modal from '@/components/Modal'; // Импортируем компонент модального окна

export default function ResultsPage() {
    const params = useParams();
    const dbName = params.dbName;

    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });

    // Состояние для модального окна
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalContent, setModalContent] = useState({ title: '', data: [] });

    useEffect(() => {
        if (!dbName) return;

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/data/${dbName}`);
                if (!res.ok) {
                    throw new Error(`HTTP ошибка! Статус: ${res.status}`);
                }
                const data = await res.json();
                setPages(data);
            } catch (err) {
                console.error("Не удалось загрузить данные страниц:", err);
                setError("Не удалось загрузить данные страниц: " + err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [dbName]);

    const sortedPages = useMemo(() => {
        let sortableItems = [...pages];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                if (aValue === null || aValue === undefined) aValue = '';
                if (bValue === null || bValue === undefined) bValue = '';

                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortConfig.direction === 'ascending'
                        ? aValue.localeCompare(bValue)
                        : bValue.localeCompare(aValue);
                }
                if (aValue < bValue) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [pages, sortConfig]);

    const handleSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
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

    if (pages.length === 0) {
        return (
            <div className="container mx-auto p-4 text-center">
                <h1 className="text-3xl font-bold mb-6 text-gray-800">Результаты для &quot;{dbName}&quot;</h1>
                <p className="text-xl text-gray-600">Страницы не найдены для этого домена.</p>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4 max-w-full font-sans">
            <h1 className="text-4xl font-extrabold mb-8 text-center text-gray-100">
                Результаты сканирования для &quot;{dbName}&quot;
            </h1>

            <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 overflow-x-auto">
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
                                <td className="px-6 py-4 whitespace-normal text-sm font-medium text-blue-600 hover:underline break-words">
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
                                    {page.incomingLinks && page.incomingLinks.length > 0 ? (
                                        <button
                                            onClick={() => openModal('Входящие ссылки', page.incomingLinks)}
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
                    <p>Нет данных для отображения.</p>
                )}
            </Modal>
        </div>
    );
}
