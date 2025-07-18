import React, { useState, useEffect, useRef } from 'react';
import ReviewableFileTree from './ReviewableFileTree';
import SmartDiffView from './SmartDiffView';
import EnhancedDiffView from './EnhancedDiffView';
import CollapsibleHeader from './CollapsibleHeader';
import useKeyboardNavigation from '../hooks/useKeyboardNavigation';
import './SmartDiffViewer.css';

const SmartDiffViewer = ({ data }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [reviewState, setReviewState] = useState({});
  const [expandedSections, setExpandedSections] = useState({
    refactorings: true,
    moves: true,
    duplications: true,
    noise: false,
    semanticView: false,
    autoAdvance: false
  });

  const { metadata, diff, type } = data;
  
  // Extract PR info from metadata
  const prInfo = metadata && metadata.owner && metadata.repo && (metadata.number || metadata.pr) ? {
    owner: metadata.owner,
    repo: metadata.repo,
    number: metadata.number || metadata.pr
  } : null;
  
  // Merge metadata files with diff files
  const files = diff.files?.map(diffFile => {
    const metadataFile = metadata.files?.find(f => 
      f.filename === diffFile.path || f.filename === diffFile.filename
    );
    
    return {
      ...diffFile,
      ...metadataFile,
      filename: diffFile.filename || diffFile.path,
      path: diffFile.path || diffFile.filename,
      patch: metadataFile?.patch || diffFile.patch,
      analysis: diffFile.analysis // Include smart analysis if available
    };
  }) || [];

  // Auto-select first file
  useEffect(() => {
    if (files.length > 0 && !selectedFile) {
      console.log('🔍 First file structure:', files[0]);
      console.log('🔍 Has analysis?', !!files[0].analysis);
      console.log('🔍 Has patch?', !!files[0].patch);
      setSelectedFile(files[0]);
    }
  }, [files]);

  // Toggle review state for a file
  const toggleFileReview = (file) => {
    const newState = !reviewState[file.path];
    setReviewState(prev => ({
      ...prev,
      [file.path]: newState
    }));
    
    // If marking as reviewed, potentially auto-advance
    if (newState && expandedSections.autoAdvance) {
      const currentIndex = files.findIndex(f => f.path === file.path);
      const nextIndex = findNextUnreviewed(currentIndex);
      if (nextIndex >= 0) {
        setTimeout(() => setSelectedFile(files[nextIndex]), 300);
      }
    }
  };

  // Toggle section visibility
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Find next unreviewed file
  const findNextUnreviewed = (startIndex) => {
    for (let i = startIndex + 1; i < files.length; i++) {
      if (!reviewState[files[i].path]) return i;
    }
    for (let i = 0; i <= startIndex; i++) {
      if (!reviewState[files[i].path]) return i;
    }
    return -1;
  };

  // Use keyboard navigation
  useKeyboardNavigation({
    files,
    currentFile: selectedFile,
    reviewState,
    onFileSelect: setSelectedFile,
    onToggleReview: toggleFileReview,
    onToggleSection: toggleSection
  });

  // Calculate review progress
  const reviewProgress = {
    reviewed: Object.values(reviewState).filter(Boolean).length,
    total: files.length,
    percentage: files.length > 0 
      ? Math.round((Object.values(reviewState).filter(Boolean).length / files.length) * 100)
      : 0
  };

  return (
    <div className="smart-diff-viewer">
      {/* Header with PR info and progress */}
      <div className="viewer-header">
        <div className="pr-info">
          <h2>{metadata?.title || 'Diff Viewer'}</h2>
          {metadata?.description && (
            <p className="pr-description">{metadata.description}</p>
          )}
        </div>
        
        <div className="overall-stats">
          <div className="stat-item">
            <span className="stat-label">Files</span>
            <span className="stat-value">{files.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Progress</span>
            <span className="stat-value">{reviewProgress.percentage}%</span>
          </div>
          {diff.stats?.noiseReduction && (
            <div className="stat-item">
              <span className="stat-label">Noise Reduced</span>
              <span className="stat-value">{diff.stats.noiseReduction}%</span>
            </div>
          )}
        </div>
      </div>

      <div className="viewer-content">
        {/* Left panel - File tree with review state */}
        <div className="left-panel">
          <ReviewableFileTree
            files={files}
            selectedFile={selectedFile}
            onFileSelect={setSelectedFile}
            prInfo={prInfo}
          />
        </div>

        {/* Right panel - Diff view */}
        <div className="right-panel">
          {selectedFile ? (
            <>
              <CollapsibleHeader 
                title={selectedFile.path}
                stats={{
                  additions: selectedFile.additions,
                  deletions: selectedFile.deletions,
                  reviewed: reviewState[selectedFile.path]
                }}
                onToggleReview={() => toggleFileReview(selectedFile)}
              />
              
              {/* Show smart diff if available with proper structure, otherwise standard diff */}
              {selectedFile.analysis && expandedSections.semanticView && 
               selectedFile.analysis.significantChanges && selectedFile.analysis.significantChanges.length > 0 ? (
                <SmartDiffView 
                  analysis={selectedFile.analysis}
                  file={selectedFile}
                  expandedSections={expandedSections}
                  onToggleSection={toggleSection}
                />
              ) : (
                <div style={{ height: '100%', overflow: 'auto', backgroundColor: '#1e1e1e' }}>
                  {selectedFile.patch ? (
                    <div style={{ padding: '20px', fontFamily: 'Consolas, Monaco, monospace', fontSize: '13px' }}>
                      {selectedFile.patch.split('\n').map((line, idx) => {
                        let style = { margin: 0, padding: '2px 5px', whiteSpace: 'pre' };
                        
                        if (line.startsWith('+')) {
                          style.backgroundColor = '#28a745';
                          style.color = '#fff';
                        } else if (line.startsWith('-')) {
                          style.backgroundColor = '#dc3545';
                          style.color = '#fff';
                        } else if (line.startsWith('@@')) {
                          style.backgroundColor = '#0366d6';
                          style.color = '#fff';
                          style.fontWeight = 'bold';
                        } else {
                          style.color = '#d4d4d4';
                        }
                        
                        return (
                          <div key={idx} style={style}>
                            {line || ' '}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EnhancedDiffView 
                      file={selectedFile}
                      diffData={{
                        type: selectedFile.diffType || 'text',
                        ...selectedFile
                      }}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="no-file-selected">
              <p>Select a file to view changes</p>
              <p className="hint">Press <kbd>?</kbd> for keyboard shortcuts</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick settings panel */}
      <div className="viewer-settings">
        <label>
          <input
            type="checkbox"
            checked={expandedSections.semanticView}
            onChange={() => toggleSection('semanticView')}
          />
          Semantic View
        </label>
        <label>
          <input
            type="checkbox"
            checked={expandedSections.autoAdvance}
            onChange={() => toggleSection('autoAdvance')}
          />
          Auto-advance
        </label>
        <label>
          <input
            type="checkbox"
            checked={!expandedSections.noise}
            onChange={() => toggleSection('noise')}
          />
          Hide Noise
        </label>
      </div>
    </div>
  );
};

export default SmartDiffViewer;