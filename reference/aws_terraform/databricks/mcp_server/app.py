"""
Databricks MCP Server — FastAPI app deployed as Databricks App
Exposes MCP tools for PDF processing, OCR, and Unity Catalog persistence
Deploy: databricks apps deploy --name mcp-server
"""
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from typing import Any
import json
import boto3
import os

# Databricks-specific imports (available in Databricks runtime)
from pyspark.sql import SparkSession
from pyspark.sql.types import StructType, StructField, StringType, TimestampType, LongType
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.jobs import RunNow
import mlflow

app = FastAPI(title="Databricks MCP Server", version="1.0.0")
spark = SparkSession.builder.getOrCreate()
w     = WorkspaceClient()

# ── Request/Response Models ───────────────────────────────
class MCPRequest(BaseModel):
    tool:  str
    input: dict[str, Any]

class MCPResponse(BaseModel):
    success: bool
    result:  dict[str, Any] = {}
    error:   str = ""

# ── Unity Catalog Table Schema ────────────────────────────
SUMMARY_TABLE  = "main.agentic_ai.document_summaries"
SUMMARY_SCHEMA = StructType([
    StructField("job_id",           StringType(),    False),
    StructField("original_s3_key",  StringType(),    True),
    StructField("pdf_path",         StringType(),    True),
    StructField("extracted_text",   StringType(),    True),
    StructField("summary",          StringType(),    True),
    StructField("key_points",       StringType(),    True),
    StructField("named_entities",   StringType(),    True),
    StructField("sentiment",        StringType(),    True),
    StructField("page_count",       LongType(),      True),
    StructField("char_count",       LongType(),      True),
    StructField("model_used",       StringType(),    True),
    StructField("processor",        StringType(),    True),
    StructField("processed_at",     TimestampType(), True),
])

# ── Tool: Copy S3 PDF to Databricks Volume ────────────────
def copy_s3_to_volume(s3_bucket, s3_key, job_id, databricks_path):
    """Download PDF from S3 and write to Databricks Volume"""
    import tempfile
    
    # Use Databricks secret for AWS credentials
    aws_key    = dbutils.secrets.get("agentic-ai", "aws-access-key")
    aws_secret = dbutils.secrets.get("agentic-ai", "aws-secret-key")
    
    s3 = boto3.client("s3",
        aws_access_key_id=aws_key,
        aws_secret_access_key=aws_secret,
        region_name="us-east-1"
    )
    
    # Download from S3
    obj     = s3.get_object(Bucket=s3_bucket, Key=s3_key)
    content = obj["Body"].read()
    
    # Write to Databricks Volume
    with open(databricks_path, "wb") as f:
        f.write(content)
    
    return {
        "success":          True,
        "databricks_path":  databricks_path,
        "bytes_written":    len(content),
        "job_id":           job_id
    }

# ── Tool: Process PDF with Databricks AI Agent ────────────
def process_pdf_with_agent(job_id, pdf_path, original_s3_key, output_table):
    """
    Full PDF pipeline:
    1. OCR/text extraction with PyMuPDF
    2. AI enrichment with Claude via Databricks FM API
    3. Persist to Unity Catalog table
    """
    import fitz  # PyMuPDF — available in Databricks ML runtime
    
    # Step 1: OCR / Text Extraction
    doc        = fitz.open(pdf_path)
    pages_text = []
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        text = page.get_text("text")
        if not text.strip():
            # Fallback: render page as image and use Textract
            text = extract_text_with_textract(page, page_num, job_id)
        pages_text.append(f"[PAGE {page_num + 1}]\n{text}")
    
    full_text  = "\n\n".join(pages_text)
    page_count = len(doc)
    doc.close()
    
    # Step 2: AI Enrichment via Databricks AI Agent (LangGraph)
    agent_result = run_pdf_summarizer_agent(full_text, job_id, original_s3_key)
    
    # Step 3: Persist to Unity Catalog
    from datetime import datetime, timezone
    row = {
        "job_id":          job_id,
        "original_s3_key": original_s3_key,
        "pdf_path":        pdf_path,
        "extracted_text":  full_text[:50000],  # Cap at 50K chars for table
        "summary":         agent_result["summary"],
        "key_points":      json.dumps(agent_result.get("key_points", [])),
        "named_entities":  json.dumps(agent_result.get("named_entities", [])),
        "sentiment":       agent_result.get("sentiment", "neutral"),
        "page_count":      page_count,
        "char_count":      len(full_text),
        "model_used":      "databricks-claude-sonnet",
        "processor":       "DATABRICKS_AI_AGENT",
        "processed_at":    datetime.now(timezone.utc)
    }
    
    df = spark.createDataFrame([row], schema=SUMMARY_SCHEMA)
    df.write.format("delta").mode("append").saveAsTable(output_table)
    
    return {
        "success":   True,
        "summary":   agent_result["summary"],
        "table_row": row,
        "job_id":    job_id
    }

