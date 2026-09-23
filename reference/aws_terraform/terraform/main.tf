# ============================================================
# AGENTIC AI SOLUTION — AWS INFRASTRUCTURE
# Account: <AWS_ACCOUNT_ID> | Region: us-east-1
# ============================================================

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket = "terraform-state-techniumlabs"
    key    = "agentic-ai/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = "us-east-1"
}

locals {
  account_id  = "<AWS_ACCOUNT_ID>"
  region      = "us-east-1"
  project     = "agentic-ai"
  model_id    = "anthropic.claude-sonnet-4-20250514-v1:0"
  doc_bucket  = "agentic-ai-docs-<AWS_ACCOUNT_ID>"
  fe_bucket   = "agentic-ai-frontend-<AWS_ACCOUNT_ID>"
}

# ── S3: Document Storage ──────────────────────────────────
resource "aws_s3_bucket" "docs" {
  bucket = local.doc_bucket
  tags   = { Project = local.project, Purpose = "document-storage" }
}

resource "aws_s3_bucket_cors_configuration" "docs" {
  bucket = aws_s3_bucket.docs.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_notification" "doc_upload" {
  bucket = aws_s3_bucket.docs.id
  lambda_function {
    lambda_function_arn = aws_lambda_function.upload_trigger.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/"
  }
  depends_on = [aws_lambda_permission.s3_invoke]
}

# ── S3: Frontend Hosting ──────────────────────────────────
resource "aws_s3_bucket" "frontend" {
  bucket = local.fe_bucket
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  index_document { suffix = "index.html" }
  error_document  { key    = "index.html" }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

# ── DynamoDB: Job Tracking ────────────────────────────────
resource "aws_dynamodb_table" "jobs" {
  name           = "doc-processing-jobs"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "jobId"
  attribute { name = "jobId" type = "S" }
  ttl { attribute_name = "ttl" enabled = true }
  tags = { Project = local.project }
}

# ── Secrets Manager: Databricks Token ────────────────────
resource "aws_secretsmanager_secret" "databricks" {
  name        = "/agentic-ai/databricks-token"
  description = "Databricks PAT and workspace URL for Agentic AI"
}

# ── IAM: Lambda Execution Role ────────────────────────────
resource "aws_iam_role" "lambda_exec" {
  name = "agentic-ai-lambda-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "agentic-ai-lambda-policy"
  role = aws_iam_role.lambda_exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
        Resource = ["${aws_s3_bucket.docs.arn}", "${aws_s3_bucket.docs.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query"]
        Resource = aws_dynamodb_table.jobs.arn
      },
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeAgent", "bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.databricks.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "*"
      }
    ]
  })
}

# ── IAM: Bedrock Agent Role ───────────────────────────────
resource "aws_iam_role" "bedrock_agent" {
  name = "agentic-ai-bedrock-agent"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "bedrock_agent_policy" {
  name = "bedrock-agent-policy"
  role = aws_iam_role.bedrock_agent.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:us-east-1::foundation-model/${local.model_id}"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.docs.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = "*"
      }
    ]
  })
}

# ── Lambda: S3 Upload Trigger ─────────────────────────────
resource "aws_lambda_function" "upload_trigger" {
  function_name = "doc-upload-trigger"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"
  timeout       = 30
  filename      = "../lambda/upload_trigger/upload_trigger.zip"
  environment {
    variables = {
      ORCHESTRATOR_FUNCTION = "doc-orchestrator-agent"
      JOBS_TABLE            = "doc-processing-jobs"
      REGION                = local.region
    }
  }
}

resource "aws_lambda_permission" "s3_invoke" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.upload_trigger.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.docs.arn
}

