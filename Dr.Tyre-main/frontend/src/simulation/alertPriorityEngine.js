/**
 * alertPriorityEngine.js — Alert Priority Ranking, Fusion & Deduplication Engine
 *
 * Replaces the minimal alertPriority.js with a full weighted ranking system.
 *
 * PriorityScore = wS×Severity + wU×Urgency + wR×RaceImpact + wC×Confidence + wA×Actionability
 *
 * All component scores are normalized to [0, 100].
 * Safety-critical alerts (severity >= 80) cannot be suppressed by low confidence.
 */

// ── Alert Categories ─────────────────────────────────────────────
export const AlertCategory = {
  CRITICAL: 'CRITICAL',       // Red
  WARNING: 'WARNING',         // Orange
  OPPORTUNITY: 'OPPORTUNITY', // Green
  INFORMATION: 'INFORMATION'  // Blue
};

export const CATEGORY_COLORS = {
  CRITICAL: '#dc2626',
  WARNING: '#ea580c',
  OPPORTUNITY: '#16a34a',
  INFORMATION: '#2563eb'
};

export const CATEGORY_BG = {
  CRITICAL: 'rgba(220, 38, 38, 0.08)',
  WARNING: 'rgba(234, 88, 12, 0.08)',
  OPPORTUNITY: 'rgba(22, 163, 74, 0.08)',
  INFORMATION: 'rgba(37, 99, 235, 0.08)'
};

// ── Alert Status Lifecycle ───────────────────────────────────────
export const AlertStatus = {
  NEW: 'NEW',
  ACTIVE: 'ACTIVE',
  IMPROVING: 'IMPROVING',
  RESOLVED: 'RESOLVED',
  EXPIRED: 'EXPIRED'
};

// ── Configurable Priority Weights ────────────────────────────────
export const PRIORITY_WEIGHTS = {
  wSeverity: 0.30,
  wUrgency: 0.25,
  wRaceImpact: 0.20,
  wConfidence: 0.10,
  wActionability: 0.15
};

// ── Radio Call Types ─────────────────────────────────────────────
export const RadioCallType = {
  MANAGEMENT: 'MANAGEMENT',
  ATTACK: 'ATTACK',
  DEFEND: 'DEFEND',
  STRATEGY: 'STRATEGY'
};

// ── Fusion Groups ────────────────────────────────────────────────
// Alerts sharing a causal root are merged into a single parent alert
const FUSION_GROUPS = {
  THERMAL_GROUP: ['THERMAL_RISK', 'TYRE_DEGRADATION', 'DRIVER_BEHAVIOUR'],
  CLIFF_GROUP: ['TYRE_CLIFF', 'TYRE_DEGRADATION', 'EXTEND_STINT'],
  PIT_GROUP: ['UNDERCUT_OPPORTUNITY', 'TRAFFIC', 'COMPETITOR_THREAT']
};

/**
 * Calculates the weighted priority score for an alert.
 * All inputs expected in [0, 100].
 *
 * @param {Object} alert - Alert with severity, urgency, raceImpact, confidence, actionability
 * @returns {number} Priority score [0, 100]
 */
