#!/bin/bash
# ============================================================
# AGENTIC AI SOLUTION — FULL DEPLOYMENT SCRIPT
# Account: <AWS_ACCOUNT_ID> | Region: us-east-1
# ============================================================
set -e

ACCOUNT_ID="<AWS_ACCOUNT_ID>"
REGION="us-east-1"
PROJECT="agentic-ai"

echo "🚀 Deploying Agentic AI Solution to AWS Account ${ACCOUNT_ID}..."

# ── Step 1: Package Lambda functions ─────────────────────
echo "📦 Packaging Lambda functions..."

for fn in upload_trigger orchestrator mcp_server chat_api; do
  cd lambda/${fn}
  pip install -r requirements.txt -t ./package/ --quiet
  cp handler.py ./package/
  cd package && zip -r9 ../${fn}.zip . --quiet && cd ..
  rm -rf package
  cd ../..
  echo "  ✅ Packaged: ${fn}"
done

# ── Step 2: Deploy Terraform ──────────────────────────────
echo "🏗️  Deploying Terraform infrastructure..."
cd terraform
terraform init -reconfigure
terraform plan -out=tfplan
terraform apply tfplan
API_URL=$(terraform output -raw api_endpoint)
FRONTEND_BUCKET=$(terraform output -raw frontend_bucket)
BEDROCK_AGENT_ID=$(terraform output -raw bedrock_agent_id 2>/dev/null || echo "")
cd ..

echo "  ✅ API Gateway: ${API_URL}"
echo "  ✅ Frontend Bucket: ${FRONTEND_BUCKET}"

# ── Step 3: Prepare Bedrock Agent ────────────────────────
echo "🤖 Preparing Bedrock Agent..."
if [ -n "$BEDROCK_AGENT_ID" ]; then
  aws bedrock-agent prepare-agent \
    --agent-id "${BEDROCK_AGENT_ID}" \
    --region "${REGION}"
  
  # Create alias
  aws bedrock-agent create-agent-alias \
    --agent-id "${BEDROCK_AGENT_ID}" \
    --agent-alias-name "prod" \
    --region "${REGION}"
  echo "  ✅ Bedrock Agent prepared and alias created"
fi

# ── Step 4: Store Databricks credentials ─────────────────
echo "🔐 Configure Databricks credentials in Secrets Manager:"
echo "   Run: aws secretsmanager put-secret-value \\"
echo "     --secret-id /agentic-ai/databricks-token \\"
echo "     --secret-string '{\"workspace_url\":\"https://YOUR_WORKSPACE.azuredatabricks.net\",\"token\":\"YOUR_PAT\"}'"

# ── Step 5: Build and deploy React frontend ───────────────
echo "⚛️  Building React frontend..."
cd frontend
echo "REACT_APP_API_URL=${API_URL}" > .env.production
npm install --silent
npm run build --silent

echo "📤 Deploying frontend to S3..."
aws s3 sync build/ s3://${FRONTEND_BUCKET}/ \
  --delete \
  --cache-control "max-age=31536000" \
  --exclude "index.html"

aws s3 cp build/index.html s3://${FRONTEND_BUCKET}/index.html \
  --cache-control "no-cache"

cd ..

# ── Step 6: Deploy Databricks MCP Server ─────────────────
echo "🔷 Deploying Databricks MCP Server..."
echo "   Run in Databricks CLI:"
echo "   databricks apps deploy --name mcp-server --source-code-path ./databricks/mcp_server"

# ── Step 7: Run Databricks Unity Catalog setup ───────────
echo "🗄️  Unity Catalog setup:"
echo "   Import and run: databricks/setup/unity_catalog_setup.py"

echo ""
echo "✅ =============================================="
echo "✅  DEPLOYMENT COMPLETE"
echo "✅ =============================================="
echo ""
echo "  Frontend URL : http://${FRONTEND_BUCKET}.s3-website-${REGION}.amazonaws.com"
echo "  API Endpoint : ${API_URL}"
echo "  S3 Doc Bucket: agentic-ai-docs-${ACCOUNT_ID}"
echo ""
echo "  Next steps:"
echo "  1. Add Databricks credentials to Secrets Manager"
echo "  2. Deploy Databricks MCP Server app"
echo "  3. Run Unity Catalog setup notebook"
echo "  4. Test by uploading a PDF or DOCX via the frontend"
