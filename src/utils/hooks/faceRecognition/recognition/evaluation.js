import { cosineSimilarity } from './cosineSimilarity';
import {
  rankEmbedding,
  rankScores,
  createIdentificationWindow,
  classifyRanking,
} from './identificationPolicy';
import {
  COMPARATIVE_POLICY,
  validateReferencePlan,
  validateComparativeMetadata,
} from './evaluationReferencePlan';

export const EVALUATION_POLICY = 'evaluation-all-samples-v2';
export const LEGACY_EVALUATION_POLICY = 'evaluation-multisample-v1';
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
    ![EVALUATION_POLICY, LEGACY_EVALUATION_POLICY, COMPARATIVE_POLICY].includes(trial.policy) ||
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
  if (trial.policy === COMPARATIVE_POLICY) {
    validateReferencePlan(trial.referencePlan, scope);
    validateComparativeMetadata(trial);
    if (trial.report) validateComparativeReport(trial);
  }
  if (trial.report && trial.policy !== COMPARATIVE_POLICY) {
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
        (report.policy === EVALUATION_POLICY ? ['all'] : ['all', 'primary']).some(
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
  return { all: gallery.entries, excludedPeople: 0 };
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
      ...(trial.policy === COMPARATIVE_POLICY
        ? { ranking: (({ closestCandidate, ...evidence }) => evidence)(ranking) }
        : {}),
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
  for (const [name, entries] of [['all', paired.all]]) {
    modes[name] = EVALUATION_THRESHOLDS.map((threshold) => ({
      threshold,
      ...replayTrial(trial, entries, threshold, rank),
    }));
  }
  return {
    policy: EVALUATION_POLICY,
    galleryVersion: gallery.version,
    excludedPeople: paired.excludedPeople,
    modes,
  };
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

export function evaluateComparativeTrial(trial, subsets) {
  if (trial.status !== 'completed')
    return { policy: COMPARATIVE_POLICY, excluded: trial.reason || trial.status };
  const all = Object.values(subsets).flat();
  const cache = new Map(
    trial.observations.map((o) => [
      o.embedding,
      new Map(all.map((e) => [e.templateId, cosineSimilarity(o.embedding, e.embedding)])),
    ]),
  );
  const rank = (embedding, entries, threshold) =>
    rankScores(
      entries.map((entry) => ({ entry, score: cache.get(embedding).get(entry.templateId) })),
      threshold,
    );
  const modes = Object.fromEntries(
    Object.entries(subsets).map(([mode, entries]) => [
      mode,
      [{ threshold: 0.85, ...replayTrial(trial, entries, 0.85, rank) }],
    ]),
  );
  for (const rows of Object.values(modes)) {
    const row = rows[0];
    row.diagnosticReason =
      row.decision?.outcome === 'IDENTIFIED'
        ? 'IDENTIFIED'
        : row.scores.every((s) => s.similarity < 0.85)
          ? 'BELOW_THRESHOLD'
          : row.scores.at(-1)?.ranking.classification === 'AMBIGUOUS'
            ? row.scores.at(-1).ranking.aboveThresholdCount > 1
              ? 'MULTIPLE_ABOVE_THRESHOLD'
              : 'INSUFFICIENT_MARGIN'
            : 'UNSTABLE';
    row.supportingCandidate =
      row.decision?.outcome === 'IDENTIFIED'
        ? (row.scores.find(
            (s) =>
              s.candidate.templateId === row.decision.templateId &&
              s.similarity === row.decision.similarity,
          )?.candidate ?? null)
        : (row.scores.at(-1)?.candidate ?? null);
  }
  return {
    policy: COMPARATIVE_POLICY,
    protocolVersion: 1,
    planId: trial.referencePlan.id,
    planFingerprint: trial.referencePlan.fingerprint,
    threshold: 0.85,
    evaluatedAt: new Date().toISOString(),
    modes,
  };
}

function validateComparativeReport(trial) {
  const r = trial.report;
  if (r.policy !== COMPARATIVE_POLICY) throw new Error('Invalid comparative report policy.');
  if (trial.status !== 'completed') {
    if (typeof r.excluded !== 'string' || !r.excluded)
      throw new Error('Invalid failed comparison.');
    return;
  }
  if (
    r.excluded ||
    r.protocolVersion !== 1 ||
    r.threshold !== 0.85 ||
    r.planId !== trial.referencePlan.id ||
    r.planFingerprint !== trial.referencePlan.fingerprint ||
    !Number.isFinite(Date.parse(r.evaluatedAt)) ||
    JSON.stringify(Object.keys(r.modes ?? {}).sort()) !==
      JSON.stringify(trial.referencePlan.modes.map(String).sort())
  )
    throw new Error('Invalid comparative report.');
  for (const [mode, rows] of Object.entries(r.modes)) {
    const allowed = trial.referencePlan.people.flatMap((p) =>
      p.samples.slice(0, Number(mode)).map((s) => ({ ...s, personId: p.personId })),
    );
    const candidateValid = (c) =>
      c &&
      allowed.some(
        (s) =>
          s.personId === c.personId &&
          s.templateId === c.templateId &&
          s.templateVersion === c.templateVersion,
      );
    const finiteScore = (s) => Number.isFinite(s) && s >= -1.00001 && s <= 1.00001;
    const row = rows?.[0];
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      row.threshold !== 0.85 ||
      !Array.isArray(row.scores) ||
      row.scores.length !== 3 ||
      row.scores.some(
        (s) =>
          !finiteScore(s.similarity) ||
          !candidateValid(s.candidate) ||
          s.candidate.similarity !== s.similarity ||
          (s.expected !== null && !finiteScore(s.expected)) ||
          (s.competing !== null && !finiteScore(s.competing)),
      )
    )
      throw new Error('Invalid comparative scores.');
    const window = createIdentificationWindow();
    let replayed;
    for (const [i, s] of row.scores.entries()) {
      const ranking = s.ranking;
      if (
        !ranking ||
        ranking.similarity !== s.similarity ||
        !Number.isInteger(ranking.aboveThresholdCount) ||
        ranking.aboveThresholdCount < 0 ||
        ranking.aboveThresholdCount > trial.referencePlan.people.length ||
        (trial.referencePlan.people.length === 1
          ? ranking.runnerUpSimilarity !== null
          : !finiteScore(ranking.runnerUpSimilarity)) ||
        (ranking.runnerUpSimilarity !== null && ranking.runnerUpSimilarity > ranking.similarity) ||
        ranking.margin !==
          (ranking.runnerUpSimilarity === null
            ? null
            : ranking.similarity - ranking.runnerUpSimilarity) ||
        ranking.aboveThresholdCount !==
          (ranking.similarity < 0.85
            ? 0
            : ranking.runnerUpSimilarity >= 0.85
              ? Math.max(2, ranking.aboveThresholdCount)
              : 1) ||
        ranking.classification !==
          classifyRanking(
            ranking.similarity,
            ranking.runnerUpSimilarity,
            ranking.aboveThresholdCount,
          ) ||
        (ranking.classification === 'IDENTIFIED'
          ? ranking.personId !== s.candidate.personId ||
            ranking.templateId !== s.candidate.templateId ||
            ranking.templateVersion !== s.candidate.templateVersion
          : [ranking.personId, ranking.templateId, ranking.templateVersion].some(
              (v) => v !== null,
            )) ||
        (trial.personId === null ? s.expected !== null : !finiteScore(s.expected)) ||
        (s.expected !== null && s.expected > s.similarity) ||
        (s.competing !== null && s.competing > s.similarity)
      )
        throw new Error('Invalid comparative ranking evidence.');
      replayed = window.observe(ranking, trial.observations[i].timestamp, 'evaluation');
    }
    if (JSON.stringify(replayed ?? null) !== JSON.stringify(row.decision))
      throw new Error('Invalid comparative stability evidence.');
    const accepted = row.decision?.outcome === 'IDENTIFIED' ? row.decision.personId : null;
    const expected = trial.personId
      ? accepted === trial.personId
        ? 'correct'
        : accepted
          ? 'wrong_person'
          : 'missed'
      : accepted
        ? 'unenrolled_accepted'
        : 'unenrolled_rejected';
    if (
      row.category !== expected ||
      row.predictedPersonId !== accepted ||
      !candidateValid(row.supportingCandidate) ||
      (accepted &&
        (row.scores.some((s) => s.candidate.personId !== accepted || s.similarity < 0.85) ||
          !allowed.some(
            (s) => s.personId === accepted && s.templateId === row.decision.templateId,
          )))
    )
      throw new Error('Invalid comparative outcome.');
  }
}

export function comparativeSummary(trials, modes) {
  const reports = trials
    .filter((t) => t.status === 'completed' && t.report?.modes)
    .map((t) => t.report);
  const totals = Object.fromEntries(
    modes.map((m) => [m, evaluationSummary(reports, String(m), 0.85)]),
  );
  const transitions = modes.slice(1).map((m, i) => {
    const previous = modes[i];
    const counts = { correctedMisses: 0, newlyMissed: 0, newlyWrong: 0, newlyAcceptedUnknown: 0 };
    for (const r of reports) {
      const a = r.modes[String(previous)]?.[0]?.category,
        b = r.modes[String(m)]?.[0]?.category;
      if (a === 'missed' && b === 'correct') counts.correctedMisses++;
      if (a !== 'missed' && b === 'missed') counts.newlyMissed++;
      if (a !== 'wrong_person' && b === 'wrong_person') counts.newlyWrong++;
      if (a === 'unenrolled_rejected' && b === 'unenrolled_accepted') counts.newlyAcceptedUnknown++;
    }
    return { from: previous, to: m, ...counts };
  });
  return { totals, transitions };
}

export function exportComparativeTrials(trials) {
  return {
    policy: COMPARATIVE_POLICY,
    protocolVersion: 1,
    exportedAt: new Date().toISOString(),
    trials: trials.map(({ observations, ...trial }) => ({
      ...trial,
      observationCount: observations.length,
    })),
    groups: [...new Set(trials.map((t) => t.referencePlan.id))].map((id) => {
      const group = trials.filter((t) => t.referencePlan.id === id);
      return {
        planId: id,
        cohortSize: group[0].referencePlan.people.length,
        ...comparativeSummary(group, group[0].referencePlan.modes),
      };
    }),
  };
}
