const { Stack, Duration } = require('aws-cdk-lib');
const ec2 = require("aws-cdk-lib/aws-ec2");
const ecs = require("aws-cdk-lib/aws-ecs");
const { ApplicationLoadBalancedFargateService } = require("aws-cdk-lib/aws-ecs-patterns");
const { Aurora } = require("./rds-aurora");
const { ManagedPolicy, Policy, PolicyStatement } = require("aws-cdk-lib/aws-iam");

class Drupal10Stack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    // The code that defines your stack goes here

    const vpc = new ec2.Vpc(this, "Drupal10-VPC", {
      maxAzs: 3 // Default is all AZs in region
    });

    const privateSubnets = vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE});

    const cluster = new ecs.Cluster(this, "Drupal10-ECS-Cluster", {
      vpc: vpc
    });

    // Create a load-balanced Fargate service and make it public
    const fargate = new ApplicationLoadBalancedFargateService(this, "Drupal10-ECS-FargateALB", {
      cluster: cluster, // Required
      cpu: 512, // Default is 256
      desiredCount: 1, // Default is 1
      taskImageOptions: { image: ecs.ContainerImage.fromRegistry("748890162047.dkr.ecr.us-east-2.amazonaws.com/drupal10-test") },
      memoryLimitMiB: 2048, // Default is 512
      publicLoadBalancer: true, // Default is true
      healthCheckGracePeriod: Duration.minutes(10), // Default is 60 seconds
    });
    fargate.taskDefinition.executionRole.addManagedPolicy((ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser')));

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
    
  }
}

module.exports = { Drupal10Stack }
