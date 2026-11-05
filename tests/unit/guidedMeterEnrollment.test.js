import { describe, it, expect } from 'vitest';
import { harness, bind, perform, fixtureFaces } from './enrollmentFixtures';

async function review() {
  const h = await harness();
  await bind(h, 1, 'Alice', true);
  await perform(h, [1]);
  h.yaw[0] = 15;
  await h.wait(1000);
  h.yaw[0] = -15;
  await h.wait(1000);
  expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 1).status).toBe('review');
  return h;
}

describe('guided meter enrollment', () => {
  it('retains sealed review through stop and quota retry with original evidence', async () => {
    const h = await review();
    const before = structuredClone(h.flow.getSnapshot().sessions[0].meter.accepted);
    h.flow.stop();
    h.quota(true);
    await h.flow.saveSet(['Front', 'Left', 'Right'], 1);
    expect(h.flow.getSnapshot().sessions[0].status).toBe('set_save_failed');
    h.quota(false);
    await h.flow.saveSet(['Front', 'Left', 'Right'], 1);
    const db = h.repository.getSnapshot().database;
    expect(db.templates).toHaveLength(3);
    expect(db.attempts).toHaveLength(3);
    for (const attempt of db.attempts) {
      expect(attempt.livenessMeter.passedAt).toBe(before.passedAt);
      expect(attempt.livenessMeter.events).toEqual(before.events);
    }
  });
  it('updates visible activity independently while retaining a sealed review proof', async () => {
    const h = await review();
    const before = structuredClone(h.flow.getSnapshot().sessions[0].meter.accepted);
    const faceBefore = h.flow.getSnapshot().faces.find((f) => f.trackId === 1);
    expect(faceBefore.meter.activity.score).toBeGreaterThan(0);
    await h.wait(16000);
    const faceAfter = h.flow.getSnapshot().faces.find((f) => f.trackId === 1);
    expect(faceAfter.meter.activity).toMatchObject({ score: 0, idle: true });
    expect(h.flow.getSnapshot().sessions[0].meter.accepted).toEqual(before);
    h.yaw[0] = 0;
    await h.wait(500);
    expect(h.flow.getSnapshot().faces.find((f) => f.trackId === 1).meter.activity.headScore).toBe(
      50,
    );
    expect(h.flow.getSnapshot().sessions[0].meter.accepted).toEqual(before);
  });
  it('keeps sealed review separate from a returning live face', async () => {
    const h = await review();
    const before = structuredClone(h.flow.getSnapshot().sessions[0].meter.accepted);
    h.faces([fixtureFaces[1]]);
    await h.step();
    h.faces(fixtureFaces);
    await h.step();
    const state = h.flow.getSnapshot();
    const live = state.faces.find((f) => f.trackId === 1);
    expect(live.enrollment).toBeNull();
    expect(live.meter.status).not.toBe('passed_basic');
    expect(state.sessions.find((s) => s.trackId === 1).meter.accepted).toEqual(before);
  });
});
