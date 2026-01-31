import { useState, useEffect } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>();

interface ChatbotProps {
    uploadedFiles: { [key: string]: { name: string; path: string; uploadedAt: string }[] };
    selectedComponent: string;
    generatedData: any;
}

export default function Chatbot({ uploadedFiles, selectedComponent, generatedData }: ChatbotProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<{ role: "user" | "bot"; content: string; citations?: string[] }[]>([
        { role: "bot", content: "こんにちは。設計構想書に関する質問があればどうぞ。\n\nアップロードされた資料や生成結果について質問できます。" },
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Update greeting when data changes
    useEffect(() => {
        const uploadedCount = Object.keys(uploadedFiles).length;
        if (uploadedCount > 0) {
            setMessages([{
                role: "bot",
                content: `こんにちは。${uploadedCount}件の資料がアップロードされています。\n\n設計構想書に関する質問があればどうぞ。`
            }]);
        }
    }, [Object.keys(uploadedFiles).length]);

    const handleSend = async () => {
        if (!input.trim()) return;
        const userMessage = input.trim();
        const newMessages = [...messages, { role: "user" as const, content: userMessage }];
        setMessages(newMessages);
        setInput("");
        setIsLoading(true);

        try {
            // Collect all uploaded file names to serve as context scope
            const allUploadedDocs = Object.values(uploadedFiles).flat().map(f => f.name);

            // Call the RAG backend
            const response = await client.queries.ragChat({
                query: userMessage,
                uploadedDocs: allUploadedDocs.length > 0 ? allUploadedDocs : undefined
            });

            const answer = response.data?.answer || "申し訳ありません。回答を生成できませんでした。";
            const citations = response.data?.citations?.filter((c): c is string => c !== null) || [];

            setMessages((prev) => [
                ...prev,
                {
                    role: "bot",
                    content: answer,
                    citations: citations
                },
            ]);
        } catch (error) {
            console.error("Chat error:", error);
            setMessages((prev) => [
                ...prev,
                { role: "bot", content: "エラーが発生しました。もう一度お試しください。" },
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed bottom-4 right-4 z-50">
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="bg-sky-600 hover:bg-sky-500 text-white rounded-full p-4 shadow-lg transition-transform hover:scale-105"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                </button>
            )}

            {isOpen && (
                <div className="bg-white rounded-2xl shadow-xl w-80 sm:w-96 flex flex-col h-[600px] ring-1 ring-slate-200">
                    <div className="bg-gradient-to-r from-sky-500 to-cyan-500 p-4 rounded-t-2xl flex justify-between items-center">
                        <div>
                            <h3 className="text-white font-semibold">設計アシスタント</h3>
                            <p className="text-sky-100 text-xs">RAG (Bedrock + S3)</p>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-white hover:text-sky-200 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                        </button>
                    </div>
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
                                    {msg.content}
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
                    <div className="p-4 border-t border-slate-200 bg-white rounded-b-2xl">
                        <div className="flex space-x-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && !isLoading && handleSend()}
                                placeholder={isLoading ? "回答を待機中..." : "質問を入力..."}
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
            )}
        </div>
    );
}
