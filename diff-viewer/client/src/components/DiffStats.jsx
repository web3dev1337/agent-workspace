import React from 'react';
import './DiffStats.css';

const DiffStats = ({ stats }) => {
  if (!stats) return null;

  const { additions = 0, deletions = 0, changes = 0, files = 0 } = stats;
  const total = additions + deletions;
  const additionPercent = total > 0 ? (additions / total) * 100 : 0;

  return (
    <div className="diff-stats">
      <div className="stat-item">
        <span className="stat-value">{files}</span>
        <span className="stat-label">files</span>
      </div>
      <div className="stat-item additions">
        <span className="stat-value">+{additions}</span>
        <span className="stat-label">additions</span>
      </div>
      {deletions > 0 && (
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
        {deletions > 0 && (
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
