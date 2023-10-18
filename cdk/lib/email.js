import { CfnOutput, Stack } from 'aws-cdk-lib';
import { SesSmtpCredentials } from '@pepperize/cdk-ses-smtp-credentials';
import { User } from 'aws-cdk-lib/aws-iam';

export class EmailStack extends Stack {
  /**
   * EmailStack creates a user, generates SES SMTP email sending credentials,
   * and stores them in Secrets Manager.
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const userSes = new User(this, `${props.namePrefix}Email-User`, {
      userName: `${props.namePrefix}SesEmailSender`,
    });

    const smtpCredentials = new SesSmtpCredentials(this, `${props.namePrefix}Email-SmtpCredentials`, {
      user: userSes,
    });
    this.SmtpCredentialsSecret = smtpCredentials.secret;

    new CfnOutput(this, 'OutputEmailSecretArn', {
      exportName: 'OutputEmailSecretArn',
      value: smtpCredentials.secret.secretArn,
    });
  }
}
