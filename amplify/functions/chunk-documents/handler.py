import os
import json
import boto3
import re
from typing import List, Dict

s3 = boto3.client('s3')

# 文書種別の自動判定ルール
DOC_TYPE_PATTERNS = {
    'merchandise_plan': ['商品計画', '市場ターゲット', '販売地域'],
    'product_plan': ['製品企画', '車両諸元', 'パワートレーン'],
    'current_bom': ['部品表', 'BOM', '部品番号', 'GLMC'],
    'regulation': ['UN-R', 'NCAP', '法規', '規則', 'Article'],
    'technical_paper': ['論文', '技術資料', '学会'],
    'reflex_rules': ['脊髄反射', '対応リスト', 'ルール', 'Rule:'],
    'competitor_benchmark': ['競合', 'ベンチマーク', '他社'],
    'past_design_intent': ['設計構想', '設計意図', 'Design Intent'],
}

def handler(event, context):
    """
    S3イベントトリガー: Markdown化されたファイルをチャンク分割
    """
    print(f"Received event: {json.dumps(event)}")
    
    for record in event.get('Records', []):
        try:
            bucket = record['s3']['bucket']['name']
            key = record['s3']['object']['key']
            
            # .mdファイルのみ処理
            if not key.endswith('.md'):
                print(f"Skipping non-markdown file: {key}")
                continue
            
            print(f"Processing: s3://{bucket}/{key}")
            
            # Markdownファイルの読み込み
            response = s3.get_object(Bucket=bucket, Key=key)
            content = response['Body'].read().decode('utf-8')
            
            # 文書種別の自動判定
            doc_type = detect_document_type(content, key)
            print(f"Detected document type: {doc_type}")
            
            # チャンク分割（文書種別に応じた戦略）
            chunks = chunk_by_document_type(content, key, doc_type)
            print(f"Generated {len(chunks)} chunks")
            
            # メタデータ付きJSONとして保存
            output_key = key.replace('.md', '_chunks.json')
            s3.put_object(
                Bucket=bucket,
                Key=output_key,
                Body=json.dumps(chunks, ensure_ascii=False, indent=2),
                ContentType='application/json'
            )
            print(f"Saved chunks to: s3://{bucket}/{output_key}")
            
        except Exception as e:
            print(f"Error processing {key}: {e}")
            import traceback
            traceback.print_exc()
    
    return {'statusCode': 200, 'body': 'Chunking completed'}

def detect_document_type(content: str, filename: str) -> str:
    """
    文書内容とファイル名から種別を自動判定
    """
    # ファイル名からの判定
    filename_lower = filename.lower()
    if 'merchandise' in filename_lower or '商品計画' in filename_lower:
        return 'merchandise_plan'
    if 'product' in filename_lower or '製品企画' in filename_lower:
        return 'product_plan'
    if 'bom' in filename_lower or '部品表' in filename_lower:
        return 'current_bom'
    
    # 内容からの判定
    for doc_type, keywords in DOC_TYPE_PATTERNS.items():
        if any(keyword in content for keyword in keywords):
            return doc_type
    
    return 'unknown'

def chunk_by_document_type(content: str, source_file: str, doc_type: str) -> List[Dict]:
    """
    文書種別に応じたチャンク分割
    """
    if doc_type in ['merchandise_plan', 'product_plan']:
        return chunk_by_section(content, source_file, doc_type)
    elif doc_type == 'regulation':
        return chunk_by_article(content, source_file)
    elif doc_type == 'reflex_rules':
        return chunk_by_rule(content, source_file)
    elif doc_type == 'current_bom':
        return chunk_by_table(content, source_file)
    else:
        return chunk_by_heading(content, source_file, doc_type)

