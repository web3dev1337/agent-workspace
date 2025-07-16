import React from 'react';
import './DiffViewer.css';

const SimpleDiffView = ({ file }) => {
  if (!file) return null;
  
  const { oldContent = '', newContent = '', filename, status } = file;
  
  // For debugging
  console.log('SimpleDiffView rendering:', {
    filename,
    status,
    hasOld: !!oldContent,
    hasNew: !!newContent,
    oldLength: oldContent.length,
    newLength: newContent.length
  });
  
  return (
    <div style={{ 
      display: 'flex', 
      height: '100%', 
      fontFamily: 'monospace',
      fontSize: '14px'
    }}>
      {/* Old content */}
      <div style={{ 
        flex: 1, 
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        padding: '20px',
        overflow: 'auto',
        borderRight: '1px solid #444'
      }}>
        <h3 style={{ margin: '0 0 10px 0', color: '#f48771' }}>
          {status === 'added' ? 'New File' : 'Original'}
        </h3>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {status === 'added' ? '(New file - no previous version)' : oldContent || '(Empty)'}
        </pre>
      </div>
      
      {/* New content */}
      <div style={{ 
        flex: 1, 
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        padding: '20px',
        overflow: 'auto'
      }}>
        <h3 style={{ margin: '0 0 10px 0', color: '#98c379' }}>
          {status === 'removed' ? 'Deleted File' : 'Modified'}
        </h3>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {status === 'removed' ? '(File deleted)' : newContent || '(Empty)'}
        </pre>
      </div>
    </div>
  );
};

export default SimpleDiffView;