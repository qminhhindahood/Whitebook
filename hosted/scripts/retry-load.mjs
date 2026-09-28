export async function retryLoad(load, { delayMs = 200 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await load();
    } catch (error) {
      const transient = error?.status === 0 || error?.status >= 500 ||
        error?.name === "TypeError" || error?.name === "AbortError" || error?.name === "TimeoutError";
      if (!transient || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw new Error("A required content request could not be loaded.");
}
