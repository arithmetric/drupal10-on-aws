# Drupal 10 on AWS

This codebase demonstrates running Drupal 10 using a best practices stack
hosted on Amazon Web Services (AWS). This stack uses:

- Fargate as an auto-scaling hosting platform for the Drupal PHP application

- Aurora as a fully-managed, high-performance SQL database

- CloudFront as a secure, caching CDN layer

- AWS CDK as an infrastructure-as-code framework

## Quickstart

With this repository, you can set up Drupal hosted on AWS by performing the
following steps:

1. Set up an AWS account and credentials so you can use the `aws` CLI tool as
an administrator.

2. If desired, adjust the options in `stack.config.json`.

3. Ensure your system has the following dependencies installed: AWS CLI,
CDK CLI, Docker, jq, and Node.js.

4. Run the CDK bootstrap with: `cdk bootstrap` (all CDK commands should be run
in `cdk/`).

5. Deploy the base stack with: `cdk deploy Base`.

6. Build the Docker image with the Drupal codebase using the included scripts.
If desired, first customize the Drupal codebase in `docroot/`. Then run
`./scripts/docker-login.sh`, `./scripts/docker-build.sh`, and
`./scripts/docker-tag-push.sh`.

7. Set up DNS. Find the Route 53 zone's name servers from the Base stack output
or the AWS console. Then either (1) add a NS record to the parent domain, or
(2) set the name servers in the domain's registrar.

8. Deploy the rest of the stack with: `cdk deploy --all`.

9. Run the Drupal installer via the web (by visiting the domain with a web
browser) or Drush (by running `./scripts/cluster-run-drush.sh si` and
`./scripts/cluster-run-drush.sh cr`).

## Architecture

This codebase aims to demonstrate a hosting environment for Drupal 10 that
aligns with the pillars of the AWS Well Architected Framework: performance,
reliability, operational excellence, security, cost optimization, and
sustainability.

**Performance**

Web requests to Drupal are directed first through the CloudFront CDN, which
can respond with cached data if the same request was made recently. This reduces
the number of requests to which Drupal needs to respond, conserving its compute
resources to handle other requests. This is especially helpful for frequently
requested resources, such as CSS or JavaScript files.

The web and database resources can be scaled horizontally and vertically.
Horizontal scaling (increasing the number of instances) of the web servers is
handled automatically with Fargate's support for autoscaling. Vertical scaling
of the web servers and database is handled by updating the stack configuration
file, where instance types and memory/CPU settings can be changed.

**Reliability**

In order to reduce risk and eliminate single points of failure, all parts of
the stack are either operated with redundancy by AWS (such as CloudFront and S3)
or can be configured to run with multiple instances (such as Fargate and RDS).
Additionally the Drupal application is packaged as a Docker image that can be
deployed and shutdown reliably and run in parallel with other instances.

**Operational Excellence**

This repository provides an approach to hosting Drupal that aligns with the
principles of operational excellence in the following ways:

- Defines the cloud infrastructure in code with CDK, which allows the stack to
be deployed reliably without relying on significant manual configuration.

- Includes the Drupal application and cloud infrastructure code in a single
repository so that changes to both are tracked together to avoid cases where
the application is deployed to infrastructure that is outdated.

- Packages the Drupal application as a Docker image so that when web servers
are spun up due to scaling or fault recovery, the correct version of the
application is deployed.

- Includes scripts to automate the application's build, deploy, and maintenance
operations, so that operators can perform critical tasks, like running database
updates and clearing caches, in the cloud from local environments.

- Exposes web server and application logs in CloudWatch to ensure access to
important debugging and analytics data.

**Security**

This approach follows the principle of least privilege, and secures the hosting
platform in the following ways: All traffic to Drupal flows through CloudFront,
which reduces the potential of a denial of service condition due to public,
untrusted traffic. Other components, including the web servers and database,
do not accept connections from the public internet. Additionally, all sensitive
values (like the database password) are stored in AWS Secrets Manager (and are
not stored in code or configuration files).

**Cost Optimization**

The platform is cost optimized in a few ways: Most of the cloud services used
have pricing model based on usage by users versus amount of time a server is
running. This includes CloudFront, the Fargate/ECS web servers, and the EFS
filesystem. By using Fargate/ECS in an auto-scaling manner, we can avoid
overprovisioning resources (in numbers or size) that will be underutilized.
By using CloudFront as a caching layer, a significant portion of traffic will
receive a cached response, thereby avoiding usage of several parts of the stack.

**Sustainability**

By choosing more efficient cloud services and avoiding overprovisioning of
resources, we improve the sustainability of the hosting platform.

## Cloud Infrastructure

In this architecture, the Apache/PHP webserver runs using Fargate. This means
the Drupal codebase and Apache/PHP webserver are bundled as a Docker image, and
run with ECS (Elastic Container Service). ECS is configured to run a minimum
number of instances (at least 1) and can autoscale to a maximum number based on
usage levels. AWS's Application Load Balancer is used to receive and distribute
traffic to the running containers.

Drupal requires a SQL database server. With AWS RDS, we could use MySQL,
MariaDB, or PostgreSQL. In this architecture, Amazon Aurora with MySQL
compatibility is used in order to benefit from greater performance and
scalability.

Drupal also requires file storage for assets uploaded by users or generated by
Drupal itself. Since this platform may involve multiple web servers, a shared
file system is needed. For this purpose, the architecture uses Amazon EFS
(Elastic File Storage), which provides a file system that can be mounted by and
shared by the web server containers running at any given time.

In order to protect against traffic surges and malicious activity, this
architecture routes all public traffic through Amazon CloudFront and AWS WAF
(Web Application Firewall). CloudFront is a CDN, accepting traffic to nodes
located around the world, routing traffic to the load balancer, and caching
responses if apporpriate. In addition WAF is used to block suspicious traffic
to prevent malicious activity from access to the Drupal application.

## Application Deployment

To deploy the Drupal application to Fargate, we create a Docker image with the
Drupal codebase, its dependencies (Apache, PHP, and other libraries and tools),
alterations to the PHP configuration, and the `docker-php-entrypoint` script
that is run when the image starts.

This startup script configures Drupal for the AWS environment. It writes
configuration to the `sites/default/settings.php` file, including the database
host, username, and password. By setting this configuration at runtime, we
avoid storing sensitive data in the Docker image and we ensure that the same
Docker image works even if passwords are rotated or hostnames change.

The script also sets up the mounted EFS filesystem to be used for Drupal's
`sites/default/files` directory. Since the root filesystem in Fargate containers
is ephemeral, EFS provides a permanent solution for file storage. Additionally,
since Fargate may run multiple instances at the same time, it is important that
all instances can access the same files directory content.
