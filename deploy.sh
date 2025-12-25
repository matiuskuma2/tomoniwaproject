#!/bin/bash
set -e

ACCOUNT_ID="8cdf2ccee6b3bb852caed223cc3fe31e"
SCRIPT_NAME="webapp"
API_KEY="f807b9ce0678f67262c1c340e7738a89c7877"
EMAIL="snsrilarc@gmail.com"

# Build the worker
echo "Building worker..."
npm run build 2>&1 | tail -3

# Create worker bundle (using compiled TypeScript)
echo "Creating bundle..."
cd apps/api/src
tar -czf /tmp/worker.tar.gz *.ts **/*.ts

# Upload via Cloudflare API
echo "Uploading to Cloudflare..."
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}" \
  -H "X-Auth-Email: ${EMAIL}" \
  -H "X-Auth-Key: ${API_KEY}" \
  -H "Content-Type: application/javascript" \
  --data-binary "@/tmp/worker.tar.gz"

echo ""
echo "Deploy complete!"
