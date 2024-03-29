#!/bin/bash

OUTPUTS_FILE="$(dirname $0)/../cdk/outputs.json"
if [ ! -f $OUTPUTS_FILE ]; then
  echo "CDK outputs file does not exist. Run 'cdk deploy' to generate it."
  exit 1
fi

NAME_PREFIX=$(jq -r .namePrefix $(dirname $0)/../stack.config.json)

DOCKER_URL=$(jq -r '."'$NAME_PREFIX'Base".OutputEcrImageUrl' $OUTPUTS_FILE)
DOCKER_IMAGE=$(basename $DOCKER_URL)

echo "Building Docker Image"
echo ""
echo "  Image: $DOCKER_IMAGE"
echo ""

docker build . -t "$DOCKER_IMAGE"
