"use client";

import { useState, useEffect } from "react";
import { DesignConceptData } from "@/lib/excelExport";

interface ChatbotProps {
    uploadedFiles: { [key: string]: { name: string; path: string; uploadedAt: string }[] };
    selectedComponent: string;
    generatedData: DesignConceptData | null;
}

export default function Chatbot({ uploadedFiles, selectedComponent, generatedData }: ChatbotProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<{ role: "user" | "bot"; content: string }[]>([
        { role: "bot", content: "こんにちは。設計構想書に関する質問があればどうぞ。\n\nアップロードされた資料や生成結果について質問できます。" },
    ]);
    const [input, setInput] = useState("");

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

    const handleSend = () => {
        if (!input.trim()) return;
        const userMessage = input.trim().toLowerCase();
        const newMessages = [...messages, { role: "user" as const, content: input }];
        setMessages(newMessages);
        setInput("");

        // Generate context-aware response
        setTimeout(() => {
            let response = "";

            // Check question type and generate appropriate response
            if (userMessage.includes("資料") || userMessage.includes("アップロード") || userMessage.includes("ファイル")) {
                const uploadedList = Object.entries(uploadedFiles);
                if (uploadedList.length === 0) {
                    response = "現在、アップロードされた資料はありません。左側のパネルから資料をアップロードしてください。";
                } else {
                    response = `現在アップロードされている資料（${uploadedList.length}種類）:\n\n${uploadedList.map(([docType, files], i) =>
                        `${i + 1}. **${docType}**:\n${files.map(f => `   - ${f.name}`).join('\n')}`
                    ).join('\n')}`;
                }
            } else if (userMessage.includes("コンポーネント") || userMessage.includes("部品") || userMessage.includes("対象")) {
                response = `現在の対象コンポーネントは「**${selectedComponent}**」です。\n\nテールゲート、フロントバンパー、フードから選択できます。`;
            } else if (userMessage.includes("要件") || userMessage.includes("requirement")) {
                if (generatedData) {
                    const reqs = generatedData.sections.requirements;
                    response = `**${generatedData.componentName}** の要件は ${reqs.length} 件あります:\n\n${reqs.map(r => `- ${r.id}: ${r.description}（優先度: ${r.priority}）\n  引用元: ${r.source}`).join('\n')}`;
                } else {
                    response = "まだ設計構想書が生成されていません。「構想書を生成」ボタンを押してください。";
                }
            } else if (userMessage.includes("法規") || userMessage.includes("規制") || userMessage.includes("regulation")) {
                if (generatedData) {
                    const regs = generatedData.sections.regulations;
                    response = `**${generatedData.componentName}** に関連する法規は ${regs.length} 件あります:\n\n${regs.map(r => `- ${r.code}: ${r.description}（${r.status}）\n  引用元: ${r.source}`).join('\n')}`;
                } else {
                    response = "まだ設計構想書が生成されていません。「構想書を生成」ボタンを押してください。";
                }
            } else if (userMessage.includes("引用") || userMessage.includes("出典") || userMessage.includes("source")) {
                if (generatedData) {
                    const sources = new Set([
                        ...generatedData.sections.requirements.map(r => r.source),
                        ...generatedData.sections.regulations.map(r => r.source)
                    ]);
                    response = `設計構想書の引用元:\n\n${Array.from(sources).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n各要件・法規の詳細画面またはExcel出力で確認できます。`;
                } else {
                    response = "まだ設計構想書が生成されていません。生成後に引用元情報が表示されます。";
                }
            } else if (userMessage.includes("生成") || userMessage.includes("作成") || userMessage.includes("結果")) {
                if (generatedData) {
                    response = `**${generatedData.componentName}** の設計構想書が生成済みです。\n\n- 生成日: ${generatedData.generatedAt}\n- 要件数: ${generatedData.sections.requirements.length}件\n- 法規数: ${generatedData.sections.regulations.length}件\n- 参考資料: ${generatedData.sections.references.length}件\n\n「Excelダウンロード」ボタンで出力できます。`;
                } else {
                    response = "まだ設計構想書が生成されていません。資料をアップロードして「構想書を生成」ボタンを押してください。";
                }
            } else if (userMessage.includes("ヘルプ") || userMessage.includes("help") || userMessage.includes("使い方")) {
                response = "以下の質問ができます:\n\n- 「アップロードされた資料は？」\n- 「対象コンポーネントは？」\n- 「要件を教えて」\n- 「法規要件は？」\n- 「引用元を教えて」\n- 「生成結果は？」";
            } else {
                response = `ご質問ありがとうございます。\n\n現在の状況:\n- 対象: ${selectedComponent}\n- アップロード資料: ${Object.keys(uploadedFiles).length}件\n- 設計構想書: ${generatedData ? "生成済み" : "未生成"}\n\n具体的な質問があればどうぞ。`;
            }

            setMessages((prev) => [
                ...prev,
                { role: "bot", content: response },
            ]);
        }, 500);
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
                <div className="bg-white rounded-2xl shadow-xl w-80 sm:w-96 flex flex-col h-[500px] ring-1 ring-slate-200">
                    <div className="bg-gradient-to-r from-sky-500 to-cyan-500 p-4 rounded-t-2xl flex justify-between items-center">
                        <div>
                            <h3 className="text-white font-semibold">設計アシスタント</h3>
                            <p className="text-sky-100 text-xs">資料に基づいて回答します</p>
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
                                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <div
                                    className={`max-w-[85%] rounded-xl p-3 text-sm whitespace-pre-line ${msg.role === "user"
                                        ? "bg-sky-600 text-white rounded-br-none"
                                        : "bg-white text-slate-800 ring-1 ring-slate-200 rounded-bl-none"
                                        }`}
                                >
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="p-4 border-t border-slate-200 bg-white rounded-b-2xl">
                        <div className="flex space-x-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                                placeholder="質問を入力..."
                                className="flex-1 border border-slate-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                            />
                            <button
                                onClick={handleSend}
                                className="bg-sky-600 hover:bg-sky-500 text-white p-2 rounded-full transition-colors"
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
