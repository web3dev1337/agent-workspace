import React, { useState, useEffect } from 'react';
import './ReviewableFileTree.css';

const ReviewableFileTree = ({ files, selectedFile, onFileSelect, prInfo }) => {
  const [reviewState, setReviewState] = useState({});
  const [reviewProgress, setReviewProgress] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  // Load review state on mount
  useEffect(() => {
    if (prInfo && prInfo.owner && prInfo.repo && prInfo.number) {
      loadReviewState();
      createOrResumeSession();
    }
  }, [prInfo]);

  const loadReviewState = async () => {
    try {
      const response = await fetch(
        `/api/review/state/${prInfo.owner}/${prInfo.repo}/${prInfo.number}?totalFiles=${files.length}`
      );
      const data = await response.json();
      
      if (data.success) {
        setReviewProgress(data.progress);
        
        // Convert to map for easy lookup
        const stateMap = {};
        data.progress.files.forEach(file => {
          stateMap[file] = true;
        });
        setReviewState(stateMap);
      }
    } catch (error) {
      console.error('Failed to load review state:', error);
    }
  };

  const createOrResumeSession = async () => {
    try {
      const response = await fetch(
        `/api/review/session/${prInfo.owner}/${prInfo.repo}/${prInfo.number}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ totalFiles: files.length })
        }
      );
      const data = await response.json();
      
      if (data.success) {
        setSessionId(data.sessionId);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const toggleFileReview = async (file, event) => {
    event.stopPropagation();
    const newState = !reviewState[file.path];
    
    // If no PR info, just update local state
    if (!prInfo || !prInfo.owner || !prInfo.repo || !prInfo.number) {
      setReviewState(prev => ({
        ...prev,
        [file.path]: newState
      }));
      
      // Update local progress
      const reviewedCount = Object.values({
        ...reviewState,
        [file.path]: newState
      }).filter(Boolean).length;
      
      setReviewProgress({
        reviewed: reviewedCount,
        total: files.length,
        percentage: Math.round((reviewedCount / files.length) * 100)
      });
      return;
    }
    
    try {
      const response = await fetch(
        `/api/review/state/${prInfo.owner}/${prInfo.repo}/${prInfo.number}/file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: file.path,
            reviewed: newState,
            sessionId,
            totalFiles: files.length
          })
        }
      );
      const data = await response.json();
      
      if (data.success) {
        setReviewState(prev => ({
          ...prev,
          [file.path]: newState
        }));
        
        // Update progress
        const reviewedCount = Object.values({
          ...reviewState,
          [file.path]: newState
        }).filter(Boolean).length;
        
        setReviewProgress({
          reviewed: reviewedCount,
          total: files.length,
          percentage: Math.round((reviewedCount / files.length) * 100)
        });
      }
    } catch (error) {
      console.error('Failed to update review state:', error);
    }
  };

  const markAllReviewed = async (reviewed = true) => {
    // If no PR info, just update local state
    if (!prInfo || !prInfo.owner || !prInfo.repo || !prInfo.number) {
      const newState = {};
      files.forEach(file => {
        newState[file.path] = reviewed;
      });
      setReviewState(newState);
      setReviewProgress({
        reviewed: reviewed ? files.length : 0,
        total: files.length,
        percentage: reviewed ? 100 : 0
      });
      return;
    }
    
    try {
      const response = await fetch(
        `/api/review/state/${prInfo.owner}/${prInfo.repo}/${prInfo.number}/batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: files.map(f => f.path),
            reviewed,
            totalFiles: files.length
          })
        }
      );
      const data = await response.json();
      
      if (data.success) {
        const newState = {};
        files.forEach(file => {
          newState[file.path] = reviewed;
        });
        setReviewState(newState);
        setReviewProgress(data.progress);
      }
    } catch (error) {
      console.error('Failed to batch update review state:', error);
    }
  };

  // Group files by directory
  const fileTree = buildFileTree(files, reviewState);

  return (
    <div className="reviewable-file-tree">
      <div className="file-tree-header">
        <h3>Files Changed ({files.length})</h3>
        {reviewProgress && (
          <div className="review-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${reviewProgress.percentage}%` }}
              />
            </div>
            <span className="progress-text">
              {reviewProgress.reviewed}/{reviewProgress.total} reviewed
            </span>
          </div>
        )}
      </div>
      
      <div className="review-actions">
        <button 
          className="mark-all-btn"
          onClick={() => markAllReviewed(true)}
          disabled={reviewProgress?.percentage === 100}
        >
          Mark All Reviewed
        </button>
        <button 
          className="clear-all-btn"
          onClick={() => markAllReviewed(false)}
          disabled={reviewProgress?.percentage === 0}
        >
          Clear All
        </button>
      </div>
      
      <div className="file-tree-content">
        {renderTree(fileTree, selectedFile, onFileSelect, reviewState, toggleFileReview)}
      </div>
      
      <div className="keyboard-hints">
        <div className="hint"><kbd>j</kbd> Next unreviewed</div>
        <div className="hint"><kbd>k</kbd> Prev unreviewed</div>
        <div className="hint"><kbd>Space</kbd> Toggle reviewed</div>
      </div>
    </div>
  );
};

