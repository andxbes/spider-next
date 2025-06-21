// src/components/Modal.js
"use client"; // Это Client Component

import React from 'react';

const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md md:max-w-lg lg:max-w-xl max-h-[90vh] overflow-y-auto transform transition-all sm:my-8 sm:align-middle sm:w-full">
                <div className="flex justify-between items-center border-b pb-3 mb-4">
                    <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 text-2xl leading-none font-semibold"
                    >
                        &times;
                    </button>
                </div>
                <div className="modal-content text-gray-700">
                    {children}
                </div>
                <div className="mt-6 text-right">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Modal;
