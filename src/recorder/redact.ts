/** Strip a Helius key from anything that might be logged. The key is never written. */
export function redact(value: string, secret?: string): string {
  let out = value.replace(/([?&]api-key=)[^&\s'"]+/gi, "$1REDACTED");
  if (secret && secret.length >= 8) out = out.split(secret).join("REDACTED");
  return out;
}

export function endpointLabel(usingHelius: boolean): string {
  return usingHelius ? "helius" : "public-rpc";
}
