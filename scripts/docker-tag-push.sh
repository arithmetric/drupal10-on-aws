#!/bin/bash

(grep -q "748890162047.dkr.ecr.us-east-2.amazonaws.com" ~/.docker/config.json) || (aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 748890162047.dkr.ecr.us-east-2.amazonaws.com)

docker tag drupal10-web 748890162047.dkr.ecr.us-east-2.amazonaws.com/drupal10-test

docker push 748890162047.dkr.ecr.us-east-2.amazonaws.com/drupal10-test

