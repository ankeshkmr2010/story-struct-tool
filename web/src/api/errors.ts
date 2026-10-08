export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  try { return JSON.parse(message.slice(message.indexOf('{'))).detail ?? message } catch { return message }
}
