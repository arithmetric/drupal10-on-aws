import { Repository } from 'aws-cdk-lib/aws-ecr';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import { Vpc } from 'aws-cdk-lib/aws-ec2';

export class BaseStack extends Stack {

  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    this.vpc = new Vpc(this, `${props.namePrefix}Base-VPC`, {
      maxAzs: 3 // Default is all AZs in region
    });

    this.repository = new Repository(this, `${props.namePrefix}Base-EcrRepository`);

    new CfnOutput(this, 'OutputEcrImageUrl', {
      exportName: 'OutputEcrImageUrl',
      value: this.repository.repositoryUri,
    });
  }
}
