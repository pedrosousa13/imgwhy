/**
 * What a caught value says for itself.
 *
 * Everything this command catches ends on a line someone reads: a config file
 * that would not parse, a path that would not take a file, a runner that threw
 * before the browser opened. `catch` binds `unknown`, so each of those sites
 * needs the same two cases — an Error carries the sentence already, and
 * anything else is stringified rather than dropped, because a thrown string is
 * still the only account of the failure there is.
 */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
