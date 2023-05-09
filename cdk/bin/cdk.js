#!/usr/bin/env node

import cdk from 'aws-cdk-lib';
import fs from 'fs';

import { BaseStack, DataStack, WebStack } from '../lib/index.js';

/* If you don't specify 'env', this stack will be environment-agnostic.
 * Account/Region-dependent features and context lookups will not work,
 * but a single synthesized template can be deployed anywhere. */

/* Uncomment the next line to specialize this stack for the AWS Account
 * and Region that are implied by the current CLI configuration. */
// env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

/* Uncomment the next line if you know exactly what Account and Region you
 * want to deploy the stack to. */
// env: { account: '123456789012', region: 'us-east-1' },

/* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */

const app = new cdk.App();

const globalProps = JSON.parse(fs.readFileSync('../stack.config.json'));

globalProps.baseStack = new BaseStack(app, `${globalProps.namePrefix}Base`, globalProps);

globalProps.dataStack = new DataStack(app, `${globalProps.namePrefix}Data`, globalProps);

globalProps.webStack = new WebStack(app, `${globalProps.namePrefix}Web`, globalProps);
