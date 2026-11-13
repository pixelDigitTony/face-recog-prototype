import { describe, it, expect } from 'vitest';
import { validateDatabase } from '@/utils/hooks/faceRecognition/repositories/databaseSchema';
import { associateFacePoses } from '@/utils/hooks/faceRecognition/liveness/associateFacePoses';
import { context, vector, fixtureFaces, harness, bind, perform } from './enrollmentFixtures';

describe('parallel per-face enrollment capture', () => {
  it('requires an enabled challenge for a new live session while old settings still load', async () => {
    const h = await harness({ version: 1, turnLeft: false, turnRight: false, blink: false });
    expect(h.repository.getSnapshot().database.settings.enrollmentLiveness.blink).toBe(false);
    await expect(bind(h, 1, 'Alice')).rejects.toThrow('Enable at least one');
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it('captures two named people with isolated proofs and atomic records', async () => {
    const h = await harness();
    await Promise.all([bind(h, 1, 'Alice'), bind(h, 2, 'Bob')]);
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
    await perform(h, [1, 2]);
    const db = h.repository.getSnapshot().database;
    expect(db.people.map((p) => p.displayName)).toEqual(['Alice', 'Bob']);
    expect(db.templates).toHaveLength(2);
    expect(db.attempts.map((a) => a.trackId)).toEqual([1, 2]);
    expect(
      db.attempts.every(
        (a) =>
          a.faceCountAtDecision === 2 &&
          a.targetFaceCountAtDecision === 1 &&
          a.decisionPolicyVersion === 'enrollment-per-face-meter-v3' &&
          a.livenessMeter.status === 'passed_basic',
      ),
    ).toBe(true);
    expect(db.templates[0].embedding).toEqual(vector(0));
    expect(db.templates[1].embedding).toEqual(vector(1));
    expect(() => validateDatabase(db, context)).not.toThrow();
    await h.wait(400);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(2);
  });
  it('clears the old match immediately after saving and rematches before another operation', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await perform(h, [1]);
    const saved = h.repository.getSnapshot().database;
    const person = saved.people[0];
    expect(saved.templates).toHaveLength(1);
    const face = h.flow.getSnapshot().faces.find((f) => f.trackId === 1);
    expect(['waiting_for_analysis', 'checking']).toContain(face.identification.status);
    await expect(
      h.flow.nameDetectedFace({ trackId: 1, personId: person.id, acknowledged: true }),
    ).rejects.toThrow();
    await h.wait(1500);
    expect(h.flow.getSnapshot().faces.find((f) => f.trackId === 1).identification.status).toBe(
      'identified',
    );
    await h.flow.nameDetectedFace({ trackId: 1, personId: person.id, acknowledged: true });
    expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 1).meter.status).not.toBe(
      'passed_basic',
    );
  });
  it('one person can complete while another has not performed a challenge', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    await perform(h, [1]);
    expect(h.repository.getSnapshot().database.people.map((p) => p.displayName)).toEqual(['Alice']);
    expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 2).liveness.status).toBe(
      'checking',
    );
  });
  it('completed challenge alone cannot save without a separate completed meter', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await h.wait(1450);
    h.eye[0] = 0.6;
    await h.wait(150);
    h.eye[0] = 0;
    await h.wait(500);
    expect(h.flow.getSnapshot().sessions[0].liveness.status).toBe('passed_basic');
    expect(h.flow.getSnapshot().sessions[0].meter.activity.score).toBeLessThan(90);
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it('enrolls once the live liveness score reaches the passing rate', async () => {
    const h = await harness();
    await bind(h, 1, 'Ada');
    await h.wait(200);
    h.eye[0] = 1;
    await h.wait(150);
    h.eye[0] = 0;
    await h.wait(1500);
    expect(h.flow.getSnapshot().sessions[0].meter.activity.score).toBeGreaterThanOrEqual(90);
    expect(h.repository.getSnapshot().database.people).toHaveLength(1);
  });
  it('disappearance resets only the missing face while the other can finish', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    h.faces([fixtureFaces[1]]);
    await perform(h, [2]);
    expect(h.repository.getSnapshot().database.people.map((p) => p.displayName)).toEqual(['Bob']);
    expect(h.repository.getSnapshot().database.templates[0].embedding).toEqual(vector(1));
  });
  it('retains each sealed failed save for independent retry', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    const before = h.raw();
    h.quota(true);
    await perform(h, [1, 2]);
    expect(h.raw()).toBe(before);
    expect(h.flow.getSnapshot().sessions.every((s) => s.status === 'save_failed')).toBe(true);
    h.flow.stop();
    expect(h.flow.getSnapshot().sessions).toHaveLength(2);
    h.quota(false);
    await h.flow.retry(2);
    await h.flow.retry(1);
    await h.flow.retry(1);
    expect(h.repository.getSnapshot().database.people).toHaveLength(2);
    expect(h.repository.getSnapshot().database.attempts).toHaveLength(2);
  });
  it('clearing a saved result does not discard another face pending save', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    h.quota(true);
    await perform(h, [1, 2]);
    h.quota(false);
    await h.flow.retry(1);
    expect(h.flow.getSnapshot().result.persisted).toBe(true);
    h.flow.discard();
    expect(h.flow.getSnapshot().result).toBeNull();
    expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 2).status).toBe('save_failed');
    await h.flow.retry(2);
    expect(h.repository.getSnapshot().database.people).toHaveLength(2);
  });
  it('does not allow two in-flight faces to use the same name', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await expect(bind(h, 2, 'alice')).rejects.toThrow('already');
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it('associates unordered poses exclusively and refuses competing claims', () => {
    const faces = fixtureFaces.map((face, i) => ({ ...face, trackId: i + 1 }));
    const matches = associateFacePoses(faces, [
      { box: faces[1].box, yaw: -20 },
      { box: faces[0].box, yaw: 25 },
    ]);
    expect(matches.get(1).pose.yaw).toBe(25);
    expect(matches.get(2).pose.yaw).toBe(-20);
    expect(
      associateFacePoses(
        [{ ...faces[0] }, { ...faces[0], trackId: 2 }],
        [{ box: faces[0].box, yaw: 0 }],
      ).size,
    ).toBe(0);
  });
  it('rejects forged per-face bindings and missing new-policy meter evidence', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await perform(h, [1]);
    const db = structuredClone(h.repository.getSnapshot().database);
    expect(db.attempts).toHaveLength(1);
    const forged = structuredClone(db);
    forged.attempts[0].sourceTrackId = 999;
    expect(() => validateDatabase(forged, context)).toThrow('association');
    const missing = structuredClone(db);
    missing.attempts[0].livenessMeter = null;
    expect(() => validateDatabase(missing, context)).toThrow('motion evidence');
  });
  it('does not reuse a passed meter when a detection briefly disappears', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await h.wait(1450);
    h.yaw[0] = 8;
    await h.wait(500);
    h.yaw[0] = 0;
    await h.wait(500);
    h.eye[0] = 1;
    await h.wait(150);
    h.eye[0] = 0;
    // Stop before the capture hold completes, then lose one detection.
    await h.wait(150);
    h.faces([fixtureFaces[1]]);
    await h.step();
    h.faces(fixtureFaces);
    await h.step();
    expect(h.flow.getSnapshot().sessions.find((s) => s.trackId === 1)?.meter.accepted).toBeNull();
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
});
