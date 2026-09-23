"""
S3 Upload Trigger Lambda
Fires on s3:ObjectCreated:* for uploads/docx/ and uploads/pdf/
Routes to Orchestrator Agent with job tracking
"""
import json
import boto3
import uuid
import os
from datetime import datetime, timezone

lambda_client = boto3.client("lambda")
dynamodb = boto3.resource("dynamodb")

ORCHESTRATOR_FUNCTION = os.environ["ORCHESTRATOR_FUNCTION"]
JOBS_TABLE = os.environ["JOBS_TABLE"]

def lambda_handler(event, context):
    table = dynamodb.Table(JOBS_TABLE)
    
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key    = record["s3"]["object"]["key"]
        size   = record["s3"]["object"].get("size", 0)
        
        # Determine document type from S3 prefix
        if key.startswith("uploads/docx/") or key.lower().endswith(".docx"):
            doc_type = "DOCX"
            processor = "AWS_BEDROCK"
        elif key.startswith("uploads/pdf/") or key.lower().endswith(".pdf"):
            doc_type = "PDF"
            processor = "DATABRICKS"
        else:
            print(f"Unsupported file type for key: {key}, skipping.")
            continue
        
        job_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()
        
        # Create job record in DynamoDB
        table.put_item(Item={
            "jobId":     job_id,
            "s3Bucket":  bucket,
            "s3Key":     key,
            "docType":   doc_type,
            "processor": processor,
            "status":    "QUEUED",
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "fileSize":  size,
            "ttl":       int(datetime.now(timezone.utc).timestamp()) + 86400 * 7  # 7 days TTL
        })
        
        print(f"[TRIGGER] Job {job_id} created | Type: {doc_type} | Key: {key}")
        
        # Invoke Orchestrator Agent asynchronously
        payload = {
            "jobId":    job_id,
            "s3Bucket": bucket,
            "s3Key":    key,
            "docType":  doc_type,
            "processor": processor
        }
        
        lambda_client.invoke(
            FunctionName=ORCHESTRATOR_FUNCTION,
            InvocationType="Event",  # Async invocation
            Payload=json.dumps(payload)
        )
        
        print(f"[TRIGGER] Orchestrator invoked for job {job_id}")
    
    return {"statusCode": 200, "body": "Trigger processed"}
