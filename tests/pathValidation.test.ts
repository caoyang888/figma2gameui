import { describe, it, expect } from 'vitest';
import { validateAssetsRelativeRoot } from '../src/shared/pathValidation';

describe('validateAssetsRelativeRoot', () => {
  it('rejects parent segments', () => {
    expect(() => validateAssetsRelativeRoot('../secret')).toThrow(/parent/i);
  });

  it('accepts safe segment', () => {
    expect(validateAssetsRelativeRoot('_figma_export/ui_v1')).toBe('_figma_export/ui_v1');
  });

  it('rejects empty string', () => {
    expect(() => validateAssetsRelativeRoot('')).toThrow(/empty/i);
  });

  it('rejects only whitespace', () => {
    expect(() => validateAssetsRelativeRoot('   ')).toThrow(/empty/i);
  });

  it('rejects single dot segment', () => {
    expect(() => validateAssetsRelativeRoot('foo/./bar')).toThrow(/\./i);
  });

  it('rejects embedded parent directory', () => {
    expect(() => validateAssetsRelativeRoot('foo/../bar')).toThrow(/parent/i);
  });

  it('rejects leading slash absolute path', () => {
    expect(() => validateAssetsRelativeRoot('/etc/passwd')).toThrow(/absolute|slash/i);
  });

  it('rejects Windows drive absolute path', () => {
    expect(() => validateAssetsRelativeRoot('C:\\Users')).toThrow(/windows|drive|absolute/i);
  });

  it('rejects duplicate slashes creating empty segment', () => {
    expect(() => validateAssetsRelativeRoot('a//b')).toThrow(/empty|slash/i);
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(validateAssetsRelativeRoot('_figma_export\\ui_v1')).toBe('_figma_export/ui_v1');
  });
});
