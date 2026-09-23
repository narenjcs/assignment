-- DocIntel Unity Catalog table for PDF agent results (PLAN.md §2.5).
-- Idempotent: safe to re-run from scripts/deploy-databricks.sh or docintel_app.uc.ensure_table().
CREATE TABLE IF NOT EXISTS ${catalog}.${schema}.document_results (
  job_id STRING NOT NULL COMMENT 'DocIntel job id (uuid), correlates back to the AWS DynamoDB job',
  file_name STRING COMMENT 'Original uploaded file name',
  source_s3_key STRING COMMENT 'Original S3 object key the file was ingested from, passed in from AWS',
  volume_path STRING COMMENT 'Path of the ingested PDF inside the UC volume',
  page_count INT COMMENT 'Number of pages extracted',
  word_count INT COMMENT 'Total word count of the extracted text',
  char_count INT COMMENT 'Character count of the extracted text',
  extraction_method STRING COMMENT 'pypdf | ai_parse_document (OCR fallback)',
  extracted_text STRING COMMENT 'Full extracted text of the document',
  summary STRING COMMENT 'LLM-generated summary',
  key_points ARRAY<STRING> COMMENT 'LLM-generated key points',
  entities ARRAY<STRUCT<name: STRING, type: STRING>> COMMENT 'LLM-extracted named entities',
  topics ARRAY<STRING> COMMENT 'LLM-generated topics',
  sentiment STRING COMMENT 'LLM-assessed overall sentiment',
  language STRING COMMENT 'Detected document language',
  model STRING COMMENT 'FMAPI endpoint used for enrichment',
  run_mode STRING COMMENT 'sync | async',
  run_id STRING COMMENT 'Databricks job run id for async runs, null for sync',
  processed_at TIMESTAMP COMMENT 'When this row was written'
)
USING DELTA
COMMENT 'DocIntel PDF agent results, one row per processed job_id'
TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true');
