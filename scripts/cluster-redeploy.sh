#!/bin/bash

OUTPUTS_FILE="$(dirname $0)/../cdk/outputs.json"
if [ ! -f $OUTPUTS_FILE ]; then
  echo "CDK outputs file does not exist. Run 'cdk deploy' to generate it."
  exit 1
fi

NAME_PREFIX=$(jq -r .namePrefix $(dirname $0)/../stack.config.json)

CLUSTER_ARN=$(jq -r '."'$NAME_PREFIX'Web".OutputEcsClusterArn' $OUTPUTS_FILE)
SERVICE_ARN=$(jq -r '."'$NAME_PREFIX'Web".OutputEcsServiceArn' $OUTPUTS_FILE)

echo "Redeploying ECS Service:"
echo ""
echo "  Cluster: $CLUSTER_ARN"
echo "  Service: $SERVICE_ARN"
echo ""

aws ecs update-service \
  --cluster $CLUSTER_ARN \
  --service $SERVICE_ARN \
  --force-new-deployment \
  > /dev/null

echo "Deployment initiated. Waiting for completion... press CTRL+C to stop waiting."

aws ecs wait services-stable \
  --services $SERVICE_ARN \
  --cluster $CLUSTER_ARN

echo "Deployment complete."
