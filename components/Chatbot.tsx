import { useState, useEffect } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { streamRagChat } from "../hooks/useRagStream";

const client = generateClient<Schema>();

interface ChatbotProps {
    uploadedFiles: { [key: string]: { name: string; path: string; uploadedAt: string }[] };
    selectedComponent: string;
    generatedData: any;
}

export default function Chatbot({ uploadedFiles, selectedComponent, generatedData }: ChatbotProps) {
    // Fixed window behavior

    const [messages, setMessages] = useState<{ role: "user" | "bot"; content: string; citations?: string[] }[]>([
        { role: "bot", content: "こんにちは。私は車の設計に詳しい設計アシスタントです。\n\n設計構想書に関する質問や、自動車の設計・開発・法規に関することなど、お気軽にお聞きください。アップロードされた資料に基づく回答はもちろん、一般的な設計知識や最新の業界情報についてもお答えできます。" },
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // State for processing status
    const [processingStatus, setProcessingStatus] = useState<{ [key: string]: "up-to-date" | "processing" | "ready" }>({});

    // History State
    const [showHistory, setShowHistory] = useState(false);
    const [historyItems, setHistoryItems] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // Fetch History
    const fetchHistory = async () => {
        setLoadingHistory(true);
        try {
            const { data: items } = await client.models.InteractionHistory.list({
                authMode: "userPool"
            });
            const chatHistory = items
                .filter(item => item.type === "CHAT" && !item.isDeleted)
                .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
            setHistoryItems(chatHistory);
        } catch (e) {
            console.error("Failed to fetch history", e);
        } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => {
        if (showHistory) {
            fetchHistory();
        }
    }, [showHistory]);

    const handleLoadHistoryItem = (item: any) => {
        setMessages([
            { role: "user", content: item.query },
            { role: "bot", content: item.response }
        ]);
        setShowHistory(false);
    };

    const handleDeleteItem = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm("この履歴を削除しますか？")) return;
        try {
            await client.models.InteractionHistory.update({
                id,
                isDeleted: true
            });
            setHistoryItems(prev => prev.filter(item => item.id !== id));
        } catch (e) {
            console.error("Failed to delete item", e);
        }
    };

    const handleDeleteAll = async () => {
        if (!confirm("履歴をすべて削除しますか？\n(データベースからは完全に削除されませんが、ここからは見えなくなります)")) return;
        try {
            await Promise.all(historyItems.map(item =>
                client.models.InteractionHistory.update({
                    id: item.id,
                    isDeleted: true
                })
            ));
            setHistoryItems([]);
        } catch (e) {
            console.error("Failed to delete all items", e);
        }
    };

    // Poll for processing status
    useEffect(() => {
        const checkStatus = async () => {
            const allFiles = Object.values(uploadedFiles).flat();
            if (allFiles.length === 0) return;

            // List files in protected/ to see what's ready
            try {
                // Determine which files need checking (simplified: check all)
                const listResult = await client.queries.ragChat({
                    query: "status_check_only", // Hacky: we need a proper list API or use storage list
                    uploadedDocs: []
                }).catch(() => null);

                // Ideally we use Storage.list, but we might not have access here easily without configuring it.
                // Let's assume for now we just show a generic message if recently uploaded.

                // Better approach: Check local storage upload time vs current time.
                // If uploaded < 2 minutes ago, show processing.
                const now = new Date();
                const newStatus: any = {};

                allFiles.forEach(f => {
                    const uploadTime = new Date(f.uploadedAt);
                    const diffSeconds = (now.getTime() - uploadTime.getTime()) / 1000;
                    if (diffSeconds < 60) { // Assume 60s processing time
                        newStatus[f.name] = "processing";
                    } else {
                        newStatus[f.name] = "ready";
                    }
                });
                setProcessingStatus(newStatus);
            } catch (e) {
                console.warn("Status check failed", e);
            }
        };

        const interval = setInterval(checkStatus, 5000);
        checkStatus(); // Initial check
        return () => clearInterval(interval);
    }, [uploadedFiles]);

    // Update greeting when data changes
    useEffect(() => {
        // Count total actual files, not just category keys
        const uploadedCount = Object.values(uploadedFiles).reduce((acc, files) => acc + files.length, 0);

        if (uploadedCount > 0) {
            setMessages([{
                role: "bot",
                content: `こんにちは。私は車の設計に詳しい設計アシスタントです。\n\n${uploadedCount}件の資料がアップロードされています。設計構想書に関する質問や、自動車の設計・開発・法規に関することなど、お気軽にお聞きください。`
            }]);
        }
    }, [uploadedFiles]);


    const handleSend = async () => {
        if (!input.trim()) return;
        const userMessage = input.trim();
        const newMessages = [...messages, { role: "user" as const, content: userMessage }];
        setMessages(newMessages);
        setInput("");
        setIsLoading(true);

        // Add placeholder bot message
        setMessages((prev) => [...prev, { role: "bot", content: "" }]);

        try {
            // Collect all uploaded file paths to serve as context scope
            const allUploadedDocs = Object.values(uploadedFiles).flat().map(f => f.path);

            console.log("Starting Stream:", { query: userMessage });

            let fullText = "";

            await streamRagChat(userMessage, allUploadedDocs, (chunk: string) => {
                fullText += chunk;
                setMessages((prev) => {
                    const newArr = [...prev];
                    const lastIdx = newArr.length - 1;
                    if (newArr[lastIdx].role === "bot") {
                        newArr[lastIdx] = { ...newArr[lastIdx], content: fullText };
                    }
                    return newArr;
                });
            });

            // Save interaction history (after stream completes)
            if (fullText) {
                try {
                    await client.models.InteractionHistory.create({
                        type: "CHAT",
                        query: userMessage,
                        response: fullText,
                        usedSources: [], // Citations are now embedded in text
                        createdAt: new Date().toISOString()
                    });
                } catch (saveError) {
                    console.error("Failed to save chat history", saveError);
                }
            }

        } catch (error: any) {
            console.error("Chat error:", error);
            setMessages((prev) => {
                const newArr = [...prev];
                // If the last message was the empty bot message, update it with error
                const lastIdx = newArr.length - 1;
                if (newArr[lastIdx].role === "bot") {
                    newArr[lastIdx] = {
                        ...newArr[lastIdx],
                        content: prev[lastIdx].content + `\n\n(Error: ${error.message || "Connection failed"})`
                    };
                }
                return newArr;
            });
        } finally {
            setIsLoading(false);
        }
    };

    const formatMessage = (text: string) => {
        const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^\)]+\))/g);
        return parts.map((part, index) => {
            const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\)]+)\)$/);
            if (linkMatch) {
                return <a key={index} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline underline">{linkMatch[1]}</a>;
            }
            const urlParts = part.split(/(https?:\/\/[^\s]+)/g);
            if (urlParts.length === 1) return part;
            return urlParts.map((subPart, subIndex) => {
                if (subPart.match(/^https?:\/\//)) {
                    return <a key={`${index}-${subIndex}`} href={subPart} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline underline">{subPart}</a>;
                }
                return subPart;
            });
        });
    };

    return (
        <div className="w-full bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 flex flex-col h-[600px]">
            <div className="bg-gradient-to-r from-sky-500 to-cyan-500 p-4 rounded-t-2xl flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="flex flex-col items-start">
                        <h3 className="text-white font-semibold">設計アシスタント</h3>
                        <p className="text-xs text-sky-50">車の設計に詳しいエンジニア</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {Object.values(processingStatus).some(s => s === "processing") && (
                        <div className="bg-white/20 rounded px-2 py-1 text-[10px] text-white animate-pulse">
                            処理中...
                        </div>
                    )}
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className={`p-1.5 rounded-lg transition-colors ${showHistory ? "bg-white text-sky-600" : "text-sky-100 hover:bg-white/10"}`}
                        title="履歴を表示"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>
                </div>
            </div>

            {showHistory ? (
                <div className="flex-1 overflow-hidden flex flex-col bg-slate-50">
                    <div className="p-3 border-b border-slate-200 bg-white flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-500">履歴一覧 ({historyItems.length})</span>
                        {historyItems.length > 0 && (
                            <button
                                onClick={handleDeleteAll}
                                className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition"
                            >
                                すべて削除
                            </button>
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {loadingHistory ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin h-6 w-6 border-b-2 border-sky-500 rounded-full"></div>
                            </div>
                        ) : historyItems.length === 0 ? (
                            <div className="text-center py-10 text-slate-400 text-sm">
                                <p>履歴はありません</p>
                            </div>
                        ) : (
                            historyItems.map((item) => (
                                <div
                                    key={item.id}
                                    onClick={() => handleLoadHistoryItem(item)}
                                    className="bg-white p-3 rounded-xl border border-slate-200 hover:border-sky-300 hover:shadow-sm cursor-pointer transition group"
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-[10px] text-slate-400">
                                            {new Date(item.createdAt).toLocaleDateString("ja-JP")} {new Date(item.createdAt).toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <button
                                            onClick={(e) => handleDeleteItem(e, item.id)}
                                            className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition p-1"
                                            title="削除"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                    <p className="text-sm font-medium text-slate-700 line-clamp-2">{item.query}</p>
                                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">{item.response}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                    {messages.map((msg, idx) => (
                        <div
                            key={idx}
                            className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                        >
                            <div
                                className={`max-w-[85%] rounded-xl p-3 text-sm whitespace-pre-line ${msg.role === "user"
                                    ? "bg-sky-600 text-white rounded-br-none"
                                    : "bg-white text-slate-800 ring-1 ring-slate-200 rounded-bl-none"
                                    }`}
                            >
                                {formatMessage(msg.content)}

                            </div>
                            {msg.citations && msg.citations.length > 0 && (
                                <div className="mt-1 text-xs text-slate-500 ml-1">
                                    <p className="font-semibold mb-1">引用元:</p>
                                    <ul className="list-disc pl-4 space-y-0.5">
                                        {msg.citations.map((cite, i) => (
                                            <li key={i}>{cite}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white text-slate-500 rounded-xl p-3 ring-1 ring-slate-200 rounded-bl-none text-sm flex items-center gap-2">
                                <svg className="animate-spin h-4 w-4 text-sky-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                回答を生成中... (ファイルを検索しています)
                            </div>
                        </div>
                    )}
                </div>
            )}
            <div className={`p-4 border-t border-slate-200 bg-white rounded-b-2xl ${showHistory ? 'hidden' : ''}`}>
                <div className="flex space-x-2">
                    <input
                        type="text"
                        id="chat-input"
                        name="chat-input"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !isLoading && handleSend()}
                        placeholder={
                            isLoading ? "回答を待機中..." :
                                Object.values(processingStatus).some(s => s === "processing") ? "背景処理中ですが質問できます..." :
                                    "質問を入力..."
                        }
                        disabled={isLoading}
                        className="flex-1 border border-slate-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:bg-slate-100"
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading}
                        className={`bg-sky-600 hover:bg-sky-500 text-white p-2 rounded-full transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
