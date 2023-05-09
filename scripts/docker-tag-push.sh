#!/bin/bash

OUTPUTS_FILE="$(dirname $0)/../cdk/outputs.json"
if [ ! -f $OUTPUTS_FILE ]; then
  echo "CDK outputs file does not exist. Run 'cdk deploy' to generate it."
  exit 1
fi

NAME_PREFIX=$(jq -r .namePrefix $(dirname $0)/../stack.config.json)

DOCKER_URL=$(jq -r '."'$NAME_PREFIX'Base".OutputEcrImageUrl' $OUTPUTS_FILE)
DOCKER_HOST=$(dirname $DOCKER_URL)
DOCKER_IMAGE=$(basename $DOCKER_URL)

(grep -q $DOCKER_HOST ~/.docker/config.json) || $(dirname $0)/docker-login.sh

echo "Pushing Docker Image to ECR"
echo ""
echo "  Local Image: $DOCKER_IMAGE"
echo "  ECR Image: $DOCKER_URL"
echo ""

docker tag $DOCKER_IMAGE $DOCKER_URL

docker push $DOCKER_URL