// Build hierarchical tree structure
const buildFileTree = (files, reviewState) => {
  const tree = {};
  
  files.forEach(file => {
    const parts = file.path.split('/');
    let current = tree;
    
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        // It's a file
        current[part] = { 
          ...file, 
          isFile: true,
          reviewed: reviewState[file.path] || false
        };
      } else {
        // It's a directory
        if (!current[part]) {
          current[part] = { isDirectory: true, children: {} };
        }
        current = current[part].children;
      }
    });
  });
  
  return tree;
};

// Render tree recursively
const renderTree = (tree, selectedFile, onFileSelect, reviewState, toggleFileReview, level = 0) => {
  return Object.entries(tree).map(([name, node]) => {
    if (node.isFile) {
      const isSelected = selectedFile?.path === node.path;
      const changeClass = getChangeClass(node);
      
      return (
        <div
          key={node.path}
          className={`file-item ${changeClass} ${isSelected ? 'selected' : ''} ${node.reviewed ? 'reviewed' : ''}`}
          onClick={() => onFileSelect(node)}
          style={{ paddingLeft: `${level * 20 + 10}px` }}
        >
          <input
            type="checkbox"
            className="review-checkbox"
            checked={node.reviewed}
            onChange={(e) => toggleFileReview(node, e)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="file-icon">{getFileIcon(name)}</span>
          <span className="file-name">{name}</span>
          <span className="file-stats">
            <span className="additions">+{node.additions || 0}</span>
            <span className="deletions">-{node.deletions || 0}</span>
          </span>
        </div>
      );
    } else {
      // Directory
      const isExpanded = true; // Could track this in state
      const hasReviewedChildren = hasReviewedFiles(node.children);
      
      return (
        <div key={name} className="directory-item">
          <div
            className={`directory-header ${hasReviewedChildren ? 'has-reviewed' : ''}`}
            style={{ paddingLeft: `${level * 20 + 10}px` }}
          >
            <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
            <span className="directory-icon">📁</span>
            <span className="directory-name">{name}</span>
          </div>
          {isExpanded && (
            <div className="directory-children">
              {renderTree(node.children, selectedFile, onFileSelect, reviewState, toggleFileReview, level + 1)}
            </div>
          )}
        </div>
      );
    }
  });
};

const hasReviewedFiles = (children) => {
  return Object.values(children).some(child => {
    if (child.isFile) return child.reviewed;
    if (child.isDirectory) return hasReviewedFiles(child.children);
    return false;
  });
};

const getChangeClass = (file) => {
  if (!file.status) return '';
  
  switch (file.status) {
    case 'added': return 'added';
    case 'removed': return 'deleted';
    case 'modified': return 'modified';
    case 'renamed': return 'renamed';
    default: return '';
  }
};

const getFileIcon = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  const iconMap = {
    js: '🟨',
    jsx: '⚛️',
    ts: '🔷',
    tsx: '⚛️',
    json: '📋',
    md: '📝',
    css: '🎨',
    html: '🌐',
    py: '🐍',
    go: '🐹',
    rs: '🦀',
    java: '☕',
    rb: '💎',
    php: '🐘',
    yml: '📄',
    yaml: '📄',
    toml: '📄',
    xml: '📄',
    sh: '🐚',
    bat: '🦇',
    dockerfile: '🐳',
    gitignore: '🚫'
  };
  
  return iconMap[ext] || '📄';
};

export default ReviewableFileTree;