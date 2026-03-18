import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from '../context/theme';
import './EnhancedMonacoDiff.css';

const EnhancedMonacoDiff = ({ file }) => {
  const { theme } = useTheme();
  const [decorations, setDecorations] = useState([]);
  const [isReady, setIsReady] = useState(false);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  useEffect(() => {
    if (!file || !isReady) return;

    // Build the unified diff view with inline changes
    const lines = [];
    const decorationData = [];
    let lineNumber = 1;

    // If it's a new file, just show all as additions
    if (file.status === 'added') {
      const content = file.newContent || '';
      const contentLines = content.split('\n');
      contentLines.forEach((line, idx) => {
        lines.push(`+ ${line}`);
        decorationData.push({
          range: new monacoRef.current.Range(lineNumber, 1, lineNumber, 1000),
          options: {
            isWholeLine: true,
            className: 'diff-line-added',
            linesDecorationsClassName: 'diff-line-added-gutter'
          }
        });
        lineNumber++;
      });
    } 
    // If it's a modified file, show the diff
    else if (file.status === 'modified' && file.patch) {
      const patchLines = file.patch.split('\n');
      
      patchLines.forEach((line) => {
        if (line.startsWith('@@')) {
          // Hunk header
          lines.push(line);
          decorationData.push({
            range: new monacoRef.current.Range(lineNumber, 1, lineNumber, 1000),
            options: {
              isWholeLine: true,
              className: 'diff-hunk-header',
              linesDecorationsClassName: 'diff-hunk-header-gutter'
            }
          });
          lineNumber++;
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          // Added line
          lines.push(line);
          decorationData.push({
            range: new monacoRef.current.Range(lineNumber, 1, lineNumber, 1000),
            options: {
              isWholeLine: true,
              className: 'diff-line-added',
              linesDecorationsClassName: 'diff-line-added-gutter'
            }
          });
          lineNumber++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          // Removed line
          lines.push(line);
          decorationData.push({
            range: new monacoRef.current.Range(lineNumber, 1, lineNumber, 1000),
            options: {
              isWholeLine: true,
              className: 'diff-line-removed',
              linesDecorationsClassName: 'diff-line-removed-gutter'
            }
          });
          lineNumber++;
        } else if (line.startsWith(' ')) {
          // Context line
          lines.push(line);
          lineNumber++;
        } else if (line.startsWith('+++') || line.startsWith('---')) {
          // Skip file headers
        } else if (line) {
          // Other lines
          lines.push(line);
          lineNumber++;
        }
      });
    }
    // If it's a deleted file
    else if (file.status === 'removed') {
      const content = file.oldContent || '';
      const contentLines = content.split('\n');
      contentLines.forEach((line) => {
        lines.push(`- ${line}`);
        decorationData.push({
          range: new monacoRef.current.Range(lineNumber, 1, lineNumber, 1000),
          options: {
            isWholeLine: true,
            className: 'diff-line-removed',
            linesDecorationsClassName: 'diff-line-removed-gutter'
          }
        });
        lineNumber++;
      });
    }

    const content = lines.join('\n');
    
    // Set the content
    if (editorRef.current) {
      editorRef.current.setValue(content);
      
      // Apply decorations
      const decorationIds = editorRef.current.deltaDecorations([], decorationData);
      setDecorations(decorationIds);
    }

  }, [file, isReady]);

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    console.log('🎨 Monaco editor mounted');
    setIsReady(true);
  };

  if (!file) return <div>No file selected</div>;

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Editor
        height="100%"
        theme={theme === 'light' ? 'vs' : 'vs-dark'}
        language={getLanguageFromPath(file.path || file.filename)}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          lineNumbers: 'on',
          renderLineHighlight: 'all',
          renderWhitespace: 'selection',
          wordWrap: 'on',
          wrappingStrategy: 'advanced',
          scrollbar: {
            horizontal: 'hidden',
            alwaysConsumeMouseWheel: false
          },
          guides: {
            indentation: false
          }
        }}
        onMount={handleEditorMount}
      />
    </div>
  );
};

const getLanguageFromPath = (path) => {
  if (!path) return 'plaintext';
  const ext = path.split('.').pop().toLowerCase();
  const langMap = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    xml: 'xml',
    sh: 'shell',
    bash: 'shell'
  };
  return langMap[ext] || 'plaintext';
};

export default EnhancedMonacoDiff;
