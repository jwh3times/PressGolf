import { describeFeatures, withImportedFeatures } from '../course-map';
import type { CourseFeature, FeatureKind } from '../types';

const feature = (id: string, kind: FeatureKind = 'bunker', source: CourseFeature['source'] = 'osm'): CourseFeature => ({
  id,
  kind,
  hole: kind === 'holeLine' ? 1 : null,
  points: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }],
  source,
});

describe('withImportedFeatures', () => {
  it('keeps what was drawn, replaces an earlier import whole, and keeps id order', () => {
    const drawn = feature('map:ob-1', 'outOfBounds', 'map');
    const existing = [feature('osm:way/2'), drawn, feature('osm:way/9')];
    const imported = [feature('osm:way/5'), feature('osm:way/2', 'water')];

    expect(withImportedFeatures(existing, imported)).toEqual([drawn, imported[1], imported[0]]);
  });

  it('never lets an import overwrite a drawn feature that happens to share its id', () => {
    const drawn = feature('osm:way/2', 'bunker', 'map');
    expect(withImportedFeatures([drawn], [feature('osm:way/2', 'water')])).toEqual([drawn]);
  });
});

describe('describeFeatures', () => {
  it('counts each kind in a sentence, with the course edge last', () => {
    expect(
      describeFeatures([
        feature('a'),
        feature('b'),
        feature('c', 'water'),
        feature('d', 'courseEdge'),
        feature('e', 'fairway'),
        feature('f', 'lateralWater'),
      ]),
    ).toBe('2 bunkers, 1 water hazard, 1 red penalty area, 1 fairway and the course edge');
    expect(describeFeatures([feature('a', 'holeLine')])).toBe('1 hole line');
    expect(describeFeatures([])).toBe('');
  });
});
