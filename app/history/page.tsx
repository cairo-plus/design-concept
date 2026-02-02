"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import Link from "next/link";

const client = generateClient<Schema>();

// Define type for history items
type HistoryItem = {
    id: string;
    type: string;
    query: string;
    response: string;
    usedSources?: string[] | null;
    createdAt: string;
};

export default function HistoryPage() {
    const { isAuthenticated, isLoading, user } = useAuth();
    const router = useRouter();
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push("/login");
        }
    }, [isLoading, isAuthenticated, router]);

    useEffect(() => {
        if (!isAuthenticated) return;

        const fetchHistory = async () => {
            try {
                const { data: items } = await client.models.InteractionHistory.list({
                    authMode: "userPool"
                });

                // Sort by date desc
                const sorted = items.sort((a, b) =>
                    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
                );

                // Map to local type to handle nulls safely
                const mappedItems: HistoryItem[] = sorted.map(item => ({
                    id: item.id,
                    type: item.type,
                    query: item.query,
                    response: item.response,
                    usedSources: item.usedSources ? item.usedSources.filter((s): s is string => s !== null) : [],
                    createdAt: item.createdAt || new Date().toISOString()
                }));

                setHistory(mappedItems);
            } catch (e) {
                console.error("Failed to fetch history", e);
            } finally {
                setLoadingHistory(false);
            }
        };

        fetchHistory();
    }, [isAuthenticated]);

    if (isLoading || !isAuthenticated) return null;

    return (
        <div className="min-h-screen bg-gray-100 text-slate-800">
            {/* Header */}
            <header className="relative mb-10 overflow-hidden bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-md">
                <div
                    className="absolute inset-0 opacity-25"
                    style={{
                        background:
                            "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.5), transparent 45%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.35), transparent 40%)",
                    }}
                    aria-hidden="true"
                />
                <div className="relative mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <Link href="/" className="hover:opacity-80 transition-opacity flex items-center gap-3">
                            <span className="rounded-full bg-white/20 px-4 py-2 text-base font-semibold tracking-wide shadow-inner">
                                bomy
                            </span>
                            <div className="leading-tight">
                                <p className="text-lg font-semibold">設計構想書自動生成システム</p>
                                <p className="text-xs text-sky-50/90">
                                    履歴一覧
                                </p>
                            </div>
                        </Link>
                    </div>
                    <div className="ml-auto flex items-center gap-4">
                        <Link href="/" className="text-sm font-semibold text-white/90 hover:text-white transition-colors flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                            ホームに戻る
                        </Link>
                    </div>
                </div>
                <div className="h-2 bg-white/25" aria-hidden="true" />
            </header>

            <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-12">
                <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 min-h-[500px]">
                    <h2 className="text-xl font-semibold mb-6 text-slate-700 flex items-center gap-2">
                        <svg className="w-6 h-6 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        対話・生成履歴
                    </h2>

                    {loadingHistory ? (
                        <div className="flex justify-center p-12">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-600"></div>
                        </div>
                    ) : history.length === 0 ? (
                        <div className="text-center p-12 text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                            <p>履歴はまだありません。</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* List View */}
                            <div className="lg:col-span-1 space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                {history.map((item) => (
                                    <div
                                        key={item.id}
                                        onClick={() => setSelectedItem(item)}
                                        className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md ${selectedItem?.id === item.id
                                            ? "bg-sky-50 border-sky-300 ring-1 ring-sky-300"
                                            : "bg-white border-slate-200 hover:border-sky-200"
                                            }`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${item.type === "CHAT" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"
                                                }`}>
                                                {item.type === "CHAT" ? "チャット" : "構想書生成"}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {new Date(item.createdAt).toLocaleDateString("ja-JP")} {new Date(item.createdAt).toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <p className="text-sm font-medium text-slate-800 line-clamp-2 mb-1">
                                            {item.query}
                                        </p>
                                        <p className="text-xs text-slate-500 line-clamp-1">
                                            {item.type === "CHAT" ? item.response : "JSONデータ生成済み"}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {/* Detail View */}
                            <div className="lg:col-span-2 bg-slate-50 rounded-xl border border-slate-200 p-6 max-h-[600px] overflow-y-auto">
                                {selectedItem ? (
                                    <div className="space-y-6">
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">質問 / リクエスト</h3>
                                            <div className="bg-white p-4 rounded-lg border border-slate-200 text-slate-800 shadow-sm">
                                                {selectedItem.query}
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">AIの回答 /生成結果</h3>
                                            <div className="bg-white p-4 rounded-lg border border-slate-200 text-slate-800 shadow-sm whitespace-pre-wrap text-sm leading-relaxed">
                                                {selectedItem.type === "DESIGN_DRAFT" ? (
                                                    <pre className="font-mono text-xs overflow-x-auto bg-slate-900 text-slate-50 p-3 rounded">
                                                        {(() => {
                                                            try {
                                                                return JSON.stringify(JSON.parse(selectedItem.response), null, 2);
                                                            } catch (e) {
                                                                return selectedItem.response;
                                                            }
                                                        })()}
                                                    </pre>
                                                ) : (
                                                    selectedItem.response
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">使用データ / 参照元</h3>
                                            {selectedItem.usedSources && selectedItem.usedSources.length > 0 ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {selectedItem.usedSources.map((source, idx) => (
                                                        <span key={idx} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                                            <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                            {source}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-slate-400 italic">参照されたデータはありません。</p>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                        <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                        <p>左側のリストから履歴を選択して詳細を表示します</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
