export function requireSuccessfulIpcResult(result) {
  if (result && typeof result === "object" && result.ok === false) {
    throw new Error("ipc_operation_failed");
  }
  return result;
}
