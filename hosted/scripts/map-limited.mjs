export async function mapLimited(items, limit, load) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("A positive concurrency limit is required.");
  const results = new Array(items.length);
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !failure) {
      const index = next++;
      try {
        results[index] = await load(items[index]);
      } catch (error) {
        failure = error;
      }
    }
  }));
  if (failure) throw failure;
  return results;
}
