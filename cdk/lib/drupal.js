const { Stack, Duration } = require('aws-cdk-lib');
const { SubnetType, Vpc } = require("aws-cdk-lib/aws-ec2");
const { Cluster, ContainerImage } = require("aws-cdk-lib/aws-ecs");
const { ApplicationLoadBalancedFargateService } = require("aws-cdk-lib/aws-ecs-patterns");
const { FileSystem } = require("aws-cdk-lib/aws-efs");
const { ManagedPolicy, Policy, PolicyStatement } = require("aws-cdk-lib/aws-iam");

const { Aurora } = require("./rds-aurora");

class DrupalStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const vpc = new Vpc(this, "Drupal10-VPC", {
      maxAzs: 3 // Default is all AZs in region
    });

    const privateSubnets = vpc.selectSubnets({subnetType: SubnetType.PRIVATE});

    const cluster = new Cluster(this, "Drupal10-ECS-Cluster", {
      vpc: vpc
    });

    // Create an EFS filesystem
    const efs = new FileSystem(this, "Drupal10-EFS-Drupal-Files", {
      vpc: vpc,
    });

    // Create a load-balanced Fargate service and make it public
    const fargate = new ApplicationLoadBalancedFargateService(this, "Drupal10-ECS-FargateALB", {
      cluster: cluster, // Required
      cpu: 512, // Default is 256
      desiredCount: 1, // Default is 1
      taskImageOptions: { image: ContainerImage.fromRegistry("748890162047.dkr.ecr.us-east-2.amazonaws.com/drupal10-test") },
      memoryLimitMiB: 2048, // Default is 512
      publicLoadBalancer: true, // Default is true
      healthCheckGracePeriod: Duration.minutes(10), // Default is 60 seconds
    });
    fargate.taskDefinition.executionRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser'));
    fargate.taskDefinition.addVolume({
      name: "drupalfiles",
      efsVolumeConfiguration: {
        fileSystemId: efs.fileSystemId,
      },
    });
    fargate.taskDefinition.defaultContainer.addMountPoints({
      sourceVolume: "drupalfiles",
      containerPath: "/mnt/efs",
      readOnly: false,
    });

    efs.connections.allowDefaultPortFrom(fargate.service.connections);

    // Create an RDS Aurora instance
    const rds = new Aurora(this, 'Drupal10-RDS-Aurora', {
      vpcId: vpc.vpcId,
      subnetIds: privateSubnets.subnetIds,
      instanceType: "t3.medium",
      dbName: "drupal10",
      engine: "mysql",
      auroraClusterUsername: "drupal",
      ingressSources: fargate.service.connections.securityGroups
    });

    // Allow Fargate to get the RDS Aurora credentials secret value
    fargate.taskDefinition.taskRole.attachInlinePolicy(new Policy(this, 'AuroraCredentials-GetSecretValue', {
      statements: [
        new PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [rds.ClusterSecret.secretArn],
        })
      ],
    }));

    // Provide the RDS Aurora credentials secret name to the Fargate containers
    fargate.taskDefinition.defaultContainer.addEnvironment(
      'DB_CREDS_SECRET_ID',
      rds.ClusterSecret.secretName,
    );

  }
}

module.exports = { DrupalStack };
