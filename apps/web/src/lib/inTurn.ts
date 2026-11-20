/** Runs one item at a time, so a bulk action never floods the server. A failure is noted and the rest still run. */
export async function inTurn<T>(items: T[], run: (item: T) => Promise<void>, onProgress: (done: number, total: number) => void): Promise<{ item: T; message: string }[]> {
  const failed: { item: T; message: string }[] = [];
  for (const [i, item] of items.entries()) {
    try {
      await run(item);
    } catch (e) {
      failed.push({ item, message: e instanceof Error ? e.message : "Something went wrong. Please try again." });
    }
    onProgress(i + 1, items.length);
  }
  return failed;
}
