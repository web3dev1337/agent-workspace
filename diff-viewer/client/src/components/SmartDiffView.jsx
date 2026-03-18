import React, { useState, useMemo } from 'react';
import './SmartDiffView.css';

const SmartDiffView = ({ analysis, file }) => {
  const [expandedSections, setExpandedSections] = useState({
    noise: false,
    refactorings: true,
    moves: true,
    duplications: true
  });

  const [hiddenChanges, setHiddenChanges] = useState(new Set());

  // Group changes by type for better organization
  const groupedChanges = useMemo(() => {
    if (!analysis || !analysis.significantChanges || analysis.significantChanges.length === 0) return {};

    const groups = {
      major: [],
      moderate: [],
      minor: [],
      noise: []
    };

    analysis.significantChanges.forEach(change => {
      const group = change.classification || 'moderate';
      groups[group].push(change);
    });

    return groups;
  }, [analysis]);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const toggleChange = (changeId) => {
    setHiddenChanges(prev => {
      const next = new Set(prev);
      if (next.has(changeId)) {
        next.delete(changeId);
      } else {
        next.add(changeId);
      }
      return next;
    });
  };

  if (!analysis) return null;
  
  console.log('🔍 SmartDiffView analysis:', analysis);
  console.log('📊 File data:', file);
  console.log('🔍 significantChanges:', analysis.significantChanges);
  console.log('🔍 Has patch?', !!file.patch);

  return (
    <div className="smart-diff-view">
      {/* Summary Header */}
      <div className="diff-summary">
        <h3>Smart Diff Analysis</h3>
        <p className="summary-text">{analysis.summary}</p>
        
        <div className="diff-stats">
          <div className="stat">
            <span className="stat-value">{analysis.netNewLogic || 0}</span>
            <span className="stat-label">New Logic Lines</span>
          </div>
          <div className="stat">
            <span className="stat-value">{analysis.stats?.noiseReduction || 0}%</span>
            <span className="stat-label">Noise Filtered</span>
          </div>
          <div className="stat">
            <span className="stat-value">{analysis.stats?.significantLinesChanged || analysis.stats?.significant || 0}</span>
            <span className="stat-label">Significant Changes</span>
          </div>
        </div>
      </div>

      {/* Refactorings Section */}
      {analysis.refactorings && analysis.refactorings.length > 0 && (
        <div className="diff-section refactorings">
          <div 
            className="section-header"
            onClick={() => toggleSection('refactorings')}
          >
            <span className="toggle-icon">{expandedSections.refactorings ? '▼' : '▶'}</span>
            <h4>Refactorings ({analysis.refactorings.length})</h4>
            <span className="section-hint">Not counted as changes</span>
          </div>
          
          {expandedSections.refactorings && (
            <div className="section-content">
              {analysis.refactorings.map((ref, idx) => (
                <div key={idx} className={`refactoring-item ${ref.type}`}>
                  <span className="ref-type">{ref.type.replace(/_/g, ' ')}</span>
                  {ref.type === 'rename' && (
                    <span className="ref-detail">
                      <code>{ref.from}</code> → <code>{ref.to}</code>
                    </span>
                  )}
                  {ref.type === 'extract_method' && (
                    <span className="ref-detail">
                      Extracted <code>{ref.extracted}</code> from <code>{ref.from}</code>
                    </span>
                  )}
                  {ref.type === 'change_signature' && (
                    <span className="ref-detail">
                      <code>{ref.function}</code> parameters changed
                    </span>
                  )}
                  <span className="confidence">{Math.round(ref.confidence * 100)}% confident</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Moved Code Section */}
      {analysis.movedBlocks && analysis.movedBlocks.length > 0 && (
        <div className="diff-section moved-code">
          <div 
            className="section-header"
            onClick={() => toggleSection('moves')}
          >
            <span className="toggle-icon">{expandedSections.moves ? '▼' : '▶'}</span>
            <h4>Moved Code ({analysis.movedBlocks.length})</h4>
          </div>
          
          {expandedSections.moves && (
            <div className="section-content">
              {analysis.movedBlocks.map((move, idx) => (
                <div key={idx} className="moved-item">
                  <span className="move-unit">{move.unit}</span>
                  <span className="move-detail">
                    Line {move.from.line} → {move.to.line} 
                    ({move.lines} lines)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Duplications Section */}
      {analysis.duplications && analysis.duplications.length > 0 && (
        <div className="diff-section duplications">
          <div 
            className="section-header warning"
            onClick={() => toggleSection('duplications')}
          >
            <span className="toggle-icon">{expandedSections.duplications ? '▼' : '▶'}</span>
            <h4>⚠️ Duplications Detected ({analysis.duplications.length})</h4>
          </div>
          
          {expandedSections.duplications && (
            <div className="section-content">
              {analysis.duplications.map((dup, idx) => (
                <div key={idx} className="duplication-item">
                  <span className="dup-units">{dup.units.join(' & ')}</span>
                  <span className="dup-detail">
                    {Math.round(dup.similarity * 100)}% similar ({dup.lines} lines)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Significant Changes */}
      <div className="diff-section changes">
        <h4>Significant Changes</h4>
        
        {/* Show raw changes if no grouped changes available */}
        {(!groupedChanges.major && !groupedChanges.moderate && !groupedChanges.minor) ? (
          <div className="raw-changes">
            {/* If we have a patch, show it */}
            {file.patch ? (
              <div style={{ 
                backgroundColor: 'var(--bg-primary)', 
                padding: '10px',
                fontFamily: 'monospace',
                fontSize: '13px'
              }}>
                {file.patch.split('\n').map((line, idx) => {
                  let style = {
                    margin: 0,
                    padding: '2px 5px',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word'
                  };
                  if (line.startsWith('+')) {
                    style.backgroundColor = 'var(--diff-added-bg)';
                    style.color = 'var(--text-primary)';
                  } else if (line.startsWith('-')) {
                    style.backgroundColor = 'var(--diff-removed-bg)';
                    style.color = 'var(--text-primary)';
                  } else if (line.startsWith('@@')) {
                    style.backgroundColor = 'var(--diff-hunk-bg)';
                    style.color = 'var(--text-primary)';
                  } else {
                    style.color = 'var(--text-primary)';
                  }
                  return <div key={idx} style={style}>{line || ' '}</div>;
                })}
              </div>
            ) : analysis.changes ? (
              analysis.changes.filter(c => c.significant !== false).map((change, idx) => (
                <div key={idx} className={`change-item ${change.type}`}>
                  <div className="change-header">
                    <span className="change-icon">{change.type === 'added' ? '+' : change.type === 'deleted' ? '-' : '~'}</span>
                    <span className="change-line">Line {change.line}</span>
                    <pre className="change-content">{change.content}</pre>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '20px', color: 'var(--text-secondary)' }}>
                No significant changes detected. The changes might be formatting or whitespace only.
              </div>
            )}
          </div>
        ) : (
          <>
        {/* Major Changes */}
        {groupedChanges.major?.length > 0 && (
          <div className="change-group major">
            <h5>Major Changes</h5>
            {groupedChanges.major.map((change, idx) => (
              <ChangeItem 
                key={`major-${idx}`}
                change={change}
                isHidden={hiddenChanges.has(`major-${idx}`)}
                onToggle={() => toggleChange(`major-${idx}`)}
              />
            ))}
          </div>
        )}

        {/* Moderate Changes */}
        {groupedChanges.moderate?.length > 0 && (
          <div className="change-group moderate">
            <h5>Moderate Changes</h5>
            {groupedChanges.moderate.map((change, idx) => (
              <ChangeItem 
                key={`moderate-${idx}`}
                change={change}
                isHidden={hiddenChanges.has(`moderate-${idx}`)}
                onToggle={() => toggleChange(`moderate-${idx}`)}
              />
            ))}
          </div>
        )}

        {/* Minor Changes (collapsed by default) */}
        {groupedChanges.minor?.length > 0 && (
          <div className="change-group minor">
            <h5 
              className="collapsible"
              onClick={() => toggleSection('minorChanges')}
            >
              <span className="toggle-icon">{expandedSections.minorChanges ? '▼' : '▶'}</span>
              Minor Changes ({groupedChanges.minor.length})
            </h5>
            {expandedSections.minorChanges && groupedChanges.minor.map((change, idx) => (
              <ChangeItem 
                key={`minor-${idx}`}
                change={change}
                isHidden={hiddenChanges.has(`minor-${idx}`)}
                onToggle={() => toggleChange(`minor-${idx}`)}
              />
            ))}
          </div>
        )}
          </>
        )}
      </div>

      {/* Noise Section (hidden by default) */}
      {analysis.noiseLines > 0 && (
        <div className="diff-section noise">
          <div 
            className="section-header collapsed"
            onClick={() => toggleSection('noise')}
          >
            <span className="toggle-icon">{expandedSections.noise ? '▼' : '▶'}</span>
            <h4>Filtered Noise ({analysis.noiseLines} lines)</h4>
            <span className="section-hint">Formatting, whitespace, etc.</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Individual change item component
const ChangeItem = ({ change, isHidden, onToggle }) => {
  const getChangeIcon = (type) => {
    switch (type) {
      case 'added': return '+';
      case 'deleted': return '-';
      case 'modified': return '~';
      default: return '•';
    }
  };

  const getComplexityBadge = (complexity) => {
    if (complexity > 10) return <span className="complexity-badge high">Complex</span>;
    if (complexity > 5) return <span className="complexity-badge medium">Moderate</span>;
    return null;
  };

  return (
    <div className={`change-item ${change.type} ${isHidden ? 'collapsed' : ''}`}>
      <div className="change-header" onClick={onToggle}>
        <span className="change-icon">{getChangeIcon(change.type)}</span>
        <span className="change-name">{change.name || change.unitType}</span>
        {getComplexityBadge(change.complexity)}
        <span className="change-lines">{change.lines} lines</span>
        {change.similarity && (
          <span className="change-similarity">
            {Math.round((1 - change.similarity) * 100)}% changed
          </span>
        )}
      </div>
      {!isHidden && change.details && (
        <div className="change-details">
          {change.details}
        </div>
      )}
    </div>
  );
};

export default SmartDiffView;
