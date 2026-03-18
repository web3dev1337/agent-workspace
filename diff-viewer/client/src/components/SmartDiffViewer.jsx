import React, { useState, useEffect, useRef } from 'react';
import ReviewableFileTree from './ReviewableFileTree';
import SmartDiffView from './SmartDiffView';
import EnhancedDiffView from './EnhancedDiffView';
import RichDiffView from './RichDiffView';
import MarkdownSideBySide from './MarkdownSideBySide';
import useKeyboardNavigation from '../hooks/useKeyboardNavigation';
import { useTheme } from '../context/theme';
import axios from 'axios';
import './SmartDiffViewer.css';

const isMarkdownFile = (path) => {
  const lower = String(path || '').toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
};

const SmartDiffViewer = ({ data, initialFilePath = '' }) => {
  const { theme, setTheme } = useTheme();
  const [selectedFile, setSelectedFile] = useState(null);
  const [reviewState, setReviewState] = useState({});
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeOk, setMergeOk] = useState(false);
  const [mergeError, setMergeError] = useState('');

  // Detect embed mode from URL param
  const isEmbedded = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('embed') === '1';

  const [expandedSections, setExpandedSections] = useState(() => {
    const defaults = {
      refactorings: true,
      moves: true,
      duplications: true,
      noise: false,
      richDiff: true,
      semanticView: true,
      autoAdvance: true,
      scrollWheelAdvance: true,
      markdownRender: true
    };
    try {
      const stored = window.localStorage.getItem('diffViewer.settings');
      if (stored) return { ...defaults, ...JSON.parse(stored) };
    } catch {}
    return defaults;
  });

  useEffect(() => {
    try { window.localStorage.setItem('diffViewer.settings', JSON.stringify(expandedSections)); } catch {}
  }, [expandedSections]);

  const { metadata, diff, type } = data;
  const diffScrollRef = useRef(null);
  const lastWheelNavAtRef = useRef(0);
  const pendingScrollEdgeRef = useRef(null); // 'top' | 'bottom' | null
  
  // Extract PR info from metadata
  const prInfo = metadata && metadata.owner && metadata.repo && (metadata.number || metadata.pr) ? {
    owner: metadata.owner,
    repo: metadata.repo,
    number: metadata.number || metadata.pr
  } : null;

  const prUrl = prInfo
    ? `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.number}`
    : '';

  const prTitle = String(diff?.metadata?.pr?.title || metadata?.pr?.title || metadata?.title || 'Diff Viewer');

  const mergePullRequest = async () => {
    if (!prInfo) return;
    if (mergeBusy) return;
    setMergeError('');

    if (!window.confirm(`Merge PR?\n${prUrl}`)) return;

    setMergeBusy(true);
    try {
      await axios.post(`/github/pr/${prInfo.owner}/${prInfo.repo}/${prInfo.number}/merge`, {
        method: 'merge'
      });
      setMergeOk(true);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to merge PR';
      setMergeError(String(msg));
      setMergeOk(false);
    } finally {
      setMergeBusy(false);
    }
  };
  
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

  // Auto-select initial file (URL deep link), else first file
  useEffect(() => {
    if (files.length > 0 && !selectedFile) {
      const target = String(initialFilePath || '').trim();
      if (target) {
        const match = files.find((f) => f?.path === target || f?.filename === target);
        if (match) {
          setSelectedFile(match);
          return;
        }
      }

      console.log('🔍 First file structure:', files[0]);
      console.log('🔍 Has analysis?', !!files[0].analysis);
      console.log('🔍 Has patch?', !!files[0].patch);
      setSelectedFile(files[0]);
    }
  }, [files, initialFilePath]);

  // When switching files via wheel navigation, adjust scroll to the correct edge.
  useEffect(() => {
    const edge = pendingScrollEdgeRef.current;
    if (!edge) return;

    pendingScrollEdgeRef.current = null;
    const el = diffScrollRef.current;
    if (!el) return;

    // Wait for the next paint so the new content is in the DOM.
    requestAnimationFrame(() => {
      if (edge === 'top') {
        el.scrollTop = 0;
      } else if (edge === 'bottom') {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, [selectedFile?.path]);

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

  const selectAdjacentFile = (direction) => {
    if (!selectedFile) return;
    const currentIndex = files.findIndex(f => f.path === selectedFile.path);
    if (currentIndex < 0) return;

    if (direction === 'next' && currentIndex < files.length - 1) {
      pendingScrollEdgeRef.current = 'top';
      setSelectedFile(files[currentIndex + 1]);
    } else if (direction === 'prev' && currentIndex > 0) {
      pendingScrollEdgeRef.current = 'bottom';
      setSelectedFile(files[currentIndex - 1]);
    }
  };

  const handleDiffWheel = (e) => {
    if (!expandedSections.scrollWheelAdvance) return;
    if (!selectedFile) return;

    const el = diffScrollRef.current;
    if (!el) return;

    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;

    // Only navigate when user tries to scroll past the boundary.
    const isTryingToGoNext = e.deltaY > 0;
    const isTryingToGoPrev = e.deltaY < 0;
    if ((isTryingToGoNext && !atBottom) || (isTryingToGoPrev && !atTop)) {
      return;
    }

    // Debounce to avoid accidental rapid switching.
    const now = Date.now();
    if (now - lastWheelNavAtRef.current < 500) return;
    lastWheelNavAtRef.current = now;

    if (isTryingToGoNext && atBottom) {
      e.preventDefault();
      selectAdjacentFile('next');
    } else if (isTryingToGoPrev && atTop) {
      e.preventDefault();
      selectAdjacentFile('prev');
    }
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
    <div className={`smart-diff-viewer ${isEmbedded ? 'embedded' : ''}`}>
      {/* Header with PR info and progress - hidden in embed mode */}
      {!isEmbedded && (
        <div className="viewer-header">
          <div className="pr-info">
            <h2>{prTitle}</h2>
            {metadata?.description && (
              <p className="pr-description">{metadata.description}</p>
            )}
            {!!mergeError && (
              <p className="pr-description" style={{ color: 'var(--accent-danger)' }}>
                {mergeError}
              </p>
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

          <div className="viewer-actions">
            {prInfo && (
              <>
                <a
                  className="viewer-action-btn"
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open PR on GitHub"
                >
                  ↗ PR
                </a>
                <button
                  className="viewer-action-btn viewer-action-merge-btn"
                  onClick={mergePullRequest}
                  title={mergeOk ? 'PR merged' : 'Merge PR'}
                type="button"
                disabled={mergeBusy || mergeOk}
              >
                {mergeOk ? 'Merged' : (mergeBusy ? 'Merging…' : '✅ Merge')}
              </button>
            </>
          )}
          <button
            className="viewer-action-btn"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title="Toggle theme"
            type="button"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </div>
      )}

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
              <div className="file-header-bar">
                <div className="file-header-title" title={selectedFile.path}>
                  {selectedFile.path}
                </div>
                <div className="file-header-meta">
                  {(selectedFile.additions || 0) > 0 && (
                    <span className="file-header-badge additions">+{selectedFile.additions}</span>
                  )}
                  {(selectedFile.deletions || 0) > 0 && (
                    <span className="file-header-badge deletions">-{selectedFile.deletions}</span>
                  )}
                  <button
                    type="button"
                    className="file-header-badge file-header-review"
                    onClick={() => toggleFileReview(selectedFile)}
                    title="Toggle reviewed"
                  >
                    {reviewState[selectedFile.path] ? 'Reviewed' : 'Mark reviewed'}
                  </button>
                </div>
              </div>
              
              {/* Show smart diff if available with proper structure, otherwise standard diff */}
              <div
                ref={diffScrollRef}
                className="diff-scroll-container"
                onWheel={handleDiffWheel}
              >
                {selectedFile.analysis?.richText?.hunks?.length > 0 && expandedSections.richDiff ? (
                  <RichDiffView
                    richText={selectedFile.analysis.richText}
                    hideContext={!expandedSections.noise}
                  />
                ) : selectedFile.analysis && expandedSections.semanticView && 
                   selectedFile.analysis.significantChanges && selectedFile.analysis.significantChanges.length > 0 ? (
                    <SmartDiffView 
                      analysis={selectedFile.analysis}
                      file={selectedFile}
                      expandedSections={expandedSections}
                      onToggleSection={toggleSection}
                    />
                  ) : (
                    <div style={{ backgroundColor: 'var(--bg-primary)' }}>
                      {expandedSections.markdownRender && isMarkdownFile(selectedFile.path || selectedFile.filename) ? (
                        <MarkdownSideBySide
                          oldText={selectedFile.oldContent || ''}
                          newText={selectedFile.newContent || ''}
                        />
                      ) : selectedFile.patch ? (
                        <div style={{ padding: '20px', fontFamily: 'Consolas, Monaco, monospace', fontSize: '13px', color: 'var(--text-primary)' }}>
                          {selectedFile.patch.split('\n').map((line, idx) => {
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
                              style.fontWeight = 'bold';
                            } else {
                              style.color = 'var(--text-primary)';
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
              </div>
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
        {selectedFile && isMarkdownFile(selectedFile.path || selectedFile.filename) && (
          <label>
            <input
              data-testid="toggle-markdown-render"
              type="checkbox"
              checked={expandedSections.markdownRender}
              onChange={() => toggleSection('markdownRender')}
            />
            Render Markdown
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={expandedSections.richDiff}
            onChange={() => toggleSection('richDiff')}
          />
          Rich Diff
        </label>
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
            checked={expandedSections.scrollWheelAdvance}
            onChange={() => toggleSection('scrollWheelAdvance')}
          />
          Wheel advances files
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