# ── Lambda: Orchestrator Agent ────────────────────────────
resource "aws_lambda_function" "orchestrator" {
  function_name = "doc-orchestrator-agent"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"
  timeout       = 300
  memory_size   = 512
  filename      = "../lambda/orchestrator/orchestrator.zip"
  environment {
    variables = {
      BEDROCK_AGENT_ID      = aws_bedrockagent_agent.docx_agent.agent_id
      BEDROCK_AGENT_ALIAS   = "TSTALIASID"
      DATABRICKS_SECRET_ARN = aws_secretsmanager_secret.databricks.arn
      DATABRICKS_MCP_URL    = "https://<DATABRICKS_WORKSPACE>/serving-endpoints/mcp-server/invocations"
      AWS_MCP_FUNCTION      = aws_lambda_function.aws_mcp_server.function_name
      JOBS_TABLE            = "doc-processing-jobs"
      DOC_BUCKET            = local.doc_bucket
      REGION                = local.region
    }
  }
}

# ── Lambda: AWS MCP Server ────────────────────────────────
resource "aws_lambda_function" "aws_mcp_server" {
  function_name = "aws-mcp-server"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"
  timeout       = 120
  memory_size   = 512
  filename      = "../lambda/mcp_server/mcp_server.zip"
  environment {
    variables = {
      DOC_BUCKET = local.doc_bucket
      JOBS_TABLE = "doc-processing-jobs"
      MODEL_ID   = local.model_id
    }
  }
}

# ── Lambda: Chat API Handler ──────────────────────────────
resource "aws_lambda_function" "chat_api" {
  function_name = "agentic-ai-chat-api"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"
  timeout       = 60
  filename      = "../lambda/chat_api/chat_api.zip"
  environment {
    variables = {
      JOBS_TABLE            = "doc-processing-jobs"
      DOC_BUCKET            = local.doc_bucket
      ORCHESTRATOR_FUNCTION = "doc-orchestrator-agent"
      MODEL_ID              = local.model_id
    }
  }
}

# ── Bedrock Agent: DOCX Summarizer ───────────────────────
resource "aws_bedrockagent_agent" "docx_agent" {
  agent_name              = "docx-summarizer-agent"
  agent_resource_role_arn = aws_iam_role.bedrock_agent.arn
  foundation_model        = local.model_id
  instruction             = <<-EOT
    You are a document summarization specialist. When given a DOCX document:
    1. Extract the full text content using the extract_docx_text tool
    2. Identify key themes, entities, and important information
    3. Generate a structured summary with: Executive Summary, Key Points, 
       Named Entities, Action Items (if any), and Sentiment
    4. Store the result using the store_summary tool
    5. Return the complete structured summary to the user
    Always be thorough, accurate, and maintain the document's original intent.
  EOT
  idle_session_ttl_in_seconds = 600
}

resource "aws_bedrockagent_agent_action_group" "docx_tools" {
  agent_id          = aws_bedrockagent_agent.docx_agent.agent_id
  agent_version     = "DRAFT"
  action_group_name = "DocxProcessingTools"
  action_group_executor {
    lambda = aws_lambda_function.aws_mcp_server.arn
  }
  api_schema {
    payload = file("../bedrock_agent/docx_tools_schema.json")
  }
}

# ── API Gateway: HTTP API ─────────────────────────────────
resource "aws_apigatewayv2_api" "main" {
  name          = "agentic-ai-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_headers = ["Content-Type", "Authorization", "X-Amz-Date"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = ["*"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "chat" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.chat_api.invoke_arn
  integration_method = "POST"
}

resource "aws_apigatewayv2_route" "upload" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /upload"
  target    = "integrations/${aws_apigatewayv2_integration.chat.id}"
}

resource "aws_apigatewayv2_route" "chat" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /chat"
  target    = "integrations/${aws_apigatewayv2_integration.chat.id}"
}

resource "aws_apigatewayv2_route" "status" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /status/{jobId}"
  target    = "integrations/${aws_apigatewayv2_integration.chat.id}"
}

resource "aws_apigatewayv2_stage" "prod" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "prod"
  auto_deploy = true
}

output "api_endpoint" {
  value = aws_apigatewayv2_stage.prod.invoke_url
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.bucket
}

output "docs_bucket" {
  value = aws_s3_bucket.docs.bucket
}
