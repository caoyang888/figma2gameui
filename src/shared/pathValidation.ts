/**
 * Validates a path intended to live under the project's `assets/` folder.
 * Returns a normalized path using `/` separators.
 */
export function validateAssetsRelativeRoot(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new Error('Export path must not be empty.');
  }

  const normalized = trimmed.replace(/\\/g, '/');

  if (normalized.startsWith('/')) {
    throw new Error('Export path must not start with "/" (absolute paths are not allowed).');
  }

  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Export path must not be a Windows-style absolute path (drive letter).');
  }

  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '') {
      throw new Error('Export path must not contain empty path segments (duplicate slashes).');
    }
    if (segment === '.') {
      throw new Error('Export path must not contain "." path segments.');
    }
    if (segment === '..') {
      throw new Error('Export path must not contain ".." (parent directory) segments.');
    }
  }

  return normalized;
}
