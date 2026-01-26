"use client";

import * as XLSX from "xlsx";

export interface DesignConceptData {
    componentName: string;
    generatedAt: string;
    uploadedDocuments: string[];
    sections: {
        overview: string;
        requirements: { id: string; description: string; priority: string; source: string }[];
        regulations: { code: string; description: string; status: string; source: string }[];
        references: { name: string; type: string }[];
    };
}

// Document types for citation
const DOC_TYPES = [
    "設計構想書",
    "商品計画書",
    "製品企画書",
    "ハードウエア設計者の対応するリスト",
    "専門家の研究資料",
    "法規リスト",
];

/**
 * Generate mock design concept data for demonstration with citations
 */
export function generateMockData(
    componentName: string,
    uploadedDocs: string[]
): DesignConceptData {
    // Create citation mapping based on uploaded docs
    const getSource = (docType: string, page: number) => {
        // Try to find a file that matches the docType
        // Simple heuristic: check if doc name includes docType or vice versa
        const matchedDoc = uploadedDocs.find(doc => doc.includes(docType) || docType.includes(doc));

        if (matchedDoc) {
            return `${matchedDoc} p.${page}`;
        }
        // Fallback
        return uploadedDocs.length > 0 ? `${uploadedDocs[0]} p.${page}` : `${docType} p.${page}`;
    };

    return {
        componentName,
        generatedAt: new Date().toLocaleDateString("ja-JP"),
        uploadedDocuments: uploadedDocs,
        sections: {
            overview: `${componentName}の設計構想書\n\n本書は、${componentName}の設計要件、法規要件、参考資料をまとめたものです。\n\n【引用元資料】\n${uploadedDocs.map((doc, i) => `${i + 1}. ${doc}`).join('\n')}`,
            requirements: [
                { id: "REQ-001", description: "軽量化：現行比10%削減", priority: "高", source: getSource("商品計画書", 12) },
                { id: "REQ-002", description: "コスト目標：現行同等以下", priority: "高", source: getSource("商品計画書", 15) },
                { id: "REQ-003", description: "組立性向上：工数20%削減", priority: "中", source: getSource("製品企画書", 8) },
                { id: "REQ-004", description: "デザイン自由度確保", priority: "中", source: getSource("製品企画書", 22) },
                { id: "REQ-005", description: "耐久性：10年/20万km保証", priority: "高", source: getSource("設計構想書", 5) },
            ],
            regulations: [
                { code: "ECE R42", description: "前部及び後部の保護装置", status: "適合要", source: getSource("法規リスト", 3) },
                { code: "FMVSS 581", description: "バンパー基準", status: "適合要", source: getSource("法規リスト", 7) },
                { code: "ECE R26", description: "外部突起規制", status: "適合要", source: getSource("法規リスト", 12) },
            ],
            references: uploadedDocs.map((doc) => ({
                name: doc,
                type: "アップロード資料",
            })),
        },
    };
}

/**
 * Export design concept data to Excel file with citations
 */
export function exportToExcel(data: DesignConceptData): void {
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Overview (概要)
    const overviewData = [
        ["設計構想書"],
        [""],
        ["対象コンポーネント", data.componentName],
        ["生成日", data.generatedAt],
        [""],
        ["概要"],
        [data.sections.overview],
        [""],
        ["引用元資料一覧"],
        ...data.uploadedDocuments.map((doc, i) => [`${i + 1}. ${doc}`]),
    ];
    const overviewSheet = XLSX.utils.aoa_to_sheet(overviewData);
    overviewSheet["!cols"] = [{ wch: 25 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(workbook, overviewSheet, "概要");

    // Sheet 2: Requirements with citations (要件一覧)
    const reqHeader = ["要件ID", "説明", "優先度", "引用元"];
    const reqData = [reqHeader, ...data.sections.requirements.map((r) => [r.id, r.description, r.priority, r.source])];
    const reqSheet = XLSX.utils.aoa_to_sheet(reqData);
    reqSheet["!cols"] = [{ wch: 12 }, { wch: 35 }, { wch: 10 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(workbook, reqSheet, "要件一覧");

    // Sheet 3: Regulations with citations (法規要件)
    const regHeader = ["法規コード", "説明", "ステータス", "引用元"];
    const regData = [regHeader, ...data.sections.regulations.map((r) => [r.code, r.description, r.status, r.source])];
    const regSheet = XLSX.utils.aoa_to_sheet(regData);
    regSheet["!cols"] = [{ wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(workbook, regSheet, "法規要件");

    // Sheet 4: References (参考資料)
    const refHeader = ["資料名", "種類"];
    const refData = [refHeader, ...data.sections.references.map((r) => [r.name, r.type])];
    const refSheet = XLSX.utils.aoa_to_sheet(refData);
    refSheet["!cols"] = [{ wch: 40 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, refSheet, "参考資料");

    // Generate filename and download
    const filename = `設計構想書_${data.componentName}_${data.generatedAt.replace(/\//g, "")}.xlsx`;
    XLSX.writeFile(workbook, filename);
}
