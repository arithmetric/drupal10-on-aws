#!/bin/bash

aws ecs update-service --cluster Drupal10Stack-20230427a-Drupal10ECSClusterF614914B-4noljv3Bos3m --service Drupal10Stack-20230427a-Drupal10ECSFargateALBService4D864137-KezEAAqWv4GH --force-new-deployment

