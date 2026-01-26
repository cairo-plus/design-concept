"use client";

import * as XLSX from "xlsx";

export interface DesignConceptData {
    componentName: string;
    generatedAt: string;
    uploadedDocuments: string[];
    sections: {
        overview: string;
        requirements: { id: string; description: string; priority: string }[];
        regulations: { code: string; description: string; status: string }[];
        references: { name: string; type: string }[];
    };
}

/**
 * Generate mock design concept data for demonstration
 */
export function generateMockData(
    componentName: string,
    uploadedDocs: string[]
): DesignConceptData {
    return {
        componentName,
        generatedAt: new Date().toLocaleDateString("ja-JP"),
        uploadedDocuments: uploadedDocs,
        sections: {
            overview: `${componentName}の設計構想書\n\n本書は、${componentName}の設計要件、法規要件、参考資料をまとめたものです。`,
            requirements: [
                { id: "REQ-001", description: "軽量化：現行比10%削減", priority: "高" },
                { id: "REQ-002", description: "コスト目標：現行同等以下", priority: "高" },
                { id: "REQ-003", description: "組立性向上：工数20%削減", priority: "中" },
                { id: "REQ-004", description: "デザイン自由度確保", priority: "中" },
                { id: "REQ-005", description: "耐久性：10年/20万km保証", priority: "高" },
            ],
            regulations: [
                { code: "ECE R42", description: "前部及び後部の保護装置", status: "適合要" },
                { code: "FMVSS 581", description: "バンパー基準", status: "適合要" },
                { code: "ECE R26", description: "外部突起規制", status: "適合要" },
            ],
            references: uploadedDocs.map((doc) => ({
                name: doc,
                type: "アップロード資料",
            })),
        },
    };
}

/**
 * Export design concept data to Excel file
 */
export function exportToExcel(data: DesignConceptData): void {
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Overview
    const overviewData = [
        ["設計構想書"],
        [""],
        ["対象コンポーネント", data.componentName],
        ["生成日", data.generatedAt],
        [""],
        ["概要"],
        [data.sections.overview],
    ];
    const overviewSheet = XLSX.utils.aoa_to_sheet(overviewData);
    overviewSheet["!cols"] = [{ wch: 20 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(workbook, overviewSheet, "概要");

    // Sheet 2: Requirements
    const reqHeader = ["要件ID", "説明", "優先度"];
    const reqData = [reqHeader, ...data.sections.requirements.map((r) => [r.id, r.description, r.priority])];
    const reqSheet = XLSX.utils.aoa_to_sheet(reqData);
    reqSheet["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(workbook, reqSheet, "要件一覧");

    // Sheet 3: Regulations
    const regHeader = ["法規コード", "説明", "ステータス"];
    const regData = [regHeader, ...data.sections.regulations.map((r) => [r.code, r.description, r.status])];
    const regSheet = XLSX.utils.aoa_to_sheet(regData);
    regSheet["!cols"] = [{ wch: 15 }, { wch: 35 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(workbook, regSheet, "法規要件");

    // Sheet 4: References
    const refHeader = ["資料名", "種類"];
    const refData = [refHeader, ...data.sections.references.map((r) => [r.name, r.type])];
    const refSheet = XLSX.utils.aoa_to_sheet(refData);
    refSheet["!cols"] = [{ wch: 40 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, refSheet, "参考資料");

    // Generate filename and download
    const filename = `設計構想書_${data.componentName}_${data.generatedAt.replace(/\//g, "")}.xlsx`;
    XLSX.writeFile(workbook, filename);
}
