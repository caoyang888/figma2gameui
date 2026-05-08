import { describe, expect, it } from 'vitest';
import { makeImageImporterMeta, makeMetaFile, newUuid } from '../src/domain/emitters/cocos3/meta';

describe('uuidMeta', () => {
  it('newUuid returns lowercase UUID v4 with correct length and shape', () => {
    const id = newUuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.length).toBe(36);
  });

  it('makeMetaFile includes a uuid line for each kind', () => {
    const u = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const png = makeMetaFile({ uuid: u, kind: 'Texture2D', fileName: 'x.png' });
    expect(png).toContain(`"uuid": "${u}"`);

    const ttf = makeMetaFile({ uuid: u, kind: 'TTFFont', fileName: 'x.ttf' });
    expect(ttf).toContain(`"uuid": "${u}"`);

    const pref = makeMetaFile({ uuid: u, kind: 'Prefab', syncNodeName: 'Root' });
    expect(pref).toContain(`"uuid": "${u}"`);
  });

  it('image importer meta includes sprite-frame vertices payload', () => {
    const u = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const meta = makeImageImporterMeta({
      textureUuid: u,
      spriteUuid: `${u}@f9941`,
      fileName: 'x.png',
      width: 64,
      height: 32,
    });
    expect(meta).toContain('"rawPosition"');
    expect(meta).toContain('"indexes"');
    expect(meta).toContain('"uv"');
    expect(meta).toContain('"nuv"');
    expect(meta).toContain('"minPos"');
    expect(meta).toContain('"maxPos"');
  });
});
