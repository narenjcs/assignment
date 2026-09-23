"""
AWS Orchestrator Agent Lambda
Routes DOCX → AWS Bedrock Agent
Routes PDF  → Databricks AI Agent via MCP
Streams results back via DynamoDB
"""
import json
import boto3
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone

lambda_client  = boto3.client("lambda")
bedrock_agent  = boto3.client("bedrock-agent-runtime", region_name=os.environ.get("REGION", "us-east-1"))
secrets_client = boto3.client("secretsmanager")
dynamodb       = boto3.resource("dynamodb")

BEDROCK_AGENT_ID    = os.environ["BEDROCK_AGENT_ID"]
BEDROCK_AGENT_ALIAS = os.environ.get("BEDROCK_AGENT_ALIAS", "TSTALIASID")
DATABRICKS_SECRET   = os.environ["DATABRICKS_SECRET_ARN"]
DATABRICKS_MCP_URL  = os.environ["DATABRICKS_MCP_URL"]
AWS_MCP_FUNCTION    = os.environ["AWS_MCP_FUNCTION"]
JOBS_TABLE          = os.environ["JOBS_TABLE"]
DOC_BUCKET          = os.environ["DOC_BUCKET"]

def update_job(table, job_id, status, result=None, error=None):
    update_expr = "SET #s = :s, updatedAt = :t"
    expr_names  = {"#s": "status"}
    expr_values = {":s": status, ":t": datetime.now(timezone.utc).isoformat()}
    if result:
        update_expr += ", processingResult = :r"
        expr_values[":r"] = result
    if error:
        update_expr += ", errorMessage = :e"
        expr_values[":e"] = error
    table.update_item(
        Key={"jobId": job_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values
    )

def get_databricks_credentials():
    secret = secrets_client.get_secret_value(SecretId=DATABRICKS_SECRET)
    creds  = json.loads(secret["SecretString"])
    return creds["workspace_url"], creds["token"]

def invoke_aws_mcp_tool(tool_name, tool_input):
    """Call AWS MCP Server Lambda with a specific tool"""
    payload = {"tool": tool_name, "input": tool_input}
    response = lambda_client.invoke(
        FunctionName=AWS_MCP_FUNCTION,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload)
    )
    result = json.loads(response["Payload"].read())
    return result

def invoke_databricks_mcp_tool(tool_name, tool_input, workspace_url, token):
    """Call Databricks MCP Server via HTTP"""
    url     = f"{workspace_url}/serving-endpoints/mcp-server/invocations"
    payload = json.dumps({"tool": tool_name, "input": tool_input}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type":  "application/json"
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())

def process_docx_with_bedrock_agent(job_id, s3_bucket, s3_key):
    """Route DOCX to AWS Bedrock Agent for summarization"""
    print(f"[ORCHESTRATOR] Routing DOCX to Bedrock Agent | Job: {job_id}")
    
    session_id = f"session-{job_id}"
    input_text = (
        f"Please summarize the DOCX document stored at s3://{s3_bucket}/{s3_key}. "
        f"Job ID: {job_id}. Extract text, identify key themes, entities, and generate "
        f"a structured summary with executive summary, key points, named entities, "
        f"action items, and sentiment analysis."
    )
    
    # Invoke Bedrock Agent with streaming
    response = bedrock_agent.invoke_agent(
        agentId=BEDROCK_AGENT_ID,
        agentAliasId=BEDROCK_AGENT_ALIAS,
        sessionId=session_id,
        inputText=input_text,
        enableTrace=True
    )
    
    # Collect streamed response
    full_response = ""
    for event in response.get("completion", []):
        if "chunk" in event:
            chunk_data = event["chunk"].get("bytes", b"")
            if isinstance(chunk_data, bytes):
                full_response += chunk_data.decode("utf-8")
            else:
                full_response += str(chunk_data)
    
    return {
        "processor":  "AWS_BEDROCK_AGENT",
        "agentId":    BEDROCK_AGENT_ID,
        "sessionId":  session_id,
        "summary":    full_response,
        "docType":    "DOCX",
        "s3Key":      s3_key
    }

def process_pdf_with_databricks(job_id, s3_bucket, s3_key):
    """Route PDF to Databricks AI Agent via MCP"""
    print(f"[ORCHESTRATOR] Routing PDF to Databricks Agent | Job: {job_id}")
    
    workspace_url, token = get_databricks_credentials()
    
    # Step 1: Copy PDF from S3 to Databricks Volume via MCP tool
    copy_result = invoke_databricks_mcp_tool(
        "copy_s3_to_volume",
        {
            "s3_bucket":       s3_bucket,
            "s3_key":          s3_key,
            "job_id":          job_id,
            "databricks_path": f"/Volumes/main/agentic_ai/pdf_docs/{job_id}.pdf"
        },
        workspace_url, token
    )
    print(f"[ORCHESTRATOR] PDF copied to Databricks Volume: {copy_result}")
    
    # Step 2: Invoke Databricks AI Agent for OCR + summarization
    agent_result = invoke_databricks_mcp_tool(
        "process_pdf_with_agent",
        {
            "job_id":          job_id,
            "pdf_path":        f"/Volumes/main/agentic_ai/pdf_docs/{job_id}.pdf",
            "original_s3_key": s3_key,
            "output_table":    "main.agentic_ai.document_summaries"
        },
        workspace_url, token
    )
    print(f"[ORCHESTRATOR] Databricks Agent result: {agent_result}")
    
    return {
        "processor":    "DATABRICKS_AI_AGENT",
        "workspaceUrl": workspace_url,
        "summary":      agent_result.get("summary", ""),
        "tableRow":     agent_result.get("table_row", {}),
        "docType":      "PDF",
        "s3Key":        s3_key
    }

def lambda_handler(event, context):
    table  = dynamodb.Table(JOBS_TABLE)
    job_id = event["jobId"]
    
    print(f"[ORCHESTRATOR] Processing job {job_id} | Type: {event['docType']}")
    update_job(table, job_id, "PROCESSING")
    
    try:
        if event["docType"] == "DOCX":
            result = process_docx_with_bedrock_agent(
                job_id, event["s3Bucket"], event["s3Key"]
            )
        elif event["docType"] == "PDF":
            result = process_pdf_with_databricks(
                job_id, event["s3Bucket"], event["s3Key"]
            )
        else:
            raise ValueError(f"Unknown docType: {event['docType']}")
        
        update_job(table, job_id, "COMPLETED", result=json.dumps(result))
        print(f"[ORCHESTRATOR] Job {job_id} COMPLETED")
        return {"statusCode": 200, "jobId": job_id, "result": result}
    
    except Exception as e:
        error_msg = str(e)
        print(f"[ORCHESTRATOR] Job {job_id} FAILED: {error_msg}")
        update_job(table, job_id, "FAILED", error=error_msg)
        raise
