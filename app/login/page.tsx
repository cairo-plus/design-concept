"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function RedirectHome() {
    const router = useRouter();

    useEffect(() => {
        router.push("/");
    }, [router]);

    return (
        <div className="flex flex-col items-center justify-center space-y-4">
            <p className="text-lg font-medium">Signing in...</p>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <div className="min-h-screen bg-gray-100 text-slate-800">
            {/* Header - bomy-front style gradient */}
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
                        <span className="rounded-full bg-white/20 px-4 py-2 text-base font-semibold tracking-wide shadow-inner">
                            bomy
                        </span>
                        <div className="leading-tight">
                            <p className="text-lg font-semibold">設計構想書自動生成システム</p>
                            <p className="text-xs text-sky-50/90">
                                ログインしてください
                            </p>
                        </div>
                    </div>
                </div>
                <div className="h-2 bg-white/25" aria-hidden="true" />
            </header>

            <main className="flex items-center justify-center p-4">
                <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
                    <div className="mb-6 text-center">
                        <h2 className="text-2xl font-bold text-sky-700">Login</h2>
                        <p className="mt-2 text-sm text-slate-600">アカウントにサインインして続行</p>
                    </div>
                    <Authenticator>
                        <RedirectHome />
                    </Authenticator>
                </div>
            </main>
        </div>
    );
}
