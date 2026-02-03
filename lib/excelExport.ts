"use client";

import * as XLSX from "xlsx";

export interface DesignConceptData {
    componentName: string;
    generatedAt: string;
    uploadedDocuments: string[];
    sections: {
        objectives: string; // 1.目的
        currentIssues: string; // 2.現状の課題
        benchmark: string; // 3.ベンチマーク
        designConcept: string; // 4.設計コンセプト
        mainSpecifications: { item: string; spec: string }[]; // 5.主要仕様
        basicStructure: string; // 6.基本構造
        adoptedTechnologies: string; // 7.採用技術
        risksAndCountermeasures: { risk: string; countermeasure: string }[]; // 8.リスク及び対応策
        // Legacy/Common fields
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
    return {
        componentName,
        generatedAt: new Date().toLocaleDateString("ja-JP"),
        uploadedDocuments: uploadedDocs,
        sections: {
            objectives: `【${componentName}の開発目的】\n・次世代モデルとしての競争力強化\n・環境規制への対応\n・ユーザー利便性の向上`,
            currentIssues: "・重量増による燃費悪化\n・製造コストの高止まり\n・部品点数の多さ",
            benchmark: "・競合A社：軽量素材の採用により-15%の軽量化達成\n・競合B社：モジュール化による組立工数削減",
            designConcept: `「Eco & Smart ${componentName}」\n・軽量化と高剛性の両立\n・リサイクル素材の積極採用\n・スマート機能の統合`,
            mainSpecifications: [
                { item: "重量", spec: "15.5kg (目標値)" },
                { item: "材質", spec: "アルミニウム合金 / CFRP" },
                { item: "寸法", spec: "1200mm x 600mm x 300mm" },
                { item: "表面処理", spec: "耐候性塗装 3コート" }
            ],
            basicStructure: "・インナーパネルとアウターパネルの2重構造\n・閉断面構造による剛性確保\n・ヒンジ部への補強材配置",
            adoptedTechnologies: "・ホットスタンプ成形\n・レーザー溶接\n・構造用接着剤の併用",
            risksAndCountermeasures: [
                { risk: "新素材採用によるコスト増", countermeasure: "歩留まり向上改善と量産効果による相殺" },
                { risk: "成形難易度の上昇", countermeasure: "CAE解析による事前検証の徹底" },
                { risk: "異種材料接合部の腐食", countermeasure: "電食防止シールの適用" }
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

    // Sheet 1: Concept Document (全体)
    // We will list all sections in order
    const overviewData: any[][] = [
        ["設計構想書"],
        [""],
        ["対象コンポーネント", data.componentName],
        ["生成日", data.generatedAt],
        [""],
        // 1. 目的
        ["1. 目的"],
        [data.sections.objectives],
        [""],
        // 2. 現状の課題
        ["2. 現状の課題"],
        [data.sections.currentIssues],
        [""],
        // 3. ベンチマーク
        ["3. ベンチマーク"],
        [data.sections.benchmark],
        [""],
        // 4. 設計コンセプト
        ["4. 設計コンセプト"],
        [data.sections.designConcept],
        [""],
        // 5. 主要仕様
        ["5. 主要仕様"],
        ["項目", "仕様値"],
        ...data.sections.mainSpecifications.map(s => [s.item, s.spec]),
        [""],
        // 6. 基本構造
        ["6. 基本構造"],
        [data.sections.basicStructure],
        [""],
        // 7. 採用技術
        ["7. 採用技術"],
        [data.sections.adoptedTechnologies],
        [""],
        // 8. リスク及び対応策
        ["8. リスク及び対応策"],
        ["リスク", "対応策"],
        ...data.sections.risksAndCountermeasures.map(r => [r.risk, r.countermeasure]),
        [""],
        // References
        ["参考資料"],
        ["資料名", "種類"],
        ...data.sections.references.map((r) => [r.name, r.type]),
        [""],
        ["引用元資料一覧"],
        ...data.uploadedDocuments.map((doc, i) => [`${i + 1}. ${doc}`]),
    ];

    const overviewSheet = XLSX.utils.aoa_to_sheet(overviewData);
    // Adjust column widths roughly
    overviewSheet["!cols"] = [{ wch: 30 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(workbook, overviewSheet, "設計構想書");

    // Generate filename and download
    const filename = `設計構想書_${data.componentName}_${data.generatedAt.replace(/\//g, "")}.xlsx`;
    XLSX.writeFile(workbook, filename);
}

