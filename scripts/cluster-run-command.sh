#!/bin/bash

OUTPUTS_FILE="$(dirname $0)/../cdk/outputs.json"
if [ ! -f $OUTPUTS_FILE ]; then
  echo "CDK outputs file does not exist. Run 'cdk deploy' to generate it."
  exit 1
fi

NAME_PREFIX=$(jq -r .namePrefix $(dirname $0)/../stack.config.json)

CLUSTER_ARN=$(jq -r '."'$NAME_PREFIX'Web".OutputEcsClusterArn' $OUTPUTS_FILE)
SERVICE_ARN=$(jq -r '."'$NAME_PREFIX'Web".OutputEcsServiceArn' $OUTPUTS_FILE)
LOG_GROUP=$(jq -r '."'$NAME_PREFIX'Web".OutputEcsTaskLogGroup' $OUTPUTS_FILE)

CMD_PARTS=""
for arg in "$@"
do
    [ -z "$CMD_PARTS" ] || CMD_PARTS="$CMD_PARTS,"
    CMD_PARTS="$CMD_PARTS$arg"
done
CMD=$(echo $CMD_PARTS | sed -e 's/,/ /g')

echo "Running command in AWS ECS"
echo ""
echo "  Command: $CMD"
echo "  Cluster: $CLUSTER_ARN"

aws ecs describe-services \
  --services $SERVICE_ARN \
  --cluster $CLUSTER_ARN \
  > .ecs--describe-services.json

SERVICE_SUBNET_0=$(jq -r .services[0].deployments[0].networkConfiguration.awsvpcConfiguration.subnets[0] .ecs--describe-services.json)
SERVICE_SG_0=$(jq -r .services[0].deployments[0].networkConfiguration.awsvpcConfiguration.securityGroups[0] .ecs--describe-services.json)
SERVICE_TASK_DEF=$(jq -r .services[0].deployments[0].taskDefinition .ecs--describe-services.json)

echo "  Subnet: $SERVICE_SUBNET_0"
echo "  Security Group: $SERVICE_SG_0"
echo "  Task Definition: $SERVICE_TASK_DEF"

aws ecs run-task \
  --cluster $CLUSTER_ARN \
  --count 1 \
  --group ${NAME_PREFIX}Run-Command \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SERVICE_SUBNET_0],securityGroups=[$SERVICE_SG_0],assignPublicIp=DISABLED}" \
  --overrides "containerOverrides={name=web,command=[$CMD_PARTS]}" \
  --task-definition $SERVICE_TASK_DEF \
  > .ecs--run-task.json

TASK_ARN=$(jq -r .tasks[0].taskArn .ecs--run-task.json)

echo ""
echo "Started task: $TASK_ARN"
echo "Waiting for task to finish..."

aws ecs wait tasks-stopped --tasks $TASK_ARN --cluster $CLUSTER_ARN

echo "Task finished. Retrieving logs..."

TASK_ID=$(jq -r .tasks[0].taskArn .ecs--run-task.json | sed -E 's/^.*\///')

aws logs tail $LOG_GROUP --since 15m --log-stream-names "${NAME_PREFIX}Web-EcsFargateAlb/web/$TASK_ID"

rm .ecs--describe-services.json .ecs--run-task.json

echo "Done!"
