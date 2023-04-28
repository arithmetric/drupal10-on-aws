#!/bin/bash

CLUSTER_ARN="Drupal10Stack-20230427a-Drupal10ECSClusterF614914B-4noljv3Bos3m"

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

aws ecs run-task \
  --cluster $CLUSTER_ARN \
  --count 1 \
  --group Drupal10-Run-Command \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-02ec0d3f13018c00f,subnet-01f9a842edb15cdc1],securityGroups=[sg-0685e1971d3399622],assignPublicIp=DISABLED}" \
  --overrides "containerOverrides={name=web,command=[$CMD_PARTS]}" \
  --task-definition arn:aws:ecs:us-east-2:748890162047:task-definition/Drupal10Stack20230427aDrupal10ECSFargateALBTaskDef8702BE32:2 \
  > .ecs--run-task.json

TASK_ARN=$(jq -r .tasks[0].taskArn .ecs--run-task.json)

echo "  Task: $TASK_ARN"
echo ""
echo "Waiting for task to finish..."

aws ecs wait tasks-stopped --tasks $TASK_ARN --cluster $CLUSTER_ARN

echo "Task finished. Retrieving logs..."

TASK_ID=$(jq -r .tasks[0].taskArn .ecs--run-task.json | sed -E 's/^.*\///')

aws logs tail "Drupal10Stack-20230427a-Drupal10ECSFargateALBTaskDefwebLogGroupFCA98016-InFYFdtHsptW" --since 15m --log-stream-names "Drupal10-ECS-FargateALB/web/$TASK_ID"

rm .ecs--run-task.json

echo "Done!"
