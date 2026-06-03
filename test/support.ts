import type { ShelfItem, Project } from '../src/shared/types';

/**
 * Narrow a ShelfItem to its Project, failing loudly if it isn't a project item.
 * Lets tests assert on `.project` without an `as` cast on the discriminated union.
 */
export function projectOf(item: ShelfItem): Project {
  if (item.kind !== 'project') {
    throw new Error(`expected a project item, got kind="${item.kind}"`);
  }
  return item.project;
}
