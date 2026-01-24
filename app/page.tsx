"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import Chatbot from "@/components/Chatbot";

const INPUT_DOCS = [
  "設計構想書",
  "商品企画書",
  "製品企画書",
  "ハードウエア設計者の対応するリスト",
  "専門家の研究資料",
  "法規リスト",
];

const COMPONENTS = ["テールゲート", "フロントバンパー", "フード"];

export default function Dashboard() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  // State for file uploads (mocked)
  const [uploadedFiles, setUploadedFiles] = useState<{ [key: string]: string }>({});
  const [selectedComponent, setSelectedComponent] = useState(COMPONENTS[0]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem("design-concept-files");
    if (saved) {
      setUploadedFiles(JSON.parse(saved));
    }
  }, []);

  const handleFileUpload = (docName: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const fileName = e.target.files[0].name;
      const newState = { ...uploadedFiles, [docName]: fileName };
      setUploadedFiles(newState);
      localStorage.setItem("design-concept-files", JSON.stringify(newState));
    }
  };

  if (isLoading || !isAuthenticated) {
    return null; // Or loading spinner
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Design Concept Generator</h1>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">User: Admin</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left Column: Input Data */}
        <section className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 text-gray-800 flex items-center">
              <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              Input Documents
            </h2>
            <div className="space-y-4">
              {INPUT_DOCS.map((doc) => (
                <div key={doc} className="group">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {doc}
                  </label>
                  <div className="flex items-center space-x-2">
                    <label className="flex-1 cursor-pointer">
                      <div className={`w-full px-3 py-2 border rounded-md text-sm transition-colors ${uploadedFiles[doc] ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-300 text-gray-500 hover:bg-gray-100'}`}>
                        {uploadedFiles[doc] ? (
                          <span className="flex items-center truncate">
                            <svg className="w-4 h-4 mr-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                            {uploadedFiles[doc]}
                          </span>
                        ) : (
                          "Click to upload..."
                        )}
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileUpload(doc, e)}
                        accept=".pptx,.xlsx,.pdf"
                      />
                    </label>
                    {uploadedFiles[doc] && (
                      <button
                        onClick={() => {
                          const ns = { ...uploadedFiles };
                          delete ns[doc];
                          setUploadedFiles(ns);
                          localStorage.setItem("design-concept-files", JSON.stringify(ns));
                        }}
                        className="text-gray-400 hover:text-red-500 p-1"
                        title="Remove/Replace"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right Column: Output & Controls */}
        <section className="lg:col-span-2 space-y-6">
          {/* Controls */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Target Component</h2>
              <span className="text-xs font-mono text-gray-400">v0.1.0</span>
            </div>
            <div className="flex space-x-4">
              {COMPONENTS.map((comp) => (
                <button
                  key={comp}
                  onClick={() => setSelectedComponent(comp)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedComponent === comp
                      ? "bg-blue-600 text-white shadow-md ring-2 ring-blue-300 ring-offset-1"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                >
                  {comp}
                </button>
              ))}
            </div>
          </div>

          {/* Output View */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 min-h-[500px] flex flex-col">
            <h2 className="text-lg font-semibold mb-4 text-gray-800 flex items-center justify-between">
              <span>Design Concept: {selectedComponent}</span>
              <button className="text-sm text-blue-600 hover:underline">Download PDF</button>
            </h2>

            <div className="flex-1 bg-gray-50 border border-dashed border-gray-300 rounded-lg flex items-center justify-center p-8">
              <div className="text-center text-gray-500">
                <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <p className="text-lg font-medium">No Concept Generated Yet</p>
                <p className="text-sm mt-2 max-w-sm mx-auto">Upload the required documents on the left to start the analysis and generation process.</p>
                <button className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
                  Generate Concept
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Chatbot />
    </div>
  );
}
