export function assertType<T extends string>(type: T, obj: { type: string }): asserts obj is { type: T } {
  if (obj.type !== type) {
    throw new Error(`unexpected type: ${obj.type}`);
  }
}
