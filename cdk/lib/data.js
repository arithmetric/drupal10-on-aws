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
        secretName: `${props.namePrefix}Data-SecretAuroraCredentials`,
        description: `Credentials for the ${props.namePrefix}Data Aurora database cluster`,
        generateSecretString: {
          excludeCharacters: "\"@/\\ '",
          generateStringKey: 'password',
          passwordLength: 30,
          secretStringTemplate: `{"username": "${props.dbUsername}", "dbName": "${props.dbName}"}`,
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
    });

    let cloudwatchLogsExports = ['postgresql'];
    if (props.dbEngine == 'mysql') {
      cloudwatchLogsExports = ['slowquery'];
    }

    this.Cluster = new rds.DatabaseCluster(this, `${props.namePrefix}Data-AuroraCluster`, {
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
      instanceIdentifierBase: `${props.namePrefix}Data-AuroraCluster`,
      instanceProps: {
        instanceType: props.dbInstanceType,
        vpcSubnets: vpcSubnets,
        vpc: vpc,
        securityGroups: [dbsg],
      },
    });

    Tags.of(this.Cluster).add('Name', `${props.namePrefix}Data-AuroraCluster`, {
      priority: 300,
    });

    this.Cluster.addRotationSingleUser({
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
      dashboardName: `${props.namePrefix}Data-AuroraCluster`,
    });

    let dbConnections = this.Cluster.metricDatabaseConnections();
    let cpuUtilization = this.Cluster.metricCPUUtilization();
    let deadlocks = this.Cluster.metricDeadlocks();
    let freeLocalStorage = this.Cluster.metricFreeLocalStorage();
    let freeableMemory = this.Cluster.metricFreeableMemory();
    let networkRecieveThroughput = this.Cluster.metricNetworkReceiveThroughput();
    let networkThroughput = this.Cluster.metricNetworkThroughput();
    let networkTransmitThroughput = this.Cluster.metricNetworkTransmitThroughput();
    let snapshotStorageUsed = this.Cluster.metricSnapshotStorageUsed();
    let totalBackupStorageBilled = this.Cluster.metricTotalBackupStorageBilled();
    let volumeBytesUsed = this.Cluster.metricVolumeBytesUsed();
    let volumeReadIoPs = this.Cluster.metricVolumeReadIOPs();
    let volumeWriteIoPs = this.Cluster.metricVolumeWriteIOPs();


    //  The average amount of time taken per disk I/O operation (average over 1 minute)
    const readLatency = this.Cluster.metric('ReadLatency', {
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

    freeLocalStorage = this.Cluster.metricFreeLocalStorage();
    freeableMemory = this.Cluster.metricFreeableMemory();
    networkRecieveThroughput = this.Cluster.metricNetworkReceiveThroughput();
    networkThroughput = this.Cluster.metricNetworkThroughput();
    networkTransmitThroughput = this.Cluster.metricNetworkTransmitThroughput();
    snapshotStorageUsed = this.Cluster.metricSnapshotStorageUsed();
    totalBackupStorageBilled = this.Cluster.metricTotalBackupStorageBilled();
    volumeBytesUsed = this.Cluster.metricVolumeBytesUsed();
    volumeReadIoPs = this.Cluster.metricVolumeReadIOPs();
    volumeWriteIoPs = this.Cluster.metricVolumeWriteIOPs();

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
      exportName: this.Cluster.stack.stackName+':SecretName',
      value: this.Cluster.secret.secretArn,
    });

    new CfnOutput(this, 'OutputSecretArn', {
      exportName: this.Cluster.stack.stackName+':SecretArn',
      value: this.Cluster.secret.secretArn,
    });


    new CfnOutput(this, 'OutputGetSecretValue', {
      exportName: this.Cluster.stack.stackName+':GetSecretValue',
      value: 'aws secretsmanager get-secret-value --secret-id '+ this.Cluster.secret?.secretArn,
    });


    new CfnOutput(this, 'OutputInstanceIdentifiers', {
      exportName: this.Cluster.stack.stackName+'InstanceIdentifiers',
      value: this.Cluster.instanceIdentifiers.toString(),
    });

    const instance_endpoints = [];

    for (let ie of this.Cluster.instanceEndpoints) {
      instance_endpoints.push(ie.hostname);
    }
    new CfnOutput(this, 'OutputEndpoints', {
      exportName: this.Cluster.stack.stackName+':Endpoints',
      value: instance_endpoints.toString(),
    });

    new CfnOutput(this, 'OutputClusterEndpoint', {
      exportName: this.Cluster.stack.stackName+':Endpoint',
      value: this.Cluster.clusterEndpoint.socketAddress,
    });


    // Outputs Cluster Engine
    new CfnOutput(this, 'OutputEngineFamily', {
      exportName: this.Cluster.stack.stackName+':EngineFamily',
      value: this.Cluster.engine.engineFamily,
    });

    new CfnOutput(this, 'OutputEngineType', {
      exportName: this.Cluster.stack.stackName+':EngineType',
      value: this.Cluster.engine.engineType,
    });

    new CfnOutput(this, 'OutputEngineFullVersion', {
      exportName: this.Cluster.stack.stackName+':EngineFullVersion',
      value: this.Cluster.engine?.engineVersion.fullVersion,
    });

    new CfnOutput(this, 'OutputEngineMajorVersion', {
      exportName: this.Cluster.stack.stackName+':EngineMajorVersion',
      value: this.Cluster.engine?.engineVersion.majorVersion,
    });

    new CfnOutput(this, 'OutputParameterGroupFamily', {
      exportName: this.Cluster.stack.stackName+':ParameterGroupFamily',
      value: this.Cluster.engine.parameterGroupFamily,
    });

  }
}
