# Run this notebook in Databricks to set up Unity Catalog resources
# Databricks Notebook: /Shared/agentic-ai/setup

# ── Create Catalog and Schema ─────────────────────────────
spark.sql("CREATE CATALOG IF NOT EXISTS main")
spark.sql("CREATE SCHEMA IF NOT EXISTS main.agentic_ai COMMENT 'Agentic AI document processing'")

# ── Create External Volume for PDFs ──────────────────────
spark.sql("""
  CREATE VOLUME IF NOT EXISTS main.agentic_ai.pdf_docs
  COMMENT 'PDF documents uploaded from AWS S3 for AI processing'
""")

# ── Create Document Summaries Table ──────────────────────
spark.sql("""
  CREATE TABLE IF NOT EXISTS main.agentic_ai.document_summaries (
    job_id           STRING        NOT NULL COMMENT 'Unique job ID from AWS',
    original_s3_key  STRING        COMMENT 'Original S3 object key',
    pdf_path         STRING        COMMENT 'Path in Databricks Volume',
    extracted_text   STRING        COMMENT 'Full OCR-extracted text (capped 50K chars)',
    summary          STRING        COMMENT 'AI-generated executive summary',
    key_points       STRING        COMMENT 'JSON array of key points',
    named_entities   STRING        COMMENT 'JSON array of named entities',
    sentiment        STRING        COMMENT 'Document sentiment analysis',
    page_count       BIGINT        COMMENT 'Number of pages in PDF',
    char_count       BIGINT        COMMENT 'Total character count',
    model_used       STRING        COMMENT 'LLM model used for summarization',
    processor        STRING        COMMENT 'Processing engine identifier',
    processed_at     TIMESTAMP     COMMENT 'Processing completion timestamp'
  )
  USING DELTA
  PARTITIONED BY (DATE(processed_at))
  TBLPROPERTIES (
    'delta.enableChangeDataFeed' = 'true',
    'delta.autoOptimize.optimizeWrite' = 'true'
  )
  COMMENT 'AI-generated summaries of PDF documents processed by Databricks Agent'
""")

# ── Grant permissions ─────────────────────────────────────
spark.sql("GRANT USE CATALOG ON CATALOG main TO `agentic-ai-service-principal`")
spark.sql("GRANT USE SCHEMA ON SCHEMA main.agentic_ai TO `agentic-ai-service-principal`")
spark.sql("GRANT READ VOLUME ON VOLUME main.agentic_ai.pdf_docs TO `agentic-ai-service-principal`")
spark.sql("GRANT WRITE VOLUME ON VOLUME main.agentic_ai.pdf_docs TO `agentic-ai-service-principal`")
spark.sql("GRANT SELECT, MODIFY ON TABLE main.agentic_ai.document_summaries TO `agentic-ai-service-principal`")

print("Unity Catalog setup complete!")
print(f"Volume path: /Volumes/main/agentic_ai/pdf_docs")
print(f"Table: main.agentic_ai.document_summaries")
