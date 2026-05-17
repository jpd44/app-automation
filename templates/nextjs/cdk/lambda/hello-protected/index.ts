import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  const claims = event.requestContext.authorizer.jwt.claims;
  const sub = claims.sub as string;
  const email = claims.email as string | undefined;

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: `Hello, ${email ?? sub}`,
      sub,
      email,
    }),
  };
};
