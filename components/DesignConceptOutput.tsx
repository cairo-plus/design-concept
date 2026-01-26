"use client";

import { DesignConceptData, exportToExcel } from "@/lib/excelExport";

interface Props {
    data: DesignConceptData;
    onDownload: () => void;
}

export default function DesignConceptOutput({ data, onDownload }: Props) {
    const handleDownload = () => {
        exportToExcel(data);
        onDownload();
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                        {data.componentName} - 設計構想書
                    </h3>
                    <p className="text-sm text-gray-500">生成日: {data.generatedAt}</p>
                </div>
                <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download Excel
                </button>
            </div>

            {/* Overview Section */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">概要</h4>
                <p className="text-sm text-blue-800 whitespace-pre-line">{data.sections.overview}</p>
            </div>

            {/* Requirements Section */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h4 className="font-medium text-gray-900">要件一覧</h4>
                </div>
                <div className="divide-y divide-gray-100">
                    {data.sections.requirements.map((req) => (
                        <div key={req.id} className="px-4 py-3 flex items-center gap-4">
                            <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-600">
                                {req.id}
                            </span>
                            <span className="flex-1 text-sm text-gray-800">{req.description}</span>
                            <span className={`text-xs px-2 py-1 rounded ${req.priority === "高"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-yellow-100 text-yellow-700"
                                }`}>
                                {req.priority}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Regulations Section */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h4 className="font-medium text-gray-900">法規要件</h4>
                </div>
                <div className="divide-y divide-gray-100">
                    {data.sections.regulations.map((reg) => (
                        <div key={reg.code} className="px-4 py-3 flex items-center gap-4">
                            <span className="text-xs font-mono bg-purple-100 px-2 py-1 rounded text-purple-700">
                                {reg.code}
                            </span>
                            <span className="flex-1 text-sm text-gray-800">{reg.description}</span>
                            <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700">
                                {reg.status}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* References Section */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h4 className="font-medium text-gray-900">参考資料 ({data.sections.references.length}件)</h4>
                </div>
                <div className="divide-y divide-gray-100">
                    {data.sections.references.map((ref, idx) => (
                        <div key={idx} className="px-4 py-3 flex items-center gap-4">
                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="flex-1 text-sm text-gray-800">{ref.name}</span>
                            <span className="text-xs text-gray-500">{ref.type}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
