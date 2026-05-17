import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
// BEGIN_DOMAIN
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
// END_DOMAIN
import * as iam from "aws-cdk-lib/aws-iam";
// BEGIN_LLM_LAMBDA
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
// END_LLM_LAMBDA
// BEGIN_COGNITO
import * as cognito from "aws-cdk-lib/aws-cognito";
// END_COGNITO
// BEGIN_API
import * as lambda_api from "aws-cdk-lib/aws-lambda";
import { NodejsFunction as NodejsFunctionApi } from "aws-cdk-lib/aws-lambda-nodejs";
import { HttpApi, CorsHttpMethod, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
// END_API
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codestar from "aws-cdk-lib/aws-codestarconnections";

interface {{APP_NAME_PASCAL}}StackProps extends cdk.StackProps {
  // BEGIN_DOMAIN
  domainName: string;
  // END_DOMAIN
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
}

export class {{APP_NAME_PASCAL}}Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: {{APP_NAME_PASCAL}}StackProps) {
    super(scope, id, props);

    const { githubOwner, githubRepo, githubBranch } = props;

    // BEGIN_DOMAIN
    const { domainName } = props;
    const wwwDomain = `www.${domainName}`;

    const hostedZone = route53.HostedZone.fromLookup(this, "Zone", { domainName });

    const cert = new acm.Certificate(this, "Cert", {
      domainName,
      subjectAlternativeNames: [wwwDomain],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
    // END_DOMAIN

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: false,
    });

