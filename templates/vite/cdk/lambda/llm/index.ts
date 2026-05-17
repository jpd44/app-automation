import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const bedrock = new BedrockRuntimeClient({});
const MODEL_ID = process.env.MODEL_ID!;

export const handler = async (event: { body?: string | null }) => {
  const body = event.body ? JSON.parse(event.body) : {};
  const prompt: string = body.prompt ?? "";

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    }),
  );

  const payload = JSON.parse(new TextDecoder().decode(response.body));
  const text = payload?.content?.[0]?.text ?? "";

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  };
};
