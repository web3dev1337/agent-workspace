import React, { useState, useEffect, useRef } from 'react';
import DiffEditor from '@monaco-editor/react';
import FileTree from './FileTree';
import CollapsibleHeader from './CollapsibleHeader';
import EnhancedMonacoDiff from './EnhancedMonacoDiff';
import './DiffViewer.css';

const DiffViewer = ({ data }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [showSemanticView, setShowSemanticView] = useState(true);
  const editorRef = useRef(null);

  const { metadata, diff, type } = data;
  
  // Merge metadata files with diff files to get content
  const files = diff.files?.map(diffFile => {
    // Find matching file in metadata to get content
    const metadataFile = metadata.files?.find(f => 
      f.filename === diffFile.path || f.filename === diffFile.filename
    );
    
    // Merge the data, preferring content from metadata
    return {
      ...diffFile,
      ...metadataFile, // Include all metadata fields including patch
      oldContent: metadataFile?.oldContent || diffFile.oldContent,
      newContent: metadataFile?.newContent || diffFile.newContent,
      filename: diffFile.filename || diffFile.path,
      path: diffFile.path || diffFile.filename,
      patch: metadataFile?.patch || diffFile.patch // Ensure patch is included
    };
  }) || [];

  useEffect(() => {
    // Select first file by default when data loads
    if (files.length > 0) {
      console.log('🎯 Auto-selecting first file:', files[0]);
      // Small delay to ensure components are mounted
      setTimeout(() => {
        setSelectedFile(files[0]);
        setCurrentFileIndex(0);
      }, 100);
    }
  }, [data]); // Trigger when data changes, not files

  // Force re-render when selectedFile changes
  useEffect(() => {
    if (selectedFile) {
      console.log('📁 File selected:', selectedFile.path);
    }
  }, [selectedFile]);

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
    
    // If we have oldContent/newContent, use them
    if (file.oldContent || file.newContent) {
      return {
        original: file.oldContent || '',
        modified: file.newContent || ''
      };
    }
    
    // If we have a changes array (from text-based diff), reconstruct content
    if (file.changes && Array.isArray(file.changes)) {
      const oldLines = [];
      const newLines = [];
      
      file.changes.forEach(change => {
        if (change.type === 'deleted' || change.type === 'context') {
          oldLines.push(change.content);
        }
        if (change.type === 'added' || change.type === 'context') {
          newLines.push(change.content);
        }
      });
      
      return {
        original: oldLines.join('\n'),
        modified: newLines.join('\n')
      };
    }
    
    // If this is a new file (status: 'added'), only show in modified pane
    if (file.status === 'added') {
      const content = file.changes?.map(c => c.content).join('\n') || '';
      return {
        original: '',
        modified: content
      };
    }
    
    // If this is a deleted file (status: 'removed'), only show in original pane
    if (file.status === 'removed') {
      const content = file.changes?.map(c => c.content).join('\n') || '';
      return {
        original: content,
        modified: ''
      };
    }
    
    return { original: '', modified: '' };
  };

  const renderDiffEditor = () => {
    if (!selectedFile) {
      console.log('⚠️ No file selected');
      return null;
    }

    const { original, modified } = getFileContent(selectedFile);
    
    console.log('📄 Rendering diff for:', {
      file: selectedFile.path || selectedFile.filename,
      hasOriginal: !!original,
      hasModified: !!modified,
      originalLength: original?.length,
      modifiedLength: modified?.length,
      firstChars: {
        original: original?.substring(0, 50),
        modified: modified?.substring(0, 50)
      },
      fullFile: selectedFile
    });

    // Ensure we have valid strings for Monaco
    const originalContent = String(original || '');
    const modifiedContent = String(modified || '');
    
    // Try the custom side-by-side view instead
    return (
      <MonacoSideBySide
        original={originalContent}
        modified={modifiedContent}
        language={getLanguageFromPath(selectedFile.path || selectedFile.filename)}
        height="100%"
      />
    );
  };

  return (
    <div className="diff-viewer-container">
      <CollapsibleHeader 
        metadata={metadata}
        diff={diff}
        onToggleView={setShowSemanticView}
        showSemanticView={showSemanticView}
      />

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
              <div style={{ 
                background: '#2d2d30', 
                padding: '4px 12px', 
                borderBottom: '1px solid #3e3e42',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0
              }}>
                <span style={{ 
                  fontFamily: 'monospace', 
                  fontSize: '12px',
                  color: '#cccccc' 
                }}>
                  {selectedFile.path}
                </span>
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <EnhancedMonacoDiff file={selectedFile} />
              </div>
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