def extract_text_with_textract(page, page_num, job_id):
    """Fallback OCR using AWS Textract for image-based PDF pages"""
    import io
    pix    = page.get_pixmap(dpi=200)
    img_bytes = pix.tobytes("png")
    
    textract = boto3.client("textract", region_name="us-east-1")
    response = textract.detect_document_text(
        Document={"Bytes": img_bytes}
    )
    lines = [b["Text"] for b in response.get("Blocks", []) if b["BlockType"] == "LINE"]
    return "\n".join(lines)

def run_pdf_summarizer_agent(text, job_id, s3_key):
    """
    Databricks AI Agent using LangGraph + Claude via Databricks FM API
    """
    from langchain_community.chat_models import ChatDatabricks
    from langgraph.graph import StateGraph, END
    from typing import TypedDict, Annotated
    import operator
    
    llm = ChatDatabricks(
        endpoint="databricks-claude-sonnet-4",
        max_tokens=4096
    )
    
    # Agent state
    class AgentState(TypedDict):
        text:           str
        job_id:         str
        summary:        str
        key_points:     list
        named_entities: list
        sentiment:      str
        completed:      bool
    
    # Agent nodes
    def summarize_node(state):
        prompt = f"""Analyze this document and provide:
1. EXECUTIVE SUMMARY (2-3 paragraphs)
2. KEY POINTS (bullet list, max 10)
3. NAMED ENTITIES (people, organizations, locations, dates)
4. SENTIMENT (positive/negative/neutral with brief explanation)

Document text:
{state['text'][:15000]}

Respond in JSON format with keys: summary, key_points, named_entities, sentiment"""
        
        response = llm.invoke(prompt)
        try:
            result = json.loads(response.content)
        except Exception:
            result = {
                "summary":        response.content,
                "key_points":     [],
                "named_entities": [],
                "sentiment":      "neutral"
            }
        
        return {
            **state,
            "summary":        result.get("summary", ""),
            "key_points":     result.get("key_points", []),
            "named_entities": result.get("named_entities", []),
            "sentiment":      result.get("sentiment", "neutral"),
            "completed":      True
        }
    
    # Build LangGraph
    workflow = StateGraph(AgentState)
    workflow.add_node("summarize", summarize_node)
    workflow.set_entry_point("summarize")
    workflow.add_edge("summarize", END)
    agent = workflow.compile()
    
    result = agent.invoke({
        "text":           text,
        "job_id":         job_id,
        "summary":        "",
        "key_points":     [],
        "named_entities": [],
        "sentiment":      "",
        "completed":      False
    })
    
    return result

# ── MCP Endpoint ──────────────────────────────────────────
@app.post("/invocations", response_model=MCPResponse)
async def invoke_tool(request: MCPRequest, authorization: str = Header(...)):
    """Main MCP tool dispatch endpoint"""
    print(f"[DATABRICKS-MCP] Tool: {request.tool} | Input keys: {list(request.input.keys())}")
    
    try:
        if request.tool == "copy_s3_to_volume":
            result = copy_s3_to_volume(**request.input)
        elif request.tool == "process_pdf_with_agent":
            result = process_pdf_with_agent(**request.input)
        elif request.tool == "list_available_tools":
            result = {
                "tools": {
                    "copy_s3_to_volume":     "Copy PDF from S3 to Databricks Volume",
                    "process_pdf_with_agent": "Run OCR + AI summarization + persist to Unity Catalog"
                }
            }
        else:
            raise HTTPException(status_code=400, detail=f"Unknown tool: {request.tool}")
        
        return MCPResponse(success=True, result=result)
    
    except Exception as e:
        print(f"[DATABRICKS-MCP] Error: {e}")
        return MCPResponse(success=False, error=str(e))

@app.get("/health")
def health():
    return {"status": "healthy", "service": "databricks-mcp-server"}