export function calculatePriorityScore(alert) {
  const w = PRIORITY_WEIGHTS;
  const raw =
    w.wSeverity * (alert.severity || 0) +
    w.wUrgency * (alert.urgency || 0) +
    w.wRaceImpact * (alert.raceImpact || 0) +
    w.wConfidence * (alert.confidence || 50) +
    w.wActionability * (alert.actionability || 0);

  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * Assigns a category based on severity and alert type.
 *
 * @param {string} type - Event type
 * @param {number} severity - Severity score [0, 100]
 * @returns {string} AlertCategory value
 */
export function categorizeAlert(type, severity) {
  const opportunityTypes = [
    'UNDERCUT_OPPORTUNITY', 'OVERTAKE_OPPORTUNITY', 'EXTEND_STINT', 'TYRE_RECOVERY'
  ];

  if (opportunityTypes.includes(type)) {
    // Opportunities can still be critical if extremely high severity
    if (severity >= 85) return AlertCategory.WARNING;
    return AlertCategory.OPPORTUNITY;
  }

  if (severity >= 75) return AlertCategory.CRITICAL;
  if (severity >= 45) return AlertCategory.WARNING;
  if (severity >= 20) return AlertCategory.INFORMATION;
  return AlertCategory.INFORMATION;
}

/**
 * Ranks an array of alerts by PriorityScore descending.
 * Safety-critical alerts (severity >= 80) are guaranteed top positions
 * regardless of confidence.
 *
 * @param {Array} alerts - Array of alert objects
 * @returns {Array} Sorted alerts with priorityScore attached
 */
export function rankAlerts(alerts) {
  return alerts
    .map(alert => {
      let score = calculatePriorityScore(alert);

      // Safety override: critical severity must not be suppressed by low confidence
      if (alert.severity >= 80 && alert.confidence < 50) {
        // Boost score to ensure critical alerts remain visible
        score = Math.max(score, 70);
      }

      return { ...alert, priorityScore: score };
    })
    .sort((a, b) => {
      // Safety-critical first
      const aCritical = a.severity >= 80;
      const bCritical = b.severity >= 80;
      if (aCritical && !bCritical) return -1;
      if (!aCritical && bCritical) return 1;

      // Then by priority score
      return b.priorityScore - a.priorityScore;
    });
}

/**
 * Selects the top N alerts for display, ensuring category diversity.
 * At least 1 opportunity is included if available and max allows.
 *
 * @param {Array} ranked - Sorted alerts from rankAlerts()
 * @param {number} max - Maximum visible alerts (default 5)
 * @returns {Array} Top alerts for display
 */
export function selectTopAlerts(ranked, max = 5) {
  if (ranked.length <= max) return ranked;

  const selected = [];
  const remaining = [...ranked];

  // 1. Take all CRITICAL alerts (up to max - 1 to leave room)
  const critical = remaining.filter(a => a.category === AlertCategory.CRITICAL);
  for (const c of critical) {
    if (selected.length < max - 1) {
      selected.push(c);
      remaining.splice(remaining.indexOf(c), 1);
    }
  }

  // 2. Ensure at least 1 opportunity if available
  if (!selected.some(a => a.category === AlertCategory.OPPORTUNITY)) {
    const opp = remaining.find(a => a.category === AlertCategory.OPPORTUNITY);
    if (opp && selected.length < max) {
      selected.push(opp);
      remaining.splice(remaining.indexOf(opp), 1);
    }
  }

  // 3. Fill remaining slots by priority score
  for (const r of remaining) {
    if (selected.length >= max) break;
    selected.push(r);
  }

  // Re-sort by priority score
  return selected.sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Fuses related alerts that are manifestations of the same underlying problem.
 * E.g. Temperature↑ + Sliding↑ + Degradation↑ → single THERMAL_DEGRADATION alert.
 *
 * @param {Array} rawAlerts - Unfiltered raw event detections
 * @returns {Array} Fused alert list (fewer alerts, richer detail)
 */
export function fuseRelatedAlerts(rawAlerts) {
  if (rawAlerts.length <= 1) return rawAlerts;

  const alertsByType = {};
  for (const a of rawAlerts) {
    alertsByType[a.type] = a;
  }

  const fused = [];
  const consumed = new Set();

  // Check each fusion group
  for (const [groupName, memberTypes] of Object.entries(FUSION_GROUPS)) {
    const members = memberTypes
      .filter(t => alertsByType[t] && !consumed.has(t))
      .map(t => alertsByType[t]);

    if (members.length >= 2) {
      // Merge: pick the highest-severity member as the parent
      const parent = members.reduce((best, m) => (m.severity > best.severity) ? m : best, members[0]);

      // Collect contributing factors from all members
      const allFactors = [];
      for (const m of members) {
        if (m !== parent && m.relatedFactors) {
          allFactors.push(...m.relatedFactors);
        }
        if (m !== parent && m.shortMessage) {
          allFactors.push({ factor: `${m.title}: ${m.shortMessage}`, contribution: Math.round(m.severity / 4) });
        }
      }

      // Merge into parent
      const fusedAlert = {
        ...parent,
        relatedFactors: [
          ...(parent.relatedFactors || []),
          ...allFactors
        ],
        fusedFrom: members.map(m => m.type),
        shortMessage: parent.shortMessage + (members.length > 1
          ? ` (${members.length} related signals fused)`
          : '')
      };

      // Recalculate severity as max of group
      fusedAlert.severity = Math.max(...members.map(m => m.severity));
      fusedAlert.urgency = Math.max(...members.map(m => m.urgency));
      fusedAlert.category = categorizeAlert(fusedAlert.type, fusedAlert.severity);

      fused.push(fusedAlert);
      members.forEach(m => consumed.add(m.type));
    }
  }

  // Add non-consumed alerts
  for (const a of rawAlerts) {
    if (!consumed.has(a.type)) {
      fused.push(a);
    }
  }

  return fused;
}

/**
 * Deduplicates alerts against existing active alerts.
 * Matches by stable id (type + carId + region).
 * Updates existing alerts internally rather than creating duplicates.
 *
 * @param {Array} newAlerts - Freshly detected alerts
 * @param {Array} existing - Currently tracked alerts
 * @returns {Array} Merged alert list with lifecycle updates
 */
export function deduplicateAndUpdateLifecycle(newAlerts, existing, currentLap) {
  const existingById = {};
  for (const e of existing) {
    existingById[e.id] = e;
  }

  const result = [];
  const processedIds = new Set();

  // Process new detections
  for (const newAlert of newAlerts) {
    processedIds.add(newAlert.id);
    const prev = existingById[newAlert.id];

    if (prev) {
      // Update existing alert
      const updated = { ...newAlert };
      updated.statusHistory = [...(prev.statusHistory || [])];
      updated.timestamp = prev.timestamp || newAlert.timestamp;
      updated.lapsActive = (prev.lapsActive || 0) + (currentLap - (prev.lastSeenLap || currentLap - 1));
      updated.lastSeenLap = currentLap;

      // Preserve original prediction if still pending evaluation
      if (prev.prediction && prev.prediction.actual === undefined) {
        updated.prediction = prev.prediction;
      }

      // Determine lifecycle transition
      if (newAlert.severity < prev.severity * 0.7) {
        updated.status = AlertStatus.IMPROVING;
      } else if (newAlert.severity > prev.severity) {
        updated.status = AlertStatus.ACTIVE;
      } else {
        updated.status = prev.status === AlertStatus.NEW ? AlertStatus.ACTIVE : prev.status;
      }

      // Track prediction outcomes
      if (updated.prediction && updated.prediction.createdAtLap &&
          currentLap >= updated.prediction.createdAtLap + 2 &&
          updated.prediction.actual === undefined) {
        // Mark for learning log recording
        updated._needsActualRecording = true;
      }

      if (updated.status !== prev.status) {
        updated.statusHistory.push({ status: updated.status, lap: currentLap });
      }

      result.push(updated);
    } else {
      // New alert
      newAlert.status = AlertStatus.NEW;
      newAlert.statusHistory = [{ status: AlertStatus.NEW, lap: currentLap }];
      result.push(newAlert);
    }
  }

  // Handle alerts that are no longer detected
  for (const prev of existing) {
    if (!processedIds.has(prev.id)) {
      if (prev.status === AlertStatus.RESOLVED || prev.status === AlertStatus.EXPIRED) {
        // Already terminal, keep for learning log but don't display
        continue;
      }

      // Check if it should be resolved or expired
      const prevLap = prev.timestamp || 0;
      const age = currentLap - prevLap;

      if (age > 5) {
        // Expired: opportunity window has passed
        const expired = { ...prev, status: AlertStatus.EXPIRED };
        expired.statusHistory = [...(prev.statusHistory || []), { status: AlertStatus.EXPIRED, lap: currentLap }];
        result.push(expired);
      } else {
        // Resolved: condition no longer relevant
        const resolved = { ...prev, status: AlertStatus.RESOLVED };
        resolved.statusHistory = [...(prev.statusHistory || []), { status: AlertStatus.RESOLVED, lap: currentLap }];
        result.push(resolved);
      }
    }
  }

  return result;
}

// Legacy compatibility exports (for existing raceIntelligencePage.js imports)
export const AlertPriority = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4
};

export function sortAlertsByPriority(alerts) {
  return rankAlerts(alerts);
}

export function filterTopAlerts(alerts, maxCount = 5) {
  const ranked = rankAlerts(alerts);
  return selectTopAlerts(ranked, maxCount);
}
