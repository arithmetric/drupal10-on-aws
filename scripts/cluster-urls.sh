#!/bin/bash

OUTPUTS_FILE="$(dirname $0)/../cdk/outputs.json"
if [ ! -f $OUTPUTS_FILE ]; then
  echo "CDK outputs file does not exist. Run 'cdk deploy' to generate it."
  exit 1
fi

NAME_PREFIX=$(jq -r .namePrefix $(dirname $0)/../stack.config.json)

WEB_BASE_URL=$(jq -r '."'$NAME_PREFIX'Web".OutputWebUrl' $OUTPUTS_FILE)

echo "Cluster URLs:"
echo ""
echo "  Homepage: $WEB_BASE_URL"
echo "  Login: $WEB_BASE_URL/user/login"
echo "  Admin: $WEB_BASE_URL/admin"
