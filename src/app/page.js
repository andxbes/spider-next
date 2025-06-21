// src/app/page.js
"use client"; // Это Client Component

import { useState, useEffect, useCallback } from "react";
import Link from "next/link"; // Используйте Link из next/link
import { useRouter } from "next/navigation"; // Для App Router useRouter из next/navigation

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [scanInProgress, setScanInProgress] = useState(false);
  const [scanStatus, setScanStatus] = useState(null); // { message, currentUrl, totalUrls, scannedCount }
  const [scannedSites, setScannedSites] = useState([]); // Список ранее просканированных сайтов
  const [currentDbName, setCurrentDbName] = useState(null); // Имя БД текущего активного сканирования
  const router = useRouter();

  // Функция для получения списка просканированных сайтов
  const fetchScannedSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        setScannedSites(data);

        // Проверяем, есть ли активное сканирование в списке
        const runningScan = data.find((site) => site.status === "pending");
        if (runningScan) {
          setScanInProgress(true);
          setCurrentDbName(runningScan.dbName);
        } else {
          setScanInProgress(false);
          setCurrentDbName(null);
          setScanStatus(null); // Сбрасываем статус, если нет активного сканирования
        }
      } else {
        console.error("Не удалось загрузить список просканированных сайтов.");
      }
    } catch (error) {
      console.error(
        "Ошибка при загрузке списка просканированных сайтов:",
        error
      );
    }
  }, []);

  useEffect(() => {
    fetchScannedSites(); // Загружаем список при первой загрузке страницы
  }, [fetchScannedSites]);

  // Эффект для получения статуса сканирования (опрос API)
  useEffect(() => {
    let interval;
    if (scanInProgress && currentDbName) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/status?dbName=${currentDbName}`);
          if (res.ok) {
            const data = await res.json();
            setScanStatus(data.progress); // Обновляем прогресс на UI
            if (data.scanMetadata.status !== "pending") {
              // Сканирование завершилось (успешно или с ошибкой)
              setScanInProgress(false);
              setScanStatus(null);
              setCurrentDbName(null);
              fetchScannedSites(); // Обновить список сайтов, чтобы показать новый статус
            }
          } else {
            console.error("Не удалось получить статус сканирования.");
            setScanInProgress(false); // Предполагаем ошибку
            setScanStatus(null);
            setCurrentDbName(null);
            fetchScannedSites();
          }
        } catch (error) {
          console.error("Ошибка при получении статуса сканирования:", error);
          setScanInProgress(false);
          setScanStatus(null);
          setCurrentDbName(null);
          fetchScannedSites();
        }
      }, 2000); // Опрашиваем API каждые 2 секунды
    } else {
      if (interval) clearInterval(interval); // Очищаем интервал, если сканирование не идет
    }
    return () => {
      if (interval) clearInterval(interval); // Очищаем интервал при размонтировании компонента
    };
  }, [scanInProgress, currentDbName, fetchScannedSites]);

  // Обработчик отправки формы сканирования
  const handleScan = async (e) => {
    e.preventDefault(); // Предотвращаем стандартное поведение формы

    if (scanInProgress) {
      alert(
        "Сканирование уже выполняется. Пожалуйста, дождитесь его завершения."
      );
      return;
    }

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, overwrite }),
      });

      if (res.status === 202) {
        // 202 Accepted означает, что запрос принят и обработка начата
        const data = await res.json();
        setCurrentDbName(data.dbName); // Устанавливаем имя БД для отслеживания прогресса
        setScanInProgress(true); // Активируем индикатор прогресса
        setScanStatus({
          message: "Начало сканирования...",
          currentUrl: null,
          totalUrls: null,
          scannedCount: null,
        });
        setUrl(""); // Очищаем поле ввода
        setOverwrite(false); // Сбрасываем чекбокс
        fetchScannedSites(); // Обновляем список, чтобы показать новый сайт в статусе 'pending'
      } else if (res.status === 409) {
        alert(
          "Другое сканирование уже выполняется. Пожалуйста, дождитесь его завершения."
        );
      } else {
        const errorData = await res.json();
        alert(`Не удалось начать сканирование: ${errorData.message}`);
        setScanInProgress(false);
        setScanStatus(null);
      }
    } catch (error) {
      console.error("Ошибка при запуске сканирования:", error);
      alert("Произошла непредвиденная ошибка при попытке начать сканирование.");
      setScanInProgress(false);
      setScanStatus(null);
    }
  };

  // Обработчик для просмотра результатов
  const handleViewResults = (dbName) => {
    router.push(`/results/${dbName}`); // Переходим на страницу результатов
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl font-sans">
      <h1 className="text-4xl font-extrabold mb-8 text-center text-gray-800">
        Интерфейс Веб-Спайдера
      </h1>

      {/* Форма для нового сканирования */}
      <div className="bg-white p-8 rounded-xl shadow-lg mb-10 border border-gray-100">
        <h2 className="text-2xl font-semibold mb-6 text-gray-700">
          Сканировать Новый Веб-сайт
        </h2>
        <form onSubmit={handleScan} className="space-y-6">
          <div>
            <label
              htmlFor="url"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              URL Веб-сайта (например, https://example.com)
            </label>
            <input
              type="url"
              id="url"
              className="mt-1 block w-full border border-gray-300 rounded-lg shadow-sm p-3 focus:ring-blue-500 focus:border-blue-500 text-base transition duration-150 ease-in-out"
              placeholder="https://ваш-сайт.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              disabled={scanInProgress}
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="overwrite"
              className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              disabled={scanInProgress}
            />
            <label
              htmlFor="overwrite"
              className="ml-2 block text-base text-gray-900 select-none"
            >
              Перезаписать существующую базу данных для этого домена
            </label>
          </div>
          <button
            type="submit"
            className={`w-full py-3 px-6 border border-transparent rounded-lg shadow-md text-base font-medium text-white transition duration-200 ease-in-out
                            ${scanInProgress
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              }`}
            disabled={scanInProgress}
          >
            {scanInProgress ? "Сканирование..." : "Начать Сканирование"}
          </button>
        </form>

        {/* Индикатор прогресса сканирования */}
        {scanInProgress && currentDbName && (
          <div className="mt-8 p-6 bg-blue-50 rounded-lg border border-blue-200 animate-fadeIn">
            <h3 className="text-xl font-medium text-blue-800 mb-3">Прогресс сканирования для {currentDbName}</h3>
            {/* Add optional chaining here */}
            <p className="text-blue-700 mb-1">Статус: {scanStatus?.message || 'Ожидание...'}</p>
            {scanStatus?.currentUrl && (
              <p className="text-blue-700 text-sm break-all mb-1">Текущий URL: <a href={scanStatus.currentUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{scanStatus.currentUrl}</a></p>
            )}
            {/* Add optional chaining here */}
            {scanStatus?.scannedCount !== null && scanStatus?.totalUrls !== null && (
              <p className="text-blue-700">
                Просканировано: {scanStatus.scannedCount} / {scanStatus.totalUrls}
              </p>
            )}
            <div className="w-full bg-gray-200 rounded-full h-3 mt-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
                // Add optional chaining here for safety
                style={{ width: `${(scanStatus?.scannedCount / scanStatus?.totalUrls) * 100 || 0}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* Список ранее просканированных сайтов */}
      <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100">
        <h2 className="text-2xl font-semibold mb-6 text-gray-700">
          Ранее Просканированные Сайты
        </h2>
        {scannedSites.length === 0 ? (
          <p className="text-gray-600 text-center py-4">
            Пока нет просканированных сайтов.
          </p>
        ) : (
          <ul className="space-y-4">
            {scannedSites
              .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt)) // Сортировка по дате сканирования (от новых к старым)
              .map((site) => (
                <li
                  key={site.id}
                  className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 p-4 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors duration-150"
                >
                  <div className="mb-2 sm:mb-0">
                    <span className="font-medium text-lg text-gray-800">
                      {site.domain}
                    </span>
                    <span className="text-sm text-gray-500 ml-0 sm:ml-2 block sm:inline">
                      ({new Date(site.scannedAt).toLocaleString()})
                    </span>
                    {site.status === "pending" && (
                      <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-blue-700 bg-blue-100 rounded-full">
                        Сканирование...
                      </span>
                    )}
                    {site.status === "error" && (
                      <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-red-700 bg-red-100 rounded-full">
                        Ошибка!
                      </span>
                    )}
                    {site.status === "completed" && (
                      <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-green-700 bg-green-100 rounded-full">
                        Завершено
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleViewResults(site.dbName)}
                    className={`py-2 px-4 rounded-lg shadow-sm text-sm font-medium text-white transition duration-200 ease-in-out
                                            ${scanInProgress ||
                        site.status !== "completed"
                        ? "bg-gray-400 cursor-not-allowed"
                        : "bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                      }`}
                    disabled={scanInProgress || site.status !== "completed"} // Недоступно во время сканирования или если статус не 'completed'
                  >
                    Посмотреть Результаты
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
