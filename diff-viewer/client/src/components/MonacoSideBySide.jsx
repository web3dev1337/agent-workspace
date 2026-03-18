import React, { useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from '../context/theme';

const MonacoSideBySide = ({ original, modified, language, height = "100%" }) => {
  const { theme } = useTheme();
  const leftEditorRef = useRef(null);
  const rightEditorRef = useRef(null);

  useEffect(() => {
    console.log('MonacoSideBySide content:', {
      originalLength: original?.length || 0,
      modifiedLength: modified?.length || 0,
      language
    });
  }, [original, modified, language]);

  return (
    <div style={{ 
      display: 'flex', 
      height, 
      width: '100%',
      gap: '2px',
      backgroundColor: 'var(--bg-primary)'
    }}>
      {/* Original/Old content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Editor
          height="100%"
          theme={theme === 'light' ? 'vs' : 'vs-dark'}
          value={original || '// No previous version'}
          language={language}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 14,
            lineNumbers: 'on',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
            wordWrap: 'on',
            wrappingStrategy: 'advanced',
            scrollbar: {
              horizontal: 'hidden',
              alwaysConsumeMouseWheel: false
            }
          }}
          onMount={(editor) => {
            leftEditorRef.current = editor;
            console.log('Left editor mounted');
          }}
        />
      </div>

      {/* Divider */}
      <div style={{ width: '2px', backgroundColor: 'var(--border-color)' }} />

      {/* Modified/New content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Editor
          height="100%"
          theme={theme === 'light' ? 'vs' : 'vs-dark'}
          value={modified || '// Empty'}
          language={language}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 14,
            lineNumbers: 'on',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
            wordWrap: 'on',
            wrappingStrategy: 'advanced',
            scrollbar: {
              horizontal: 'hidden',
              alwaysConsumeMouseWheel: false
            }
          }}
          onMount={(editor) => {
            rightEditorRef.current = editor;
            console.log('Right editor mounted');
          }}
        />
      </div>
    </div>
  );
};

export default MonacoSideBySide;
