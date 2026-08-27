export function claudeEnvironment(
  current: NodeJS.ProcessEnv,
  proxyBaseUrl: string,
): NodeJS.ProcessEnv {
  return {
    ...current,
    ANTHROPIC_BASE_URL: proxyBaseUrl,
    KLAUXY: "1",
  };
}
