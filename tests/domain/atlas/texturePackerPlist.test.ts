import { describe, expect, it } from 'vitest';
import {
  allocatePlistFrameName,
  buildTexturePackerPlistFormat2Xml,
  buildTexturePackerPlistXml,
} from '../../../src/domain/atlas/texturePackerPlist';

describe('allocatePlistFrameName', () => {
  it('uses basename and dedupes collisions', () => {
    const used = new Set<string>();
    expect(allocatePlistFrameName('textures/a.png', used)).toBe('a.png');
    expect(allocatePlistFrameName('other/a.png', used)).toBe('a_2.png');
  });

  it('defaults missing extension to .png', () => {
    const used = new Set<string>();
    expect(allocatePlistFrameName('folder/foo', used)).toBe('foo.png');
  });
});

describe('buildTexturePackerPlistXml', () => {
  it('emits TexturePacker format 3 plist with frames and metadata', () => {
    const xml = buildTexturePackerPlistXml({
      textureFileName: 'atlas-0.png',
      textureWidth: 64,
      textureHeight: 48,
      frames: [
        {
          frameName: 'icon.png',
          entry: {
            assetRef: 'icon.png',
            rect: { x: 4, y: 8, width: 20, height: 20 },
            sourceSize: { width: 20, height: 20 },
          },
        },
      ],
    });
    expect(xml).toContain('<!DOCTYPE plist');
    expect(xml).toContain('<key>format</key>');
    expect(xml).toContain('<integer>3</integer>');
    expect(xml).toContain('<key>icon.png</key>');
    expect(xml).toContain('<string>{{4,8},{20,20}}</string>');
    expect(xml).toContain('<key>realTextureFileName</key>');
    expect(xml).toContain('<string>atlas-0.png</string>');
    expect(xml).toContain('<string>{64,48}</string>');
  });

  it('format2 plist uses frame/offset/sourceSize and metadata format 2', () => {
    const xml = buildTexturePackerPlistFormat2Xml({
      textureFileName: 'atlas-0.png',
      textureWidth: 64,
      textureHeight: 48,
      frames: [
        {
          frameName: 'icon.png',
          entry: {
            assetRef: 'icon.png',
            rect: { x: 1, y: 2, width: 8, height: 9 },
            sourceSize: { width: 8, height: 9 },
          },
        },
      ],
    });
    expect(xml).toContain('<integer>2</integer>');
    expect(xml).toContain('<key>frame</key>');
    expect(xml).toContain('{{1,2},{8,9}}');
    expect(xml).toContain('<key>textureFileName</key>');
    expect(xml).toContain('<string>atlas-0</string>');
    expect(xml).toContain('<string>atlas-0.png</string>');
  });

  it('escapes frame names for XML', () => {
    const xml = buildTexturePackerPlistXml({
      textureFileName: 'a.png',
      textureWidth: 1,
      textureHeight: 1,
      frames: [
        {
          frameName: 'x<y.png',
          entry: {
            assetRef: 'x',
            rect: { x: 0, y: 0, width: 1, height: 1 },
            sourceSize: { width: 1, height: 1 },
          },
        },
      ],
    });
    expect(xml).toContain('<key>x&lt;y.png</key>');
  });
});
