import React, { useState, useEffect, useRef } from 'react';
import DiffEditor from '@monaco-editor/react';
import FileTree from './FileTree';
import DiffStats from './DiffStats';
import ExportMenu from './ExportMenu';
import AISummary from './AISummary';
import './DiffViewer.css';

const DiffViewer = ({ data }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [showSemanticView, setShowSemanticView] = useState(true);
  const editorRef = useRef(null);

  const { metadata, diff, type } = data;
  const files = diff.files || [];

  useEffect(() => {
    // Select first file by default
    if (files.length > 0 && !selectedFile) {
      setSelectedFile(files[0]);
      setCurrentFileIndex(0);
    }
  }, [files]);

  useEffect(() => {
    // Keyboard shortcuts
    const handleKeyPress = (e) => {
      // j/k for navigation
      if (e.key === 'j' && currentFileIndex < files.length - 1) {
        navigateToFile(currentFileIndex + 1);
      } else if (e.key === 'k' && currentFileIndex > 0) {
        navigateToFile(currentFileIndex - 1);
      }
      // s to toggle semantic view
      else if (e.key === 's') {
        setShowSemanticView(!showSemanticView);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentFileIndex, files.length, showSemanticView]);

  const navigateToFile = (index) => {
    setCurrentFileIndex(index);
    setSelectedFile(files[index]);
  };

  const handleFileSelect = (file) => {
    const index = files.findIndex(f => f.path === file.path);
    if (index !== -1) {
      navigateToFile(index);
    }
  };

  const getFileContent = (file) => {
    if (!file) return { original: '', modified: '' };
    
    if (showSemanticView && file.semanticDiff) {
      // Use semantic diff if available
      return {
        original: file.semanticDiff.original || file.oldContent || '',
        modified: file.semanticDiff.modified || file.newContent || ''
      };
    }
    
    return {
      original: file.oldContent || '',
      modified: file.newContent || ''
    };
  };

  const renderDiffEditor = () => {
    if (!selectedFile) return null;

    const { original, modified } = getFileContent(selectedFile);

    return (
      <DiffEditor
        height="100%"
        theme="vs-dark"
        original={original}
        modified={modified}
        language={getLanguageFromPath(selectedFile.path)}
        options={{
          readOnly: true,
          renderSideBySide: true,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          fontSize: 14,
          automaticLayout: true,
          renderValidationDecorations: 'off'
        }}
        onMount={(editor) => {
          editorRef.current = editor;
        }}
      />
    );
  };

  return (
    <div className="diff-viewer-container">
      <div className="diff-header">
        <div className="pr-info">
          <h2>#{metadata.number}: {metadata.title}</h2>
          <div className="pr-meta">
            <span className="author">by {metadata.user?.login}</span>
            <span className="branch">{metadata.head?.ref} → {metadata.base?.ref}</span>
          </div>
        </div>
        <DiffStats stats={diff.stats} />
      </div>

      <div className="diff-controls">
        <div className="controls-left">
          <button 
            className={`toggle-btn ${showSemanticView ? 'active' : ''}`}
            onClick={() => setShowSemanticView(!showSemanticView)}
          >
            {showSemanticView ? '🧠 Semantic View' : '📄 Raw View'}
          </button>
          <ExportMenu diffData={diff} metadata={metadata} />
        </div>
        <div className="navigation-hint">
          Use <kbd>j</kbd>/<kbd>k</kbd> to navigate, <kbd>s</kbd> to toggle view
        </div>
      </div>

      <AISummary diffData={diff} metadata={metadata} type={type} />

      <div className="diff-content">
        <div className="file-tree-sidebar">
          <FileTree 
            files={files}
            selectedFile={selectedFile}
            onFileSelect={handleFileSelect}
          />
        </div>

        <div className="diff-editor-container">
          {selectedFile ? (
            <>
              <div className="file-header">
                <span className="file-path">{selectedFile.path}</span>
                {selectedFile.semanticChanges && (
                  <span className="semantic-info">
                    {selectedFile.semanticChanges.moved > 0 && 
                      `${selectedFile.semanticChanges.moved} moved blocks`}
                  </span>
                )}
              </div>
              {renderDiffEditor()}
            </>
          ) : (
            <div className="no-file-selected">
              Select a file to view changes
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper function to determine language from file path
const getLanguageFromPath = (path) => {
  const ext = path.split('.').pop().toLowerCase();
  const langMap = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    yml: 'yaml',
    yaml: 'yaml'
  };
  return langMap[ext] || 'plaintext';
};

export default DiffViewer;