// Priority Enum for Race Intelligence Alerts
export const AlertPriority = {
  CRITICAL: 1, // e.g. Incoming attack in < 2 laps, massive pace drop
  HIGH: 2,     // e.g. Undercut window open, Overtake probability > 80%
  MEDIUM: 3,   // e.g. Extend stint recommended, general pace advantage
  LOW: 4       // e.g. Informational track evolution
};

/**
 * Sorts an array of alerts by priority and then by time-to-action or magnitude
 * @param {Array} alerts - [{ type: 'OVERTAKE', priority: AlertPriority.HIGH, message: '...', score: 85 }, ...]
 * @returns {Array} Sorted alerts
 */
export function sortAlertsByPriority(alerts) {
  return alerts.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority; // Lower number = higher priority
    }
    // If priorities match, sort by score descending (higher score = more urgent/likely)
    return (b.score || 0) - (a.score || 0);
  });
}

/**
 * Filters out low priority alerts if we have too many critical ones
 */
export function filterTopAlerts(alerts, maxCount = 4) {
  const sorted = sortAlertsByPriority(alerts);
  return sorted.slice(0, maxCount);
}
