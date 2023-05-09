#!/bin/bash

OUTPUTS_FILE="$(dirname $0)/../cdk/outputs.json"
if [ ! -f $OUTPUTS_FILE ]; then
  echo "CDK outputs file does not exist. Run 'cdk deploy' to generate it."
  exit 1
fi

NAME_PREFIX=$(jq -r .namePrefix $(dirname $0)/../stack.config.json)

LOG_GROUP=$(jq -r '."'$NAME_PREFIX'Web".OutputEcsTaskLogGroup' $OUTPUTS_FILE)

echo "Tailing CloudWatch Logs:"
echo ""
echo "  Log Group: $LOG_GROUP"
echo "  Press CTRL+C to stop"
echo ""

aws logs tail $LOG_GROUP --follow --since 5m
