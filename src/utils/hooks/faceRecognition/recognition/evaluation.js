import { cosineSimilarity } from './cosineSimilarity';
import { rankEmbedding, rankScores, createIdentificationWindow } from './identificationPolicy';

export const EVALUATION_POLICY = 'evaluation-multisample-v1';
export const EVALUATION_THRESHOLDS = Array.from({ length: 16 }, (_, i) => (20 + i * 5) / 100);

export function validateEvaluationTrial(trial, db, scope) {
  const validVector = (v) =>
    Array.isArray(v) &&
    v.length === 128 &&
    v.every(Number.isFinite) &&
    Math.abs(Math.hypot(...v) - 1) <= 0.005;
  if (
    trial.companyId !== scope.companyId ||
    (scope.storeId != null && trial.storeId !== scope.storeId) ||
    trial.policy !== EVALUATION_POLICY ||
    !['completed', 'capture_failed', 'cancelled'].includes(trial.status) ||
    !trial.participantLabel?.trim() ||
    trial.participantLabel.length > 100 ||
    typeof trial.notes !== 'string' ||
    trial.notes.length > 500 ||
    (trial.personId !== null && !db.people.some((p) => p.id === trial.personId)) ||
    !Number.isFinite(Date.parse(trial.createdAt)) ||
    !Array.isArray(trial.observations) ||
    !trial.modelIdentity ||
    !trial.preprocessingVersion ||
    !trial.galleryVersion ||
    trial.source !== 'live_camera' ||
    trial.livenessStatus !== 'not_checked'
  )
    throw new Error('Invalid evaluation trial.');
  if (trial.report) {
    const report = trial.report;
    if (report.excluded) {
      if (typeof report.excluded !== 'string') throw new Error('Invalid evaluation report.');
    } else {
      const categories = [
        'correct',
        'missed',
        'wrong_person',
        'unenrolled_accepted',
        'unenrolled_rejected',
        'excluded',
      ];
      if (
        typeof report.galleryVersion !== 'string' ||
        !report.modes ||
        ['all', 'primary'].some(
          (mode) =>
            !Array.isArray(report.modes[mode]) ||
            report.modes[mode].length !== 1 ||
            report.modes[mode][0].threshold !== 0.85 ||
            !categories.includes(report.modes[mode][0].category),
        )
      )
        throw new Error('Invalid evaluation report.');
      for (const rows of Object.values(report.modes))
        for (const row of rows) {
          if (
            row.category !== 'excluded' &&
            (!Array.isArray(row.scores) ||
              row.scores.length !== 3 ||
              row.scores.some(
                (score) =>
                  !Number.isFinite(score.similarity) ||
                  !score.candidate?.personId ||
                  !score.candidate?.templateId,
              ))
          )
            throw new Error('Invalid evaluation report scores.');
        }
    }
  }
  if (trial.status === 'completed') {
    const samples = trial.observations;
    if (
      samples.length !== 3 ||
      samples[2].timestamp - samples[0].timestamp < 600 ||
      samples.some(
        (s, i) =>
          !validVector(s.embedding) ||
          !Number.isFinite(s.timestamp) ||
          (i > 0 &&
            (s.timestamp <= samples[i - 1].timestamp ||
              s.timestamp - samples[i - 1].timestamp > 1500)),
      )
    )
      throw new Error('Invalid evaluation observations.');
  } else if (trial.observations.length || !trial.reason)
    throw new Error('Invalid failed evaluation.');
}

export function evaluationGallery(gallery) {
  const primary = gallery.entries.filter((e) => e.primary);
  const people = new Set(primary.map((e) => e.personId));
  return {
    primary,
    all: gallery.entries.filter((e) => people.has(e.personId)),
    excludedPeople: gallery.eligibleCount - people.size,
  };
}

export function replayTrial(trial, entries, threshold, rank = rankEmbedding) {
  if (!entries.length || (trial.personId && !entries.some((e) => e.personId === trial.personId)))
    return { category: 'excluded', reason: 'No comparable enrollment' };
  const window = createIdentificationWindow();
  let decision;
  const scores = trial.observations.map((o) => {
    const ranking = rank(o.embedding, entries, threshold);
    decision = window.observe(ranking, o.timestamp, 'evaluation');
    const expected = trial.personId
      ? rank(
          o.embedding,
          entries.filter((e) => e.personId === trial.personId),
          threshold,
        )?.similarity
      : null;
    const competing = trial.personId
      ? (rank(
          o.embedding,
          entries.filter((e) => e.personId !== trial.personId),
          threshold,
        )?.similarity ?? null)
      : ranking.similarity;
    return {
      expected,
      competing,
      similarity: ranking.similarity,
      candidate: ranking.closestCandidate,
    };
  });
  const accepted = decision?.outcome === 'IDENTIFIED' ? decision.personId : null;
  const category = trial.personId
    ? accepted === trial.personId
      ? 'correct'
      : accepted
        ? 'wrong_person'
        : 'missed'
    : accepted
      ? 'unenrolled_accepted'
      : 'unenrolled_rejected';
  return {
    category,
    predictedPersonId: accepted,
    reason: decision?.outcome ?? 'UNSTABLE',
    scores,
    decision: decision ?? null,
  };
}

export function evaluateTrial(trial, gallery, manifest) {
  if (trial.status !== 'completed') return { excluded: trial.reason || trial.status };
  if (
    trial.modelIdentity.detector?.sha256 !== manifest.detector?.sha256 ||
    trial.modelIdentity.recognizer?.sha256 !== manifest.recognizer?.sha256 ||
    trial.preprocessingVersion !== manifest.preprocessingVersion
  )
    return { excluded: 'Model/preprocessing incompatible: capture again' };
  const paired = evaluationGallery(gallery);
  const modes = {};
  const cached = new Map(
    trial.observations.map((o) => [
      o.embedding,
      new Map(paired.all.map((e) => [e.templateId, cosineSimilarity(o.embedding, e.embedding)])),
    ]),
  );
  const rank = (embedding, entries, threshold) =>
    rankScores(
      entries.map((entry) => ({ entry, score: cached.get(embedding).get(entry.templateId) })),
      threshold,
    );
  for (const [name, entries] of [
    ['primary', paired.primary],
    ['all', paired.all],
  ]) {
    modes[name] = EVALUATION_THRESHOLDS.map((threshold) => ({
      threshold,
      ...replayTrial(trial, entries, threshold, rank),
    }));
  }
  return { galleryVersion: gallery.version, excludedPeople: paired.excludedPeople, modes };
}

export function evaluationSummary(reports, mode, threshold) {
  const counts = {
    correct: 0,
    missed: 0,
    wrong_person: 0,
    unenrolled_accepted: 0,
    unenrolled_rejected: 0,
    excluded: 0,
  };
  for (const report of reports) {
    const row = report.modes?.[mode]?.find((r) => r.threshold === threshold);
    counts[row?.category ?? 'excluded']++;
  }
  return {
    ...counts,
    enrolled: counts.correct + counts.missed + counts.wrong_person,
    unenrolled: counts.unenrolled_accepted + counts.unenrolled_rejected,
  };
}

export function compactEvaluationReport(report) {
  if (!report.modes) return report;
  return {
    ...report,
    modes: Object.fromEntries(
      Object.entries(report.modes).map(([mode, rows]) => [
        mode,
        rows.filter((row) => row.threshold === 0.85),
      ]),
    ),
  };
}
