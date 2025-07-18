import React from 'react';
import './FileTree.css';

const FileTree = ({ files, selectedFile, onFileSelect }) => {
  // Group files by directory
  const fileTree = buildFileTree(files);

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <h3>Files Changed ({files.length})</h3>
      </div>
      <div className="file-tree-content">
        {renderTree(fileTree, selectedFile, onFileSelect)}
      </div>
    </div>
  );
};

// Build hierarchical tree structure
const buildFileTree = (files) => {
  const tree = {};
  
  files.forEach(file => {
    const parts = file.path.split('/');
    let current = tree;
    
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        // It's a file
        current[part] = { ...file, isFile: true };
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
const renderTree = (tree, selectedFile, onFileSelect, level = 0) => {
  return Object.entries(tree).map(([name, node]) => {
    if (node.isFile) {
      const isSelected = selectedFile?.path === node.path;
      const changeClass = getChangeClass(node);
      
      return (
        <div
          key={node.path}
          className={`file-item ${isSelected ? 'selected' : ''} ${changeClass}`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => onFileSelect(node)}
        >
          <span className="file-icon">{getFileIcon(node.path)}</span>
          <span className="file-name">{name}</span>
          <span className="file-stats">
            {node.additions > 0 && <span className="additions">+{node.additions}</span>}
            {node.deletions > 0 && <span className="deletions">-{node.deletions}</span>}
          </span>
        </div>
      );
    } else {
      // Directory
      return (
        <div key={name} className="directory-item">
          <div 
            className="directory-name" 
            style={{ paddingLeft: `${level * 16 + 8}px` }}
          >
            <span className="directory-icon">📁</span>
            {name}
          </div>
          <div className="directory-children">
            {renderTree(node.children, selectedFile, onFileSelect, level + 1)}
          </div>
        </div>
      );
    }
  });
};

// Get appropriate icon for file type
const getFileIcon = (path) => {
  const ext = path.split('.').pop().toLowerCase();
  const iconMap = {
    js: '📜',
    jsx: '⚛️',
    ts: '📘',
    tsx: '⚛️',
    py: '🐍',
    json: '📋',
    md: '📝',
    css: '🎨',
    scss: '🎨',
    html: '🌐',
    yml: '⚙️',
    yaml: '⚙️'
  };
  return iconMap[ext] || '📄';
};

// Get change type class
const getChangeClass = (file) => {
  if (file.status === 'added') return 'file-added';
  if (file.status === 'deleted') return 'file-deleted';
  if (file.status === 'renamed') return 'file-renamed';
  return 'file-modified';
};

export default FileTree;