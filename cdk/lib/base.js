import { Repository } from 'aws-cdk-lib/aws-ecr';
import { CfnOutput, Fn, Stack } from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { HostedZone } from 'aws-cdk-lib/aws-route53';

export class BaseStack extends Stack {
  /**
   * BaseStack sets up the VPC and an ECR repository for the Docker image.
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    this.vpc = new Vpc(this, `${props.namePrefix}Base-VPC`, {
      maxAzs: 3
    });

    this.repository = new Repository(this, `${props.namePrefix}Base-EcrRepository`);

    this.dnsZone = new HostedZone(this, `${props.namePrefix}Base-Route53Zone`, {
      zoneName: props.dnsDomain,
    });

    new CfnOutput(this, 'OutputEcrImageUrl', {
      exportName: 'OutputEcrImageUrl',
      value: this.repository.repositoryUri,
    });

    new CfnOutput(this, 'OutputZoneNameServers', {
      exportName: 'OutputZoneNameServers',
      value: Fn.join('\n', this.dnsZone.hostedZoneNameServers),
    });
  }
}
