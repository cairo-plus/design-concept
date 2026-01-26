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
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-gradient-to-r from-sky-50 to-cyan-50 p-4 ring-1 ring-sky-200">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                        {data.componentName} - 設計構想書
                    </h3>
                    <p className="text-xs text-slate-600">生成日: {data.generatedAt}</p>
                </div>
                <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Excelダウンロード
                </button>
            </div>

            {/* Overview Section */}
            <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-200">
                <h4 className="font-semibold text-sky-900 mb-2">概要</h4>
                <p className="text-sm text-sky-800 whitespace-pre-line">{data.sections.overview}</p>
            </div>

            {/* Requirements Section */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">要件一覧</h4>
                </div>
                <div className="divide-y divide-slate-100">
                    {data.sections.requirements.map((req) => (
                        <div key={req.id} className="px-4 py-3 flex items-center gap-4">
                            <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded-full text-slate-600">
                                {req.id}
                            </span>
                            <span className="flex-1 text-sm text-slate-800">{req.description}</span>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${req.priority === "高"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                                }`}>
                                {req.priority}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Regulations Section */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">法規要件</h4>
                </div>
                <div className="divide-y divide-slate-100">
                    {data.sections.regulations.map((reg) => (
                        <div key={reg.code} className="px-4 py-3 flex items-center gap-4">
                            <span className="text-xs font-mono bg-cyan-100 px-2 py-1 rounded-full text-cyan-700">
                                {reg.code}
                            </span>
                            <span className="flex-1 text-sm text-slate-800">{reg.description}</span>
                            <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-100 text-emerald-700">
                                {reg.status}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* References Section */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">参考資料 ({data.sections.references.length}件)</h4>
                </div>
                <div className="divide-y divide-slate-100">
                    {data.sections.references.map((ref, idx) => (
                        <div key={idx} className="px-4 py-3 flex items-center gap-4">
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="flex-1 text-sm text-slate-800">{ref.name}</span>
                            <span className="text-xs text-slate-500">{ref.type}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