def chunk_by_section(content: str, source_file: str, doc_type: str) -> List[Dict]:
    """
    セクション単位でチャンク分割（商品計画書・製品企画書）
    """
    chunks = []
    lines = content.split('\n')
    
    current_chunk = []
    current_heading = ""
    section_type = "general"
    chunk_id = 0
    
    for line in lines:
        # 見出し検出
        if line.startswith('#'):
            # 前のチャンクを保存
            if current_chunk:
                chunks.append({
                    'id': f'{source_file}#chunk{chunk_id}',
                    'text': '\n'.join(current_chunk),
                    'metadata': {
                        'source': source_file,
                        'doc_type': doc_type,
                        'heading': current_heading,
                        'section_type': section_type,
                        'chunk_index': chunk_id,
                        'rflp_step': 'step1_r_to_f',
                    }
                })
                chunk_id += 1
                current_chunk = []
            
            current_heading = line.strip('#').strip()
            # セクションタイプの判定
            if any(kw in current_heading for kw in ['市場', 'ターゲット', 'マーケット']):
                section_type = 'market_analysis'
            elif any(kw in current_heading for kw in ['性能', '目標', '諸元', 'スペック']):
                section_type = 'performance_target'
            elif any(kw in current_heading for kw in ['コスト', '価格', '原価']):
                section_type = 'cost_target'
            elif any(kw in current_heading for kw in ['安全', '衝突', 'NCAP']):
                section_type = 'safety_requirement'
        
        current_chunk.append(line)
        
        # チャンクサイズ制限（約1000トークン = 4000文字）
        if len('\n'.join(current_chunk)) > 4000:
            chunks.append({
                'id': f'{source_file}#chunk{chunk_id}',
                'text': '\n'.join(current_chunk),
                'metadata': {
                    'source': source_file,
                    'doc_type': doc_type,
                    'heading': current_heading,
                    'section_type': section_type,
                    'chunk_index': chunk_id,
                    'rflp_step': 'step1_r_to_f',
                }
            })
            chunk_id += 1
            current_chunk = []
    
    # 最後のチャンク
    if current_chunk:
        chunks.append({
            'id': f'{source_file}#chunk{chunk_id}',
            'text': '\n'.join(current_chunk),
            'metadata': {
                'source': source_file,
                'doc_type': doc_type,
                'heading': current_heading,
                'section_type': section_type,
                'chunk_index': chunk_id,
                'rflp_step': 'step1_r_to_f',
            }
        })
    
    return chunks

def chunk_by_article(content: str, source_file: str) -> List[Dict]:
    """
    条文単位でチャンク分割（法規文書）
    """
    chunks = []
    # Article/Annex パターンで分割
    articles = re.split(r'(Article \d+|Annex \d+|第\d+条)', content)
    
    for i in range(1, len(articles), 2):
        if i+1 < len(articles):
            article_num = articles[i].strip()
            article_text = articles[i+1].strip()
            
            if article_text:  # 空でない場合のみ追加
                chunks.append({
                    'id': f'{source_file}#{article_num.replace(" ", "_")}',
                    'text': f'{article_num}\n{article_text}',
                    'metadata': {
                        'source': source_file,
                        'doc_type': 'regulation',
                        'article_number': article_num,
                        'rflp_step': 'step3_l_to_p_method1',
                    }
                })
    
    return chunks

def chunk_by_rule(content: str, source_file: str) -> List[Dict]:
    """
    ルール単位でチャンク分割（脊髄反射リスト）
    """
    chunks = []
    lines = content.split('\n')
    
    current_rule = []
    rule_id = 0
    
    for line in lines:
        # ルールの区切り検出
        if line.startswith('Rule:') or line.startswith('条件:') or line.startswith('##') or line == '---':
            if current_rule and len('\n'.join(current_rule).strip()) > 10:
                rule_text = '\n'.join(current_rule)
                trigger = extract_trigger(rule_text)
                
                chunks.append({
                    'id': f'{source_file}#rule{rule_id}',
                    'text': rule_text,
                    'metadata': {
                        'source': source_file,
                        'doc_type': 'reflex_rules',
                        'rule_id': rule_id,
                        'trigger_condition': trigger,
                        'rflp_step': 'step3_l_to_p_method2',
                    }
                })
                rule_id += 1
                current_rule = []
        
        current_rule.append(line)
    
    # 最後のルール
    if current_rule and len('\n'.join(current_rule).strip()) > 10:
        rule_text = '\n'.join(current_rule)
        trigger = extract_trigger(rule_text)
        chunks.append({
            'id': f'{source_file}#rule{rule_id}',
            'text': rule_text,
            'metadata': {
                'source': source_file,
                'doc_type': 'reflex_rules',
                'rule_id': rule_id,
                'trigger_condition': trigger,
                'rflp_step': 'step3_l_to_p_method2',
            }
        })
    
    return chunks

