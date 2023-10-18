#!/usr/bin/env node

import cdk from 'aws-cdk-lib';
import fs from 'fs';

import { BaseStack, DataStack, EmailStack, WebStack } from '../lib/index.js';

const app = new cdk.App();

const globalProps = JSON.parse(fs.readFileSync('../stack.config.json'));

// Cross region references are necessary when an application is hosted in a
// region other than us-east-1, where the ACM SSL certificate must be created
// for use with CloudFront.

globalProps.baseStack = new BaseStack(app, `${globalProps.namePrefix}Base`, {
  ...globalProps,
  crossRegionReferences: true,
});

globalProps.dataStack = new DataStack(app, `${globalProps.namePrefix}Data`, globalProps);

if (globalProps.sesEmailEnabled) {
  globalProps.emailStack = new EmailStack(app, `${globalProps.namePrefix}Email`, globalProps);
}

globalProps.webStack = new WebStack(app, `${globalProps.namePrefix}Web`, {
  ...globalProps,
  crossRegionReferences: true,
});
