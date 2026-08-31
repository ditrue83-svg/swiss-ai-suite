export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('npm:')) return nextResolve(specifier, context);
  const requested = specifier.slice(4);
  const bare = requested.startsWith('@')
    ? requested.replace(/^(@[^/]+\/[^@/]+)@[^/]+/, '$1')
    : requested.replace(/^([^@/]+)@[^/]+/, '$1');
  return nextResolve(bare, context);
}
