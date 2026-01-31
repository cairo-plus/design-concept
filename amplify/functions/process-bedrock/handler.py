import os
import json
import base64
import boto3
import urllib.parse
import uuid
import io
import tempfile
import time
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from pdf2image import convert_from_bytes, convert_from_path
import pypdf
from openpyxl import load_workbook
from pptx import Presentation
from PIL import Image

from botocore.config import Config

# Initialize Clients
s3 = boto3.client('s3')

my_config = Config(
    read_timeout=900,
    connect_timeout=900,
    retries={'max_attempts': 3}
)
# Use region from environment or default
REGION = os.environ.get('AWS_REGION', 'ap-northeast-1')
bedrock_runtime = boto3.client('bedrock-runtime', region_name=REGION, config=my_config)

# Environment Variables
# Default to Claude 3.5 Sonnet (Tokyo compatible if available, or US Cross Region)
# Example Tokyo: anthropic.claude-3-5-sonnet-20240620-v1:0
MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-3-5-sonnet-20240620-v1:0')
OUTPUT_BUCKET = os.environ.get('OUTPUT_BUCKET_NAME')

# Constants
DPI = 300 # Slightly reduced for speed but good enough
MAX_WORKERS = 1
ROWS_PER_CHUNK = 300

def handler(event, context):
    print(f"Using Bedrock Model ID: {MODEL_ID} in Region: {REGION}")
    print("Received event:", json.dumps(event))
    
    results = []
    for record in event.get('Records', []):
        try:
            result = process_record(record)
            if result:
                results.append(result)
        except Exception as e:
            print(f"Error processing record: {e}")
            results.append({"error": str(e)})
            
    return {
        "statusCode": 200,
        "body": json.dumps(results if results else "Processing Complete")
    }

