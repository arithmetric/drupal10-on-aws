// Adapted from AWS CDK Examples for RDS Aurora using TypeScript
// https://github.com/aws-samples/aws-cdk-examples/blob/master/typescript/rds/aurora/aurora.ts

import {
  CfnOutput,
  Tags,
  Fn,
  Duration,
  RemovalPolicy,
  Stack,
} from 'aws-cdk-lib';
import { Dashboard, GraphWidget } from 'aws-cdk-lib/aws-cloudwatch';
import ec2 from 'aws-cdk-lib/aws-ec2';
import { FileSystem } from 'aws-cdk-lib/aws-efs';
import { Key } from 'aws-cdk-lib/aws-kms';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import rds from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';

export class DataStack extends Stack {

  constructor(scope, id, props) {
    super(scope, id, props);

    let instanceType = props.dbInstanceType;
    let replicaInstances = props.dbReplicaInstances ?? 1;
    let backupRetentionDays = props.dbBackupRetentionDays ?? 14;

    var ingressSources = [];
    if (typeof props.dbIngressSources !== 'undefined') {
      ingressSources = props.dbIngressSources;
    }

    const dbs = ['mysql', 'postgresql'];
    if (!dbs.includes(props.dbEngine)) {
      throw new Error('Unknown Engine Please Use mysql or postgresql');
      process.exit(1);
    }
    if (backupRetentionDays < 14) {
      backupRetentionDays = 14;
    }
    if (replicaInstances < 1) {
      replicaInstances = 1;
    }

    const azs = Fn.getAzs();

    // vpc
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'ExistingVPC', {
      vpcId: props.baseStack.vpc.vpcId,
      availabilityZones: azs,
    });

