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

    // Helper to render text with newlines
    const renderText = (text: string) => {
        return <p className="text-sm text-slate-800 whitespace-pre-line leading-relaxed">{text || "記載なし"}</p>;
    };

    return (
        <div className="space-y-6">
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

            {/* 1. 目的 */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">1. 目的</h4>
                </div>
                <div className="p-4 bg-sky-50/30">
                    {renderText(data.sections.objectives)}
                </div>
            </div>

            {/* 2. 現状の課題 */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">2. 現状の課題</h4>
                </div>
                <div className="p-4">
                    {renderText(data.sections.currentIssues)}
                </div>
            </div>

            {/* 3. ベンチマーク */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">3. ベンチマーク</h4>
                </div>
                <div className="p-4">
                    {renderText(data.sections.benchmark)}
                </div>
            </div>

            {/* 4. 設計コンセプト */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">4. 設計コンセプト</h4>
                </div>
                <div className="p-4 bg-amber-50/30">
                    {renderText(data.sections.designConcept)}
                </div>
            </div>

            {/* 5. 主要仕様 */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">5. 主要仕様</h4>
                </div>
                <div className="p-4">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">項目</th>
                                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">仕様値</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                                {data.sections.mainSpecifications && data.sections.mainSpecifications.length > 0 ? (
                                    data.sections.mainSpecifications.map((item, idx) => (
                                        <tr key={idx}>
                                            <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-slate-900">{item.item}</td>
                                            <td className="px-3 py-2 text-sm text-slate-600">{item.spec}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={2} className="px-3 py-2 text-sm text-slate-400">記載なし</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* 6. 基本構造 */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">6. 基本構造</h4>
                </div>
                <div className="p-4">
                    {renderText(data.sections.basicStructure)}
                </div>
            </div>

            {/* 7. 採用技術 */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">7. 採用技術</h4>
                </div>
                <div className="p-4">
                    {renderText(data.sections.adoptedTechnologies)}
                </div>
            </div>

            {/* 8. リスク及び対応策 */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">8. リスク及び対応策</h4>
                </div>
                <div className="p-4">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">リスク</th>
                                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">対応策</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                                {data.sections.risksAndCountermeasures && data.sections.risksAndCountermeasures.length > 0 ? (
                                    data.sections.risksAndCountermeasures.map((item, idx) => (
                                        <tr key={idx}>
                                            <td className="px-3 py-2 text-sm font-medium text-red-800 bg-red-50/50">{item.risk}</td>
                                            <td className="px-3 py-2 text-sm text-slate-700">{item.countermeasure}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={2} className="px-3 py-2 text-sm text-slate-400">記載なし</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* References Section */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <h4 className="font-semibold text-slate-900">参考資料 ({data.sections.references ? data.sections.references.length : 0}件)</h4>
                </div>
                <div className="divide-y divide-slate-100">
                    {data.sections.references && data.sections.references.map((ref, idx) => (
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
