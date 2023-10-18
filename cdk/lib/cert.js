import { Stack } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';

export class CertStack extends Stack {
  /**
   * CertStack creates an ACM SSL certificate for the specified host names.
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const domains = [];
    if (props.dnsDomainHost) {
      domains.push(`${props.dnsDomainHost}.${props.dnsDomain}`);
    }
    if (props.dnsDomainEnableRoot) {
      domains.push(props.dnsDomain);
    }
    this.domainCert = new Certificate(this, `${props.namePrefix}Web-AcmCertificate`, {
      domainName: domains[0],
      certificateName: `SSL certificate for  ${domains.join(', ')}`,
      validation: CertificateValidation.fromDns(props.baseStack.dnsZone),
      ...(domains.length > 1 ? {subjectAlternativeNames: [domains[1]]} : null),
    });
  }
}
