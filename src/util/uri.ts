export function encodeUri(id: string): string {
  return encodeURIComponent(id);
}

export function decodeUri(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch (error) {
    return uri;
  }
}
