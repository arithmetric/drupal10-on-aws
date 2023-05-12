import { CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import { Cluster, ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { ManagedPolicy, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export class WebStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const cluster = new Cluster(this, `${props.namePrefix}Web-EcsCluster`, {
      vpc: props.baseStack.vpc,
    });

    // Create a load-balanced Fargate service and make it public
    const fargate = new ApplicationLoadBalancedFargateService(this, `${props.namePrefix}Web-EcsFargateAlb`, {
      cluster: cluster, // Required
      cpu: props.fargateCpu, // Default is 256
      desiredCount: props.fargateInstances, // Default is 1
      taskImageOptions: { image: ContainerImage.fromEcrRepository(props.baseStack.repository, props.ecrRepositoryTag) },
      memoryLimitMiB: props.fargateMemoryLimit, // Default is 512
      publicLoadBalancer: true, // Default is true
      healthCheckGracePeriod: Duration.minutes(3), // Default is 60 seconds
    });
    fargate.taskDefinition.executionRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser'));
    fargate.taskDefinition.addVolume({
      name: "drupalfiles",
      efsVolumeConfiguration: {
        fileSystemId: props.dataStack.EfsDrupalFiles.fileSystemId,
      },
    });
    fargate.taskDefinition.defaultContainer.addMountPoints({
      sourceVolume: "drupalfiles",
      containerPath: "/mnt/efs",
      readOnly: false,
    });

    fargate.targetGroup.configureHealthCheck({
      healthyHttpCodes: '200-399'
    });

    fargate.service.connections.allowToDefaultPort(props.dataStack.Cluster, 'RDS Instance');
    fargate.service.connections.allowToDefaultPort(props.dataStack.EfsDrupalFiles, 'EFS Filesystem');

    // Allow Fargate to get the RDS Aurora credentials secret value
    fargate.taskDefinition.taskRole.attachInlinePolicy(new Policy(this, `${props.namePrefix}Web-PolicyGetAuroraCredentials`, {
      statements: [
        new PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [props.dataStack.ClusterSecret.secretArn],
        })
      ],
    }));

    // Provide the RDS Aurora credentials secret name to the Fargate containers
    fargate.taskDefinition.defaultContainer.addEnvironment(
      'DB_CREDS_SECRET_ID',
      props.dataStack.ClusterSecret.secretName,
    );

    if (props.emailStack) {
      // Allow Fargate to get the SES credentials secret value
      fargate.taskDefinition.taskRole.attachInlinePolicy(new Policy(this, `${props.namePrefix}Web-PolicyGetSesCredentials`, {
        statements: [
          new PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [props.emailStack.SmtpCredentialsSecret.secretArn],
          })
        ],
      }));

      // Provide the SES credentials secret name to the Fargate containers
      fargate.taskDefinition.defaultContainer.addEnvironment(
        'SES_CREDS_SECRET_ID',
        props.emailStack.SmtpCredentialsSecret.secretName,
      );
    }

    // Provide the Drush default base URL
    fargate.taskDefinition.defaultContainer.addEnvironment(
      'DRUSH_OPTIONS_URI',
      `http://${fargate.loadBalancer.loadBalancerDnsName}`,
    );

    // Add outputs to support maintenance operations
    new CfnOutput(this, 'OutputWebUrl', {
      exportName: 'OutputWebUrl',
      value: `http://${fargate.loadBalancer.loadBalancerDnsName}`,
    });
    new CfnOutput(this, 'OutputEcsClusterArn', {
      exportName: 'OutputEcsClusterArn',
      value: fargate.cluster.clusterArn,
    });
    new CfnOutput(this, 'OutputEcsServiceArn', {
      exportName: 'OutputEcsServiceArn',
      value: fargate.service.serviceArn,
    });
    new CfnOutput(this, 'OutputEcsTaskLogGroup', {
      exportName: 'OutputEcsTaskLogGroup',
      value: fargate.taskDefinition.defaultContainer.logDriverConfig.options['awslogs-group'],
    });
  }
}
