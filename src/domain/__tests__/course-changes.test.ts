import { courseChanges, fillsGap } from '../course-changes';
import type { Course } from '../types';
import { makeTestCourse, withTee } from './helpers';

describe('changes to someone else’s course (#381)', () => {
  const course: Course = { ...makeTestCourse(), tees: [{ ...makeTestCourse().tees[0], slope: 128 }] };
  const green = { number: 1, middle: { lat: 1, lng: 2 }, front: null, back: null, source: 'map' as const };

  it('finds nothing in a draft that changes nothing', () => {
    expect(courseChanges(course, structuredClone(course))).toEqual([]);
  });

  it('names each change, with the value it replaces', () => {
    const tee = course.tees[0];
    const draft: Course = {
      ...course,
      name: 'Renamed',
      location: { lat: 32.9, lng: -117.2 },
      tees: [{ ...tee, name: 'Blue', rating: 71.2, holes: tee.holes.map((h, i) => (i === 0 ? { ...h, par: 5, yards: 520 } : h)) }],
      greens: [green],
    };
    expect(courseChanges(course, draft)).toEqual([
      { kind: 'course', field: 'name', from: 'Test Links', to: 'Renamed' },
      { kind: 'course', field: 'location', from: null, to: { lat: 32.9, lng: -117.2 } },
      { kind: 'tee', tee: 'white', field: 'name', from: 'White', to: 'Blue' },
      { kind: 'tee', tee: 'white', field: 'rating', from: null, to: 71.2 },
      { kind: 'hole', tee: 'white', number: 1, field: 'par', from: 4, to: 5 },
      { kind: 'hole', tee: 'white', number: 1, field: 'yards', from: 400, to: 520 },
      { kind: 'green', number: 1, from: null, to: green },
    ]);
  });

  it('sends an added tee whole', () => {
    const draft = withTee(course, 'red', () => ({}));
    expect(courseChanges(course, draft)).toEqual([{ kind: 'newTee', tee: draft.tees[1] }]);
  });

  it('puts a gap or an added tee straight in, and makes the rest a suggestion, as the server does', () => {
    const tee = course.tees[0];
    const changes = courseChanges(course, {
      ...withTee({ ...course, location: { lat: 1, lng: 1 }, greens: [green] }, 'red', () => ({})),
      tees: [{ ...tee, slope: 120, rating: 70 }, withTee(course, 'red', () => ({})).tees[1]],
      greens: [green, { ...green, number: 2 }],
    });
    expect(changes.map((c) => [c.kind, 'field' in c ? c.field : '', fillsGap(c)])).toEqual([
      ['course', 'location', true],
      ['tee', 'slope', false],
      ['tee', 'rating', true],
      ['newTee', '', true],
      ['green', '', true],
      ['green', '', true],
    ]);
    const moved = courseChanges({ ...course, greens: [green] }, { ...course, greens: [{ ...green, middle: { lat: 3, lng: 4 } }] });
    expect(moved.map(fillsGap)).toEqual([false]);
  });
});