def chunk_by_table(content: str, source_file: str) -> List[Dict]:
    """
    テーブル単位でチャンク分割（BOM）
    """
    chunks = []
    lines = content.split('\n')
    
    current_table = []
    in_table = False
    chunk_id = 0
    
    for line in lines:
        # Markdownテーブルの検出
        if '|' in line:
            in_table = True
            current_table.append(line)
        else:
            if in_table and current_table:
                # テーブル終了
                chunks.append({
                    'id': f'{source_file}#table{chunk_id}',
                    'text': '\n'.join(current_table),
                    'metadata': {
                        'source': source_file,
                        'doc_type': 'current_bom',
                        'chunk_type': 'table',
                        'chunk_index': chunk_id,
                        'rflp_step': 'step2_f_to_l',
                    }
                })
                chunk_id += 1
                current_table = []
                in_table = False
    
    # 最後のテーブル
    if current_table:
        chunks.append({
            'id': f'{source_file}#table{chunk_id}',
            'text': '\n'.join(current_table),
            'metadata': {
                'source': source_file,
                'doc_type': 'current_bom',
                'chunk_type': 'table',
                'chunk_index': chunk_id,
                'rflp_step': 'step2_f_to_l',
            }
        })
    
    return chunks

def chunk_by_heading(content: str, source_file: str, doc_type: str) -> List[Dict]:
    """
    見出し単位でチャンク分割（汎用）
    """
    chunks = []
    lines = content.split('\n')
    
    current_chunk = []
    current_heading = ""
    chunk_id = 0
    
    for line in lines:
        if line.startswith('#'):
            if current_chunk:
                chunks.append({
                    'id': f'{source_file}#chunk{chunk_id}',
                    'text': '\n'.join(current_chunk),
                    'metadata': {
                        'source': source_file,
                        'doc_type': doc_type,
                        'heading': current_heading,
                        'chunk_index': chunk_id,
                    }
                })
                chunk_id += 1
                current_chunk = []
            
            current_heading = line.strip('#').strip()
        
        current_chunk.append(line)
        
        if len('\n'.join(current_chunk)) > 4000:
            chunks.append({
                'id': f'{source_file}#chunk{chunk_id}',
                'text': '\n'.join(current_chunk),
                'metadata': {
                    'source': source_file,
                    'doc_type': doc_type,
                    'heading': current_heading,
                    'chunk_index': chunk_id,
                }
            })
            chunk_id += 1
            current_chunk = []
    
    if current_chunk:
        chunks.append({
            'id': f'{source_file}#chunk{chunk_id}',
            'text': '\n'.join(current_chunk),
            'metadata': {
                'source': source_file,
                'doc_type': doc_type,
                'heading': current_heading,
                'chunk_index': chunk_id,
            }
        })
    
    return chunks

def extract_trigger(rule_text: str) -> str:
    """
    ルールテキストからトリガー条件を抽出
    """
    if '車両重量' in rule_text or '重量' in rule_text:
        return 'weight_change'
    elif '出力' in rule_text or 'パワー' in rule_text:
        return 'power_change'
    elif '材料' in rule_text or '材質' in rule_text:
        return 'material_change'
    elif 'サスペンション' in rule_text:
        return 'suspension_adjustment'
    else:
        return 'unknown'