def process_record(record):
    bucket = record['s3']['bucket']['name']
    key = urllib.parse.unquote_plus(record['s3']['object']['key'])
    size = record['s3']['object']['size']
    
    print(f"Processing s3://{bucket}/{key} (Size: {size})")

    ext = os.path.splitext(key)[1].lower()
    
    supported_extensions = ['.pdf', '.xlsx', '.xls', '.pptx', '.ppt']
    
    if ext not in supported_extensions:
        print(f"Unsupported extension: {ext}")
        return None

    file_size_mb = size / (1024 * 1024)
    print(f"File Size: {file_size_mb:.2f} MB")
    
    try:
        # Download file directly from trigger bucket
        print(f"Downloading file...")
        response = s3.get_object(Bucket=bucket, Key=key)
        file_bytes = response['Body'].read()
        print(f"Downloaded {len(file_bytes)} bytes")
        
        # Process file
        if ext == '.pdf':
            text_content = process_pdf_pipeline(file_bytes)
        else:
            text_content = process_office_file(file_bytes, ext)
        
        print(f"Total result length: {len(text_content)} chars")
        
        # Save result (to the SAME bucket usually, protected/ path)
        # Using the bucket from event if OUTPUT_BUCKET not set
        target_bucket = OUTPUT_BUCKET if OUTPUT_BUCKET else bucket
        save_final_result(target_bucket, key, text_content)
        
        return {"status": "COMPLETED", "fileName": os.path.basename(key)}
        
    except Exception as e:
        print(f"Processing failed: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "FAILED", "error": str(e)}

def process_pdf_pipeline(file_bytes):
    """
    Pipeline processing for PDF using Bedrock Vision
    """
    
    # Get total page count
    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        total_pages = len(reader.pages)
        del reader
    except Exception:
        total_pages = 10 
    
    print(f"Total pages: {total_pages}")
    
    results_map = {}
    futures = []
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for page_num in range(1, total_pages + 1):
            print(f"Converting page {page_num}/{total_pages}...")
            
            try:
                # Convert single page
                images = convert_from_bytes(
                    file_bytes, 
                    dpi=DPI, 
                    fmt='png',
                    first_page=page_num,
                    last_page=page_num
                )
                
                if images:
                    img_bytes = pil_to_bytes(images[0])
                    print(f"Submitting page {page_num} to API (Size: {len(img_bytes)/1024:.1f}KB)")
                    
                    # Submit to thread pool
                    future = executor.submit(call_converse_api_image, img_bytes, page_num, total_pages)
                    futures.append((page_num, future))
                    
                    del images
                    del img_bytes
                else:
                    print(f"No image returned for page {page_num}, stopping.")
                    break
                    
            except Exception as e:
                print(f"Conversion error on page {page_num}: {e}")
                results_map[page_num] = f"\n\n[Error converting page {page_num}: {e}]\n\n"

        # Wait for all API calls to complete
        print("Waiting for API responses...")
        for page_num, future in futures:
            try:
                text = future.result()
                results_map[page_num] = text
            except Exception as e:
                print(f"API error on page {page_num}: {e}")
                results_map[page_num] = f"\n\n[Error processing page {page_num}: {e}]\n\n"

    # Combine results in order
    sorted_results = [results_map[i] for i in sorted(results_map.keys())]
    return "\n\n".join(sorted_results)

from markitdown import MarkItDown

def process_office_file(file_bytes, ext):
    """Route to appropriate processing method using MarkItDown."""
    
    print(f"Processing {ext} file with MarkItDown...")
    
    # Save to temp file because MarkItDown works best with file paths
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
        
    try:
        md = MarkItDown()
        result = md.convert(tmp_path)
        return result.text_content
        
    except Exception as e:
        print(f"MarkItDown conversion failed: {e}")
        if "MissingDependencyException" in str(e):
             print("TIP: Ensure all dependencies (xlsx, etc.) are installed.")
        raise e
        
    finally:
        # Cleanup temp file
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def pil_to_bytes(pil_image):
    buffer = io.BytesIO()
    pil_image.save(buffer, format='PNG')
    return buffer.getvalue()

def call_converse_api_image(img_bytes, page_num, total_pages):
    prompt = f"""[Page {page_num} of {total_pages}]

Transcribe the content of this page into Markdown. Follow these rules STRICTLY:

## Text Rules
- Transcribe exactly as it appears
- Preserve all formatting (bold, italic, headers)

## Table Rules (CRITICAL)
- Use `|` to separate each cell
- Use `-` for empty cells (never leave blank)
- Every row must have the same number of `|` separators
- For merged cells, REPEAT the value in each corresponding cell
- Capture ALL symbols: ✓ ○ × • ◎ △ etc.

## Output Format
- Return ONLY the Markdown content
- No preamble
"""
    
    content_blocks = [
        {"image": {"format": "png", "source": {"bytes": img_bytes}}},
        {"text": prompt}
    ]
    
    response = bedrock_runtime.converse(
        modelId=MODEL_ID,
        messages=[{"role": "user", "content": content_blocks}],
        inferenceConfig={"maxTokens": 4096, "temperature": 0.0, "topP": 0.1}
    )
    
    output_message = response['output']['message']
    text_content = ""
    for content in output_message['content']:
        if 'text' in content:
            text_content += content['text']
    
    return text_content

def save_final_result(bucket, original_key, content):
    
    # public/{docName}/{timestamp}/{fileName}
    # -> protected/{docName}/{timestamp}/{fileName}.md
    
    # Careful with path.
    # If input is public/A.pdf, we want protected/A.md ??
    # User's other tool uses `protected/{identityId}/...`
    # Let's just swap public -> protected and change extension.
    
    base_name = os.path.basename(original_key)
    file_name_no_ext = os.path.splitext(base_name)[0]
    
    # Construct output key
    # Maintain directory structure but move to protected or specific folder?
    # Original logic: protected/{file_name_no_ext}.md (Flattened??)
    
    # Let's try to preserve the folder structure but change prefix
    # input: public/DesignDoc/TIMESTAMP/file.pdf
    # output: protected/DesignDoc/TIMESTAMP/file.md
    
    dir_name = os.path.dirname(original_key)
    new_dir = dir_name.replace('public/', 'protected/', 1)
    if new_dir == dir_name:
         new_dir = f"protected/{dir_name}" # Fallback
         
    output_key = f"{new_dir}/{file_name_no_ext}.md"
    content_with_bom = '\ufeff' + content
    
    print(f"Saving result to s3://{bucket}/{output_key}")
    s3.put_object(
        Bucket=bucket,
        Key=output_key,
        Body=content_with_bom.encode('utf-8'),
        ContentType='text/markdown; charset=utf-8'
    )
