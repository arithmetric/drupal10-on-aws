import { CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Cluster, ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { ManagedPolicy, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';

import { CertStack } from './cert.js';

export class WebStack extends Stack {
  /**
   * WebStack creates the Fargate/ALB service, sets up its connections with
   * the Aurora database and EFS filesystem, and creates a CloudFront
   * distribution.
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps} props
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

    const domains = [];
    if (props.dnsDomainHost) {
      domains.push(`${props.dnsDomainHost}.${props.dnsDomain}`);
    }
    if (props.dnsDomainEnableRoot) {
      domains.push(props.dnsDomain);
    }

    const cert = new CertStack(this, `${props.namePrefix}Cert`, {
      ...props,
      // ACM Certificate must be created in us-east-1
      crossRegionReferences: true,
      env: {
        region: 'us-east-1'
      }
    });

    const cfSourceConfig = {
      behaviors: [{
        allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
        cachedMethods: cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
        compress: true,
        defaultTtl: Duration.days(30),
        forwardedValues: {
          queryString: true,
          cookies: {
            forward: 'all',
          },
        },
        isDefaultBehavior: true,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      }],
      connectionTimeout: Duration.seconds(3),
      customOriginSource: {
        domainName: fargate.loadBalancer.loadBalancerDnsName,
        allowedOriginSSLVersions: [cloudfront.OriginSslPolicy.SSL_V3],
        originKeepaliveTimeout: Duration.seconds(30),
        originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        originShieldRegion: props.cfOriginShieldRegion || this.region,
      },
    };
    const cfDistro = new cloudfront.CloudFrontWebDistribution(this, `${props.namePrefix}Web-CloudfrontDistribution`, {
      enableIpV6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      originConfigs: [cfSourceConfig],
      viewerCertificate: cloudfront.ViewerCertificate.fromAcmCertificate(
        cert.domainCert,
        {
          aliases: domains,
          sslMethod: cloudfront.SSLMethod.SNI,
        },
      ),
    });

    if (props.dnsDomainEnableRoot) {
      new ARecord(this, `${props.namePrefix}Web-Route53RecordRoot`, {
        zone: props.baseStack.dnsZone,
        recordName: '',
        target: RecordTarget.fromAlias(new CloudFrontTarget(cfDistro)),
      });
    }

    if (props.dnsDomainHost) {
      new ARecord(this, `${props.namePrefix}Web-Route53RecordHost`, {
        zone: props.baseStack.dnsZone,
        recordName: props.dnsDomainHost,
        target: RecordTarget.fromAlias(new CloudFrontTarget(cfDistro)),
      });
    }

    // Provide the Drush default base URL
    fargate.taskDefinition.defaultContainer.addEnvironment(
      'DRUSH_OPTIONS_URI',
      `https://${props.dnsDomainHost}.${props.dnsDomain}`,
    );

    // Provide load balancer host name for the trusted hosts setting
    fargate.taskDefinition.defaultContainer.addEnvironment(
      'DRUPAL_TRUSTED_HOSTS',
      `^${fargate.loadBalancer.loadBalancerDnsName}$`,
    );

    // Add outputs to support maintenance operations
    new CfnOutput(this, 'OutputWebUrl', {
      exportName: 'OutputWebUrl',
      value: `https://${props.dnsDomainHost}.${props.dnsDomain}`,
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
