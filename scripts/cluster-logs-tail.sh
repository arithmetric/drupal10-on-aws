#!/bin/bash

aws logs tail "Drupal10Stack-20230427a-Drupal10ECSFargateALBTaskDefwebLogGroupFCA98016-InFYFdtHsptW" --follow --since 5m
