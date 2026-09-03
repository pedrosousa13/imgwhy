import type { Candidate, DeviceRun } from '@imgwhy/core';

/**
 * The set of URLs one `srcset` offers, as a comparable string.
 *
 * Two renders that offer the same files are looking at the same image, however
 * the markup moved. The descriptors are left out on purpose: a render may
 * re-describe the same files, and the files are what identify the image. A URL
 * holds no newline, so joining on one cannot collide.
 *
 * Null where an image offers nothing, which is an image with no `srcset`.
 */
export function familyKey(candidates: Candidate[]): string | null {
  if (!candidates.length) return null;
  return candidates
    .map((c) => c.url)
    .sort()
    .join('\n');
}

/**
 * Give every image an id that holds across device runs.
 *
 * The DOM path is the id while it lasts, because it reads well and tells two
 * images apart. It does not always last: a responsive layout can reparent an
 * image or move it among its siblings, and then the same image reports a
 * different path. The candidate URL family stands in for that case.
 *
 * Runs are read in order, so an image first seen on the third device takes its
 * id from there and the two runs after it agree.
 */
export function alignImageIds(runs: DeviceRun[]): DeviceRun[] {
  const idByPath = new Map<string, string>();
  const idByFamily = new Map<string, string>();

  return runs.map((run) => {
    const taken = new Set<string>();
    return {
      ...run,
      images: run.images.map((image) => {
        const path = image.selector;
        const family = familyKey(image.candidates);
        const known = idByPath.get(path) ?? (family !== null ? idByFamily.get(family) : undefined);

        // A page can carry the same `srcset` twice, so a family match is not
        // proof on its own. Two elements never share a DOM path inside one
        // render, which is why the path is always free to fall back to.
        const id = known !== undefined && !taken.has(known) ? known : path;
        taken.add(id);

        if (!idByPath.has(path)) idByPath.set(path, id);
        if (family !== null && !idByFamily.has(family)) idByFamily.set(family, id);

        return { ...image, id };
      }),
    };
  });
}