    // Subnets
    const subnets = [];
    const privateSubnets = props.baseStack.vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE});
    for (let subnetId of privateSubnets.subnetIds) {
      const subid = subnetId
        .replace('-', '')
        .replace('_', '')
        .replace(' ', '');
      subnets.push(
        ec2.Subnet.fromSubnetAttributes(this, subid, {
          subnetId: subid,
        }),
      );
    }

    // interface
    const vpcSubnets = {
      subnets: subnets,
    };

    // all the ports
    const allAll = ec2.Port.allTraffic();
    const tcp3306 = ec2.Port.tcpRange(3306, 3306);
    const tcp5432 = ec2.Port.tcpRange(5432, 5432);
    const tcp1433 = ec2.Port.tcpRange(1433, 1433);

    let connectionPort;
    let connectionName;

    // Database Security Group
    const dbsg = new ec2.SecurityGroup(this, `${props.namePrefix}Data-SecurityGroupDB`, {
      vpc: vpc,
      allowAllOutbound: true,
      description: id + 'Database',
      securityGroupName: id + 'Database',
    });
    dbsg.addIngressRule(dbsg, allAll, 'all from self');
    dbsg.addEgressRule(ec2.Peer.ipv4('0.0.0.0/0'), allAll, 'all out');

    if (props.dbEngine == 'mysql') {
      connectionPort = tcp3306;
      connectionName = 'tcp3306 MySQL';
    } else {
      connectionPort = tcp5432;
      connectionName = 'tcp5432 PostgresSQL';
    }

    for (let ingress_source of ingressSources) {
      dbsg.addIngressRule(ingress_source, connectionPort, connectionName);
      if (props.dbEngine == 'postgresql') {
        dbsg.addIngressRule(ingress_source, tcp1433, 'tcp1433');
      }
    }

    // Declaring postgres engine
    let auroraEngine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_13_4,
    });

    if (props.dbEngine == 'mysql') {
      auroraEngine = rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_02_2,
      });
    }

    let auroraParameters = {};
    // If PostgreSQL, enable Babelfish
    if (props.dbEnableBabelfish && props.dbEngine == 'postgresql') {
      auroraParameters['rds.babelfish_status'] = 'on';
    }

    // aurora params
    const auroraParameterGroup = new rds.ParameterGroup(
      this,
      `${props.namePrefix}Data-AuroraParameterGroup`,
      {
          engine: auroraEngine,
          description: id + ' Parameter Group',
          parameters: auroraParameters,
      },
    );

    this.ClusterSecret = new Secret(
      this,
      `${props.namePrefix}Data-SecretAuroraCredentials`,
      {
        secretName: `${props.dbName}-AuroraClusterCredentials`,
        description: `Credentials for the ${props.dbName} Aurora database cluster`,
        generateSecretString: {
          excludeCharacters: "\"@/\\ '",
          generateStringKey: 'password',
          passwordLength: 30,
          secretStringTemplate: `{"username": "${props.dbUsername}"}`,
        },
      },
    );

    // aurora credentials
    const auroraClusterCrendentials = rds.Credentials.fromSecret(
      this.ClusterSecret,
      props.dbUsername,
    );

    if (instanceType == null || instanceType == undefined) {
      instanceType = ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MEDIUM,
      );
    }

    // Aurora DB Key
    const kmsKey = new Key(this, `${props.namePrefix}Data-KmsKey`, {
      enableKeyRotation: true,
      alias: props.dbName,
    });

    let cloudwatchLogsExports = ['postgresql'];
    if (props.dbEngine == 'mysql') {
      cloudwatchLogsExports = ['slowquery'];
    }

    const aurora_cluster = new rds.DatabaseCluster(this, `${props.namePrefix}Data-AuroraCluster`, {
      engine: auroraEngine,
      credentials: auroraClusterCrendentials,
      backup: {
        preferredWindow: props.dbBackupWindow,
        retention: Duration.days(backupRetentionDays),
      },
      parameterGroup: auroraParameterGroup,
      instances: replicaInstances,
      iamAuthentication: true,
      storageEncrypted: true,
      storageEncryptionKey: kmsKey,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      copyTagsToSnapshot: true,
      cloudwatchLogsExports: cloudwatchLogsExports,
      cloudwatchLogsRetention: RetentionDays.ONE_MONTH,
      preferredMaintenanceWindow: props.dbPreferredMaintenanceWindow,
      instanceIdentifierBase: props.dbName,
      instanceProps: {
        instanceType: props.dbInstanceType,
        vpcSubnets: vpcSubnets,
        vpc: vpc,
        securityGroups: [dbsg],
      },
    });
    this.Cluster = aurora_cluster;

    aurora_cluster.applyRemovalPolicy(RemovalPolicy.RETAIN);

    Tags.of(aurora_cluster).add('Name', props.dbName, {
      priority: 300,
    });

    aurora_cluster.addRotationSingleUser({
      automaticallyAfter: Duration.days(30),
      excludeCharacters: "\"@/\\ '",
      vpcSubnets: vpcSubnets,
    });

    // Create an EFS filesystem
    this.EfsDrupalFiles = new FileSystem(this, `${props.namePrefix}Data-Efs`, {
      vpc: props.baseStack.vpc,
    });

    /*
    * CloudWatch Dashboard
    */

    const dashboard = new Dashboard(this, `${props.namePrefix}Data-CloudwatchDashboard`, {
      dashboardName: props.dbName,
    });

    let dbConnections = aurora_cluster.metricDatabaseConnections();
    let cpuUtilization = aurora_cluster.metricCPUUtilization();
    let deadlocks = aurora_cluster.metricDeadlocks();
    let freeLocalStorage = aurora_cluster.metricFreeLocalStorage();
    let freeableMemory = aurora_cluster.metricFreeableMemory();
    let networkRecieveThroughput = aurora_cluster.metricNetworkReceiveThroughput();
    let networkThroughput = aurora_cluster.metricNetworkThroughput();
    let networkTransmitThroughput = aurora_cluster.metricNetworkTransmitThroughput();
    let snapshotStorageUsed = aurora_cluster.metricSnapshotStorageUsed();
    let totalBackupStorageBilled = aurora_cluster.metricTotalBackupStorageBilled();
    let volumeBytesUsed = aurora_cluster.metricVolumeBytesUsed();
    let volumeReadIoPs = aurora_cluster.metricVolumeReadIOPs();
    let volumeWriteIoPs = aurora_cluster.metricVolumeWriteIOPs();


    //  The average amount of time taken per disk I/O operation (average over 1 minute)
    const readLatency = aurora_cluster.metric('ReadLatency', {
      statistic: 'Average',
      period: Duration.seconds(60),
    });

    const widgetDbConnections = new GraphWidget({
      title: 'DB Connections',
      // Metrics to display on left Y axis.
      left: [dbConnections],
    });

    const widgetCpuUtilizaton = new GraphWidget({
      title: 'CPU Utilization',
      // Metrics to display on left Y axis
      left: [cpuUtilization],
    });

    const widgetReadLatency = new GraphWidget({
      title: 'Read Latency',
      //  Metrics to display on left Y axis.
      left: [readLatency],
    });

    freeLocalStorage = aurora_cluster.metricFreeLocalStorage();
    freeableMemory = aurora_cluster.metricFreeableMemory();
    networkRecieveThroughput = aurora_cluster.metricNetworkReceiveThroughput();
    networkThroughput = aurora_cluster.metricNetworkThroughput();
    networkTransmitThroughput = aurora_cluster.metricNetworkTransmitThroughput();
    snapshotStorageUsed = aurora_cluster.metricSnapshotStorageUsed();
    totalBackupStorageBilled = aurora_cluster.metricTotalBackupStorageBilled();
    volumeBytesUsed = aurora_cluster.metricVolumeBytesUsed();
    volumeReadIoPs = aurora_cluster.metricVolumeReadIOPs();
    volumeWriteIoPs = aurora_cluster.metricVolumeWriteIOPs();

    const widgetDeadlocks = new GraphWidget({
      title: 'Deadlocks',
      left: [deadlocks],
    });

    const widgetFreeLocalStorage = new GraphWidget({
      title: 'Free Local Storage',
      left: [freeLocalStorage],
    });

    const widgetFreeableMemory = new GraphWidget({
      title: 'Freeable Memory',
      left: [freeableMemory],
    });

    const widget_network_receive_throughput = new GraphWidget({
      title: 'Network Throuput',
      left: [networkRecieveThroughput, networkThroughput, networkTransmitThroughput],
    });

    const widgetTotalBackupStorageBilled = new GraphWidget({
      title: 'Backup Storage Billed',
      left: [totalBackupStorageBilled],
    });

    const widgetVolumeBytes = new GraphWidget({
      title: 'Storage',
      left: [volumeBytesUsed, snapshotStorageUsed],
    });

    const widgetVolumeIops = new GraphWidget({
      title: 'Volume IOPs',
      left: [volumeReadIoPs, volumeWriteIoPs],
    });


    dashboard.addWidgets(
      widgetDbConnections,
      widgetCpuUtilizaton
    );
    dashboard.addWidgets(
      widgetTotalBackupStorageBilled,
      widgetFreeLocalStorage
    );
    dashboard.addWidgets(
      widgetFreeableMemory,
      widgetVolumeBytes,
      widgetVolumeIops,
    );
    dashboard.addWidgets(
      widget_network_receive_throughput,
      widgetReadLatency,
      widgetDeadlocks,
    );

    new CfnOutput(this, 'OutputSecretName', {
      exportName: aurora_cluster.stack.stackName+':SecretName',
      value: aurora_cluster.secret.secretArn,
    });

    new CfnOutput(this, 'OutputSecretArn', {
      exportName: aurora_cluster.stack.stackName+':SecretArn',
      value: aurora_cluster.secret.secretArn,
    });


    new CfnOutput(this, 'OutputGetSecretValue', {
      exportName: aurora_cluster.stack.stackName+':GetSecretValue',
      value: 'aws secretsmanager get-secret-value --secret-id '+ aurora_cluster.secret?.secretArn,
    });


    new CfnOutput(this, 'OutputInstanceIdentifiers', {
      exportName: aurora_cluster.stack.stackName+'InstanceIdentifiers',
      value: aurora_cluster.instanceIdentifiers.toString(),
    });

    const instance_endpoints = [];

    for (let ie of aurora_cluster.instanceEndpoints) {
      instance_endpoints.push(ie.hostname);
    }
    new CfnOutput(this, 'OutputEndpoints', {
      exportName: aurora_cluster.stack.stackName+':Endpoints',
      value: instance_endpoints.toString(),
    });

    new CfnOutput(this, 'OutputClusterEndpoint', {
      exportName: aurora_cluster.stack.stackName+':Endpoint',
      value: aurora_cluster.clusterEndpoint.socketAddress,
    });


    // Outputs Cluster Engine
    new CfnOutput(this, 'OutputEngineFamily', {
      exportName: aurora_cluster.stack.stackName+':EngineFamily',
      value: aurora_cluster.engine.engineFamily,
    });

    new CfnOutput(this, 'OutputEngineType', {
      exportName: aurora_cluster.stack.stackName+':EngineType',
      value: aurora_cluster.engine.engineType,
    });

    new CfnOutput(this, 'OutputEngineFullVersion', {
      exportName: aurora_cluster.stack.stackName+':EngineFullVersion',
      value: aurora_cluster.engine?.engineVersion.fullVersion,
    });

    new CfnOutput(this, 'OutputEngineMajorVersion', {
      exportName: aurora_cluster.stack.stackName+':EngineMajorVersion',
      value: aurora_cluster.engine?.engineVersion.majorVersion,
    });

    new CfnOutput(this, 'OutputParameterGroupFamily', {
      exportName: aurora_cluster.stack.stackName+':ParameterGroupFamily',
      value: aurora_cluster.engine.parameterGroupFamily,
    });

  }
}
