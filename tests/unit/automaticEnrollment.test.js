import { describe, it, expect } from 'vitest';
import { harness, bind, perform, fixtureFaces } from './enrollmentFixtures';

const session = (h, id = 1) => h.flow.getSnapshot().sessions.find((s) => s.trackId === id);
const detection = (h, id = 1) => h.flow.getSnapshot().faces.find((f) => f.trackId === id);

describe('automatic per-face enrollment', () => {
  it('names an unknown face and atomically saves a person, sample and attempt', async () => {
    const h = await harness();
    expect(detection(h).discovery.status).toBe('unknown');
    await bind(h, 1, 'New Person');
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
    await perform(h, [1]);
    const db = h.repository.getSnapshot().database;
    expect(db.people).toHaveLength(1);
    expect(db.people[0].displayName).toBe('New Person');
    expect(db.people[0].employeeCode).toMatch(/^FACE-/);
    expect(db.templates).toHaveLength(1);
    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0]).toMatchObject({
      outcome: 'ENROLLED',
      decisionPolicyVersion: 'enrollment-per-face-meter-v3',
      livenessMeter: { status: 'passed_basic' },
    });
    await h.wait(800);
    expect(db.templates).toHaveLength(1);
  });
  it('does not create an unrelated draft person during atomic capture', async () => {
    const h = await harness();
    const commit = h.repository.commit;
    h.repository.commit = (op) =>
      commit(op.newPerson ? { ...op, newPerson: { ...op.newPerson, id: 'unrelated' } } : op);
    await bind(h, 1, 'Person');
    await perform(h, [1]);
    expect(session(h).status).toBe('save_failed');
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it('detects the saved enrollee and only adds a sample after explicit action', async () => {
    const h = await harness();
    await bind(h, 1, 'Person');
    await perform(h, [1]);
    const person = h.repository.getSnapshot().database.people[0];
    await h.wait(1600);
    expect(detection(h).discovery.status).toBe('identified');
    await expect(bind(h, 1, 'Duplicate')).rejects.toThrow();
    expect(h.repository.getSnapshot().database.templates).toHaveLength(1);
    await h.flow.nameDetectedFace({ trackId: 1, personId: person.id, acknowledged: true });
    await perform(h, [1]);
    await h.wait(1000);
    expect(h.repository.getSnapshot().database.people).toHaveLength(1);
    expect(session(h)).toMatchObject({ status: 'saved' });
    expect(h.repository.getSnapshot().database.templates).toHaveLength(2);
  });
  it('rejects missing consent, blank and oversized names and premature claims', async () => {
    const h = await harness();
    await expect(
      h.flow.nameDetectedFace({ trackId: 99, name: 'Person', acknowledged: true }),
    ).rejects.toThrow();
    await expect(h.flow.nameDetectedFace({ trackId: 1, name: 'Person' })).rejects.toThrow(
      'Confirm',
    );
    await expect(bind(h, 1, ' ')).rejects.toThrow('name');
    await expect(bind(h, 1, 'x'.repeat(121))).rejects.toThrow('name');
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it.each(['lost', 'new_track'])(
    'cancels the draft on %s without saving a person',
    async (kind) => {
      const h = await harness();
      await bind(h, 1, 'Person');
      h.faces(
        kind === 'lost'
          ? [fixtureFaces[1]]
          : [{ ...fixtureFaces[0], box: [500, 10, 120, 140] }, fixtureFaces[1]],
      );
      await h.wait(1500);
      expect(session(h)?.active ?? false).toBe(false);
      expect(h.repository.getSnapshot().database.people).toHaveLength(0);
    },
  );
  it('allows another visible face to complete independently', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    await perform(h, [1]);
    expect(session(h, 1).status).toBe('saved');
    expect(session(h, 2).status).toBe('challenging');
    expect(h.repository.getSnapshot().database.people.map((p) => p.displayName)).toEqual(['Alice']);
  });
  it('retries the exact sealed quota failure once', async () => {
    const h = await harness();
    await bind(h, 1, 'Person');
    const before = h.raw();
    h.quota(true);
    await perform(h, [1]);
    expect(session(h).status).toBe('save_failed');
    expect(h.raw()).toBe(before);
    const accepted = structuredClone(session(h).meter.accepted);
    h.flow.stop();
    h.quota(false);
    await h.flow.retry(1);
    await h.flow.retry(1);
    const db = h.repository.getSnapshot().database;
    expect(db.people).toHaveLength(1);
    expect(db.templates).toHaveLength(1);
    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0].livenessMeter.events).toEqual(accepted.events);
    expect(db.attempts[0].livenessMeter.passedAt).toBe(accepted.passedAt);
  });
  it('rejects duplicate names across pending tracks and saved people', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await expect(bind(h, 2, 'alice')).rejects.toThrow('already');
    await perform(h, [1]);
    await h.wait(1600);
    await expect(bind(h, 2, 'ALICE')).rejects.toThrow('already');
  });
  it('rejects an identity that becomes conflicting before save', async () => {
    const h = await harness();
    await bind(h, 1, 'Person');
    const draft = session(h).person;
    await h.repository.commit({
      type: 'savePerson',
      person: { ...draft, displayName: 'Other', employeeCode: 'other' },
    });
    await perform(h, [1]);
    expect(session(h)?.active ?? false).toBe(false);
    expect(h.repository.getSnapshot().database.templates).toHaveLength(0);
  });
  it('does not bind an in-flight draft after stop', async () => {
    const h = await harness();
    const pending = bind(h, 1, 'Person');
    h.flow.stop();
    await expect(pending).rejects.toThrow('Start live matching first');
    expect(h.flow.getSnapshot().sessions).toHaveLength(0);
    expect(h.repository.getSnapshot().database.people).toHaveLength(0);
  });
  it('confirms two faces separately and blocks ambiguous identity claims', async () => {
    const h = await harness();
    await bind(h, 1, 'Alice');
    await bind(h, 2, 'Bob');
    await perform(h, [1, 2]);
    await h.wait(1800);
    expect(h.flow.getSnapshot().faces.map((f) => f.discovery.status)).toEqual([
      'identified',
      'identified',
    ]);
    const db = h.repository.getSnapshot().database;
    expect(
      new Set(h.flow.getSnapshot().faces.map((f) => f.identification.person.personId)).size,
    ).toBe(2);
    h.flow.stop();
    db.templates[1].embedding = [...db.templates[0].embedding];
    await h.flow.start();
    await h.wait(1800);
    expect(detection(h, 1).discovery.status).toBe('ambiguous');
    await expect(bind(h, 1, 'Third')).rejects.toThrow();
    expect(db.people).toHaveLength(2);
  });
});
