#!/bin/bash

OUTPUTS_FILE="$(dirname $0)/../cdk/outputs.json"
if [ ! -f $OUTPUTS_FILE ]; then
  echo "CDK outputs file does not exist. Run 'cdk deploy' to generate it."
  exit 1
fi

NAME_PREFIX=$(jq -r .namePrefix $(dirname $0)/../stack.config.json)

DOCKER_URL=$(jq -r '."'$NAME_PREFIX'Base".OutputEcrImageUrl' $OUTPUTS_FILE)
DOCKER_HOST=$(dirname $DOCKER_URL)

echo "Logging Docker into AWS ECR"
echo ""
echo "  Host: $DOCKER_HOST"
echo ""

aws ecr get-login-password | docker login --username AWS --password-stdin $DOCKER_HOST
