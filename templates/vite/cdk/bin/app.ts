#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { {{APP_NAME_PASCAL}}Stack } from "../lib/{{APP_NAME}}-stack";

const app = new cdk.App();

new {{APP_NAME_PASCAL}}Stack(app, "{{APP_NAME_PASCAL}}Stack", {
  env: { account: "{{AWS_ACCOUNT_ID}}", region: "us-east-1" },
  // BEGIN_DOMAIN
  domainName: "{{DOMAIN}}",
  // END_DOMAIN
  githubOwner: "{{GITHUB_OWNER}}",
  githubRepo: "{{APP_NAME}}",
  githubBranch: "{{GITHUB_BRANCH}}",
});
