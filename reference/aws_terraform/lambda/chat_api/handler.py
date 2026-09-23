"""
Chat API Lambda — handles /upload, /chat, /status endpoints
Supports streaming responses via Server-Sent Events
"""
import json
import boto3
import os
import uuid
from datetime import datetime, timezone

s3_client      = boto3.client("s3")
lambda_client  = boto3.client("lambda")
bedrock_client = boto3.client("bedrock-runtime")
dynamodb       = boto3.resource("dynamodb")

JOBS_TABLE            = os.environ["JOBS_TABLE"]
DOC_BUCKET            = os.environ["DOC_BUCKET"]
ORCHESTRATOR_FUNCTION = os.environ["ORCHESTRATOR_FUNCTION"]
MODEL_ID              = os.environ["MODEL_ID"]

def handle_upload(body, query_params):
    """Generate pre-signed URL for direct S3 upload from browser"""
    filename = body.get("filename", "document.pdf")
    doc_type = "pdf" if filename.lower().endswith(".pdf") else "docx"
    key      = f"uploads/{doc_type}/{uuid.uuid4()}/{filename}"
    
    presigned_url = s3_client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket":      DOC_BUCKET,
            "Key":         key,
            "ContentType": "application/octet-stream"
        },
        ExpiresIn=300  # 5 minutes
    )
    
    return {
        "statusCode": 200,
        "body": json.dumps({
            "uploadUrl": presigned_url,
            "s3Key":     key,
            "docType":   doc_type.upper(),
            "message":   f"Upload URL valid for 5 minutes. File will be processed automatically on upload."
        })
    }

def handle_status(job_id):
    """Get job processing status from DynamoDB"""
    table = dynamodb.Table(JOBS_TABLE)
    resp  = table.get_item(Key={"jobId": job_id})
    item  = resp.get("Item")
    
    if not item:
        return {"statusCode": 404, "body": json.dumps({"error": "Job not found"})}
    
    response_body = {
        "jobId":     item["jobId"],
        "status":    item.get("status", "UNKNOWN"),
        "docType":   item.get("docType", ""),
        "processor": item.get("processor", ""),
        "createdAt": item.get("createdAt", ""),
        "updatedAt": item.get("updatedAt", ""),
    }
    
    if item.get("status") == "COMPLETED":
        result_raw = item.get("processingResult", "{}")
        try:
            result = json.loads(result_raw)
            response_body["summary"]   = result.get("summary", "")
            response_body["processor"] = result.get("processor", "")
        except Exception:
            response_body["summary"] = item.get("summaryPreview", "")
    
    if item.get("status") == "FAILED":
        response_body["error"] = item.get("errorMessage", "Unknown error")
    
    return {"statusCode": 200, "body": json.dumps(response_body)}

def handle_chat(body):
    """
    Chat endpoint — streams response from Claude with document context
    Supports: asking questions about processed documents
    """
    message    = body.get("message", "")
    job_id     = body.get("jobId", "")
    history    = body.get("history", [])
    
    # Build context from job result if jobId provided
    context = ""
    if job_id:
        table = dynamodb.Table(JOBS_TABLE)
        resp  = table.get_item(Key={"jobId": job_id})
        item  = resp.get("Item", {})
        if item.get("status") == "COMPLETED":
            result_raw = item.get("processingResult", "{}")
            try:
                result  = json.loads(result_raw)
                context = f"\n\nDocument Summary Context:\n{result.get('summary', '')}"
            except Exception:
                context = f"\n\nDocument Preview:\n{item.get('summaryPreview', '')}"
    
    # Build messages for Claude
    messages = []
    for h in history[-10:]:  # Last 10 turns
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": message + context})
    
    system_prompt = (
        "You are an intelligent document assistant. You help users understand "
        "documents that have been processed by an AI pipeline. When a document "
        "summary is provided in the context, use it to answer questions accurately. "
        "Be concise, helpful, and cite specific parts of the document when relevant."
    )
    
    # Stream response from Bedrock
    response = bedrock_client.invoke_model_with_response_stream(
        modelId=MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens":        2048,
            "system":            system_prompt,
            "messages":          messages
        }),
        contentType="application/json",
        accept="application/json"
    )
    
    # Collect streamed chunks
    full_response = ""
    for event in response.get("body", []):
        chunk = json.loads(event["chunk"]["bytes"])
        if chunk.get("type") == "content_block_delta":
            delta = chunk.get("delta", {})
            if delta.get("type") == "text_delta":
                full_response += delta.get("text", "")
    
    return {
        "statusCode": 200,
        "body": json.dumps({
            "response": full_response,
            "jobId":    job_id,
            "model":    MODEL_ID
        })
    }

def lambda_handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path   = event.get("rawPath", "/")
    body   = {}
    
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except Exception:
            body = {}
    
    query_params = event.get("queryStringParameters") or {}
    path_params  = event.get("pathParameters") or {}
    
    headers = {
        "Content-Type":                "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    }
    
    if method == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": ""}
    
    if path == "/upload" and method == "POST":
        result = handle_upload(body, query_params)
    elif path.startswith("/status/") and method == "GET":
        job_id = path_params.get("jobId") or path.split("/status/")[-1]
        result = handle_status(job_id)
    elif path == "/chat" and method == "POST":
        result = handle_chat(body)
    else:
        result = {"statusCode": 404, "body": json.dumps({"error": "Route not found"})}
    
    result["headers"] = headers
    return result