    // BEGIN_DOMAIN
    const wwwRedirectFn = new cloudfront.Function(this, "WwwRedirect", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var host = req.headers.host && req.headers.host.value;
  if (host === '${wwwDomain}') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://${domainName}' + req.uri } }
    };
  }
  return req;
}
      `),
    });
    // END_DOMAIN

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      // BEGIN_DOMAIN
      domainNames: [domainName, wwwDomain],
      certificate: cert,
      // END_DOMAIN
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        // BEGIN_DOMAIN
        functionAssociations: [
          {
            function: wwwRedirectFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
        // END_DOMAIN
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(1),
        },
      ],
    });

    // BEGIN_DOMAIN
    const cfTarget = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
    new route53.ARecord(this, "ApexA", { zone: hostedZone, recordName: domainName, target: cfTarget });
    new route53.AaaaRecord(this, "ApexAAAA", { zone: hostedZone, recordName: domainName, target: cfTarget });
    new route53.ARecord(this, "WwwA", { zone: hostedZone, recordName: wwwDomain, target: cfTarget });
    new route53.AaaaRecord(this, "WwwAAAA", { zone: hostedZone, recordName: wwwDomain, target: cfTarget });
    // END_DOMAIN

    // Allowed origins for any CORS-aware backend (LLM Lambda, HTTP API).
    // BEGIN_DOMAIN
    const allowedOrigins = [`https://${domainName}`, `https://${wwwDomain}`, "http://localhost:5173"];
    // END_DOMAIN
    // BEGIN_NO_DOMAIN
    const allowedOrigins = [`https://${distribution.distributionDomainName}`, "http://localhost:5173"];
    // END_NO_DOMAIN

    const connection = new codestar.CfnConnection(this, "GitHubConnection", {
      connectionName: "{{APP_NAME}}-github",
      providerType: "GitHub",
    });

    // BEGIN_COGNITO
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "{{APP_NAME}}-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool,
      authFlows: {
        userSrp: true,
        userPassword: false,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      generateSecret: false,
    });
    // END_COGNITO

    // BEGIN_LLM_LAMBDA
    const bedrockModelId = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
    const llmFn = new NodejsFunction(this, "LlmFn", {
      entry: path.join(__dirname, "..", "lambda", "llm", "index.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: { MODEL_ID: bedrockModelId },
      bundling: { minify: true, sourceMap: false, target: "node22", externalModules: [] },
    });

    llmFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${bedrockModelId}`,
          `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      }),
    );

    const llmUrl = llmFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins,
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ["content-type"],
        maxAge: cdk.Duration.days(1),
      },
    });
    // END_LLM_LAMBDA

    // BEGIN_API
    const helloProtectedFn = new NodejsFunctionApi(this, "HelloProtectedFn", {
      entry: path.join(__dirname, "..", "lambda", "hello-protected", "index.ts"),
      runtime: lambda_api.Runtime.NODEJS_22_X,
      handler: "handler",
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      bundling: { minify: true, sourceMap: false, target: "node22", externalModules: [] },
    });

    const jwtAuthorizer = new HttpJwtAuthorizer(
      "JwtAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
        identitySource: ["$request.header.Authorization"],
      },
    );

    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "{{APP_NAME}}-api",
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ["authorization", "content-type"],
        maxAge: cdk.Duration.days(1),
      },
      defaultAuthorizer: jwtAuthorizer,
    });

    httpApi.addRoutes({
      path: "/hello",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("HelloIntegration", helloProtectedFn),
    });
    // END_API

    const testProject = new codebuild.PipelineProject(this, "TestProject", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec-test.yml"),
    });

    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        BUCKET_NAME: { value: siteBucket.bucketName },
        DISTRIBUTION_ID: { value: distribution.distributionId },
        // BEGIN_LLM_LAMBDA
        VITE_LLM_URL: { value: llmUrl.url },
        // END_LLM_LAMBDA
        // BEGIN_COGNITO
        VITE_USER_POOL_ID: { value: userPool.userPoolId },
        VITE_USER_POOL_CLIENT_ID: { value: userPoolClient.userPoolClientId },
        VITE_AWS_REGION: { value: this.region },
        // END_COGNITO
        // BEGIN_API
        VITE_API_URL: { value: httpApi.apiEndpoint },
        // END_API
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.yml"),
    });

    siteBucket.grantReadWrite(buildProject);
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
      }),
    );

    const sourceOutput = new codepipeline.Artifact("SourceOutput");

    new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "{{APP_NAME}}",
      pipelineType: codepipeline.PipelineType.V2,
      stages: [
        {
          stageName: "Source",
          actions: [
            new actions.CodeStarConnectionsSourceAction({
              actionName: "GitHub",
              owner: githubOwner,
              repo: githubRepo,
              branch: githubBranch,
              connectionArn: connection.attrConnectionArn,
              output: sourceOutput,
              triggerOnPush: true,
            }),
          ],
        },
        {
          stageName: "Test",
          actions: [
            new actions.CodeBuildAction({
              actionName: "LintAndUnitTests",
              project: testProject,
              input: sourceOutput,
            }),
          ],
        },
        {
          stageName: "BuildAndDeploy",
          actions: [
            new actions.CodeBuildAction({
              actionName: "BuildAndDeploy",
              project: buildProject,
              input: sourceOutput,
            }),
          ],
        },
      ],
    });

    // BEGIN_DOMAIN
    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${domainName}` });
    // END_DOMAIN
    // BEGIN_NO_DOMAIN
    new cdk.CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
    // END_NO_DOMAIN
    new cdk.CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new cdk.CfnOutput(this, "BucketName", { value: siteBucket.bucketName });
    // BEGIN_LLM_LAMBDA
    new cdk.CfnOutput(this, "LlmUrl", { value: llmUrl.url });
    // END_LLM_LAMBDA
    // BEGIN_COGNITO
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    // END_COGNITO
    // BEGIN_API
    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    // END_API
    new cdk.CfnOutput(this, "ConnectionArn", { value: connection.attrConnectionArn });
    new cdk.CfnOutput(this, "AuthorizeConnectionUrl", {
      value: `https://console.aws.amazon.com/codesuite/settings/${this.account}/${this.region}/codeconnections/connections`,
      description: "Open this after the first deploy and authorize the GitHub connection",
    });
  }
}
