import React from 'react';
import './DiffStats.css';

const DiffStats = ({ stats }) => {
  if (!stats) return null;

  const { additions = 0, deletions = 0, changes = 0, files = 0 } = stats;
  const total = additions + deletions;
  const additionPercent = total > 0 ? (additions / total) * 100 : 0;
  const hasAdditions = Number(additions) > 0;
  const hasDeletions = Number(deletions) > 0;

  return (
    <div className="diff-stats">
      <div className="stat-item">
        <span className="stat-value">{files}</span>
        <span className="stat-label">files</span>
      </div>
      {hasAdditions && (
        <div className="stat-item additions">
          <span className="stat-value">+{additions}</span>
          <span className="stat-label">additions</span>
        </div>
      )}
      {hasDeletions && (
        <div className="stat-item deletions">
          <span className="stat-value">-{deletions}</span>
          <span className="stat-label">deletions</span>
        </div>
      )}
      {stats.semanticReduction && (
        <div className="stat-item reduction">
          <span className="stat-value">{stats.semanticReduction}%</span>
          <span className="stat-label">reduction</span>
        </div>
      )}
      <div className="diff-bar">
        <div 
          className="diff-bar-additions" 
          style={{ width: `${additionPercent}%` }}
        ></div>
        {hasDeletions && (
          <div 
            className="diff-bar-deletions" 
            style={{ width: `${100 - additionPercent}%` }}
          ></div>
        )}
      </div>
    </div>
  );
};

export default DiffStats;
