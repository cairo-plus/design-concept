"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import Chatbot from "@/components/Chatbot";
import DesignConceptOutput from "@/components/DesignConceptOutput";
import { DesignConceptData } from "@/lib/excelExport";
// Amplify Storage
import { uploadData, remove } from "aws-amplify/storage";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

const client = generateClient<Schema>();

const INPUT_DOCS = [
  "設計構想書",
  "商品計画書",
  "製品企画書",
  "ハードウエア設計者の対応するリスト",
  "専門家の研究資料",
  "法規リスト",
];

const COMPONENTS = ["テールゲート", "フロントバンパー", "フード"];

// File metadata interface
export interface UploadedFile {
  name: string;
  path: string;
  uploadedAt: string;
  id?: string;
}

export default function Dashboard() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();

  // State for file uploads - updated to store full metadata
  const [uploadedFiles, setUploadedFiles] = useState<{ [key: string]: UploadedFile[] }>({});
  const [selectedComponent, setSelectedComponent] = useState(COMPONENTS[0]);

  // State for upload progress/status
  const [isUploading, setIsUploading] = useState(false);

  // State for generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState<DesignConceptData | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  // Load from Data Store (UserDocument)
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchDocuments = async () => {
      try {
        const { data: items } = await client.models.UserDocument.list();

        // Reconstruct state from flat list
        const newState: { [key: string]: UploadedFile[] } = {};

        // Initialize keys
        INPUT_DOCS.forEach(doc => newState[doc] = []);

        items.forEach(item => {
          if (newState[item.docType] && !item.isDeleted) {
            newState[item.docType].push({
              name: item.fileName,
              path: item.s3Path,
              uploadedAt: item.uploadedAt || new Date().toISOString(),
              id: item.id // Store DB ID for deletion
            } as UploadedFile & { id: string });
          }
        });

        setUploadedFiles(newState);
      } catch (e) {
        console.error("Failed to fetch user documents", e);
      }
    };

    fetchDocuments();
  }, [isAuthenticated]);

  // Helper to format timestamp
  const getTimestampFolder = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  };

  // Handle adding files (multiple files at once)
  const handleFileUpload = async (docName: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsUploading(true);
      const newFiles: UploadedFile[] = [];
      const timestampFolder = getTimestampFolder();

      try {
        for (let i = 0; i < e.target.files.length; i++) {
          const file = e.target.files[i];
          // S3 Path: public/{docName}/{timestamp}/{fileName}
          // Note: docName might contain Japanese, but S3 supports UTF-8 keys.
          const path = `public/${docName}/${timestampFolder}/${file.name}`;

          await uploadData({
            path: path,
            data: file,
          }).result;

          // Save to Data Store
          const { data: newRecord } = await client.models.UserDocument.create({
            docType: docName,
            fileName: file.name,
            s3Path: path,
            uploadedAt: new Date().toISOString(),
            isDeleted: false,
          });

          newFiles.push({
            name: file.name,
            path: path,
            uploadedAt: newRecord?.uploadedAt || new Date().toISOString(),
            id: newRecord?.id // Capture ID
          } as UploadedFile & { id?: string });
        }

        const existingFiles = uploadedFiles[docName] || [];
        const updatedFiles = [...existingFiles, ...newFiles];
        const newState = { ...uploadedFiles, [docName]: updatedFiles };

        setUploadedFiles(newState);
        // localStorage.setItem("design-concept-files-v3", JSON.stringify(newState)); // Removed

        // Clear generated data when files change
        setGeneratedData(null);
      } catch (error) {
        console.error("Upload failed", error);
        alert("ファイルのアップロードに失敗しました");
      } finally {
        setIsUploading(false);
      }
    }
    // Reset input value to allow re-selecting the same file
    e.target.value = '';
  };

  // Handle removing a single file from a document type
  const handleRemoveFile = async (docName: string, fileToRemove: UploadedFile) => {
    if (!confirm(`「${fileToRemove.name}」をリストから削除しますか？\n(S3上のファイルは保持されます)`)) return;

    // Delete from Data Store if ID exists
    if (fileToRemove.id) {
      try {
        await client.models.UserDocument.delete({ id: fileToRemove.id });
      } catch (e) {
        console.error("Failed to delete record", e);
      }
    }

    // Remove from UI list only (keep in S3)
    const existingFiles = uploadedFiles[docName] || [];
    const updatedFiles = existingFiles.filter(f => f.path !== fileToRemove.path);

    let newState;
    if (updatedFiles.length === 0) {
      newState = { ...uploadedFiles };
      delete newState[docName];
    } else {
      newState = { ...uploadedFiles, [docName]: updatedFiles };
    }

    setUploadedFiles(newState);
    // localStorage.setItem("design-concept-files-v3", JSON.stringify(newState)); // Removed
    setGeneratedData(null);
  };

  // Handle clearing all files from a document type
  const handleClearAllFiles = async (docName: string) => {
    if (!confirm(`「${docName}」のすべてのファイルをリストから削除しますか？\n(S3上のファイルは保持されます)`)) return;

    const filesToRemove = uploadedFiles[docName] || [];

    // Delete from Data Store
    try {
      await Promise.all(
        filesToRemove
          .filter(f => f.id)
          .map(f => client.models.UserDocument.delete({ id: f.id! }))
      );
    } catch (e) {
      console.error("Failed to delete all records", e);
    }

    // Remove from UI list only (keep in S3)
    const newState = { ...uploadedFiles };
    delete newState[docName];
    setUploadedFiles(newState);
    setGeneratedData(null);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);

    try {
      const allUploadedDocs = Object.values(uploadedFiles).flat().map(f => f.name);

      const prompt = `
Generate a design concept data for component "${selectedComponent}" based on the provided documents.
Strictly return valid JSON only. No strings before or after the JSON.
The JSON must match this structure:
{
  "componentName": "${selectedComponent}",
  "generatedAt": "${new Date().toLocaleDateString("ja-JP")}",
  "uploadedDocuments": [${allUploadedDocs.map(d => `"${d}"`).join(',')}],
  "sections": {
    "overview": "Summary text...",
    "requirements": [ { "id": "REQ-001", "description": "...", "priority": "High", "source": "Source Name" } ],
    "regulations": [ { "code": "Reg Code", "description": "...", "status": "Compliant", "source": "Source Name" } ],
    "references": [ { "name": "Ref Name", "type": "File" } ]
  }
}
If specific data is not found, infer reasonable engineering defaults or state "Not specified" but maintain the JSON structure.
      `;

      const response = await client.queries.ragChat({
        query: prompt,
        uploadedDocs: allUploadedDocs.length > 0 ? allUploadedDocs : undefined
      });

      const jsonString = response.data?.answer || "{}";
      // Sanitize string if LLM adds markdown blocks
      const cleanJson = jsonString.replace(/```json/g, "").replace(/```/g, "").trim();

      const data: DesignConceptData = JSON.parse(cleanJson);

      // Fallback if parsing works but some fields missing?
      if (!data.sections) throw new Error("Invalid JSON structure");

      setGeneratedData(data);
    } catch (e) {
      console.error("Generation failed", e);
      alert("生成に失敗しました: " + (e as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Count document types with at least one file
  const uploadedCount = Object.keys(uploadedFiles).filter(k => uploadedFiles[k].length > 0).length;
  // Total file count across all document types
  const totalFilesCount = Object.values(uploadedFiles).flat().length;
  const totalDocs = INPUT_DOCS.length;

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 text-slate-700">
        <p className="text-sm">読み込み中...</p>
      </div>
    );
  }

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
                資料をアップロードして、設計構想書を自動生成 (Real RAG)
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm justify-end text-right">
            <div className="leading-tight">
              <p className="font-semibold">{user?.signInDetails?.loginId || user?.username || "User"}</p>
              <p className="text-[11px] text-sky-50/90">ログイン中</p>
            </div>
          </div>
        </div>
        <div className="h-2 bg-white/25" aria-hidden="true" />
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Input Data */}
          <section className="lg:col-span-1 space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="mb-4 flex items-center justify-between">
                <div className="inline-flex flex-col text-xl font-semibold uppercase text-sky-700">
                  <span className="fade-in-up">アップロード</span>
                  <span
                    className="fade-in-up mt-1 h-[3px] w-32 rounded-full bg-sky-700"
                    aria-hidden="true"
                  />
                </div>
                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                  {uploadedCount}/{totalDocs}
                </span>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                設計に必要な資料をアップロードしてください。
              </p>
              <div className="space-y-3">
                {INPUT_DOCS.map((doc) => {
                  const files = uploadedFiles[doc] || [];
                  const hasFiles = files.length > 0;
                  return (
                    <div key={doc} className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-3 transition hover:border-sky-400 hover:bg-white">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 truncate">{doc}</p>
                          {hasFiles ? (
                            <p className="text-xs text-emerald-600 flex items-center gap-1">
                              <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                              {files.length}件アップロード済み
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500">未選択</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer">
                            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm transition ${hasFiles ? 'bg-sky-700 hover:bg-sky-600 text-white' : 'bg-sky-600 hover:bg-sky-500 text-white'}`}>
                              {hasFiles ? "追加" : "選択"}
                            </span>
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => handleFileUpload(doc, e)}
                              accept=".pptx,.xlsx,.pdf"
                              multiple
                            />
                          </label>
                          {hasFiles && (
                            <button
                              onClick={() => handleClearAllFiles(doc)}
                              className="text-slate-400 hover:text-red-500 p-1 transition"
                              title="すべて削除"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          )}
                        </div>
                      </div>
                      {/* List of uploaded files */}
                      {hasFiles && (
                        <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                          {files.map((file, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2 text-xs text-slate-600 bg-white rounded px-2 py-1">
                              <span className="truncate flex-1" title={file.name}>{file.name}</span>
                              <button
                                onClick={() => handleRemoveFile(doc, file)}
                                className="text-slate-400 hover:text-red-500 transition flex-shrink-0"
                                title="削除"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Progress indicator */}
              {uploadedCount > 0 && uploadedCount < totalDocs && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="text-xs text-amber-700">
                    あと {totalDocs - uploadedCount} 種類の資料をアップロードしてください（合計 {totalFilesCount} ファイル）
                  </p>
                </div>
              )}
              {uploadedCount === totalDocs && (
                <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <p className="text-xs text-emerald-700">
                    すべての資料がアップロードされました（合計 {totalFilesCount} ファイル）
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Right Column: Output & Controls */}
          <section className="lg:col-span-2 space-y-6">
            {/* Controls */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between mb-4">
                <div className="inline-flex flex-col text-xl font-semibold uppercase text-cyan-700">
                  <span className="fade-in-up">対象部品</span>
                  <span
                    className="fade-in-up mt-1 h-[3px] w-32 rounded-full bg-cyan-700"
                    aria-hidden="true"
                  />
                </div>
                <span className="text-xs font-mono text-slate-400">v1.0.0</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {COMPONENTS.map((comp) => (
                  <button
                    key={comp}
                    onClick={() => {
                      setSelectedComponent(comp);
                      setGeneratedData(null);
                    }}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${selectedComponent === comp
                      ? "bg-sky-600 text-white shadow-md ring-2 ring-sky-300 ring-offset-1"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                  >
                    {comp}
                  </button>
                ))}
              </div>
            </div>

            {/* Output View */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 min-h-[500px] flex flex-col">
              <div className="mb-4 inline-flex flex-col text-xl font-semibold uppercase text-sky-700">
                <span className="fade-in-up">出力: {selectedComponent}</span>
                <span
                  className="fade-in-up mt-1 h-[3px] w-40 rounded-full bg-sky-700"
                  aria-hidden="true"
                />
              </div>

              {generatedData ? (
                <DesignConceptOutput
                  data={generatedData}
                  onDownload={() => { }}
                />
              ) : (
                <div className="flex-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center p-8">
                  <div className="text-center text-slate-500">
                    {isGenerating ? (
                      <>
                        <svg className="w-16 h-16 mx-auto mb-4 text-sky-500 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p className="text-lg font-semibold text-slate-900">生成中...</p>
                        <p className="text-sm mt-2 text-slate-600">
                          S3ファイル解析・Bedrock推論を実行中<br />
                          (時間がかかる場合があります)
                        </p>
                      </>
                    ) : (
                      <>
                        <svg className="w-16 h-16 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <p className="text-lg font-semibold text-slate-900">まだ生成されていません</p>
                        <p className="text-sm mt-2 max-w-sm mx-auto text-slate-600">
                          {uploadedCount === 0
                            ? "左側のパネルから資料をアップロードしてください"
                            : "「構想書を生成」ボタンを押して設計構想書を生成してください"
                          }
                        </p>
                        <button
                          onClick={handleGenerate}
                          disabled={uploadedCount === 0}
                          className={`mt-6 rounded-full px-6 py-2.5 text-sm font-semibold transition-all shadow-sm ${uploadedCount === 0
                            ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                            : "bg-sky-600 text-white hover:bg-sky-500"
                            }`}
                        >
                          構想書を生成 (Real RAG)
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <Chatbot
        uploadedFiles={uploadedFiles}
        selectedComponent={selectedComponent}
        generatedData={generatedData}
      />
    </div>
  );
}
