import { useEffect, useCallback } from 'react';

/**
 * Keyboard navigation hook for fast diff review
 */
const useKeyboardNavigation = ({
  files,
  currentFile,
  reviewState,
  onFileSelect,
  onToggleReview,
  onToggleSection
}) => {
  // Find next unreviewed file
  const findNextUnreviewed = useCallback((startIndex) => {
    if (!files || files.length === 0) return -1;
    
    // Start from next file
    for (let i = startIndex + 1; i < files.length; i++) {
      if (!reviewState[files[i].path]) {
        return i;
      }
    }
    
    // Wrap around to beginning
    for (let i = 0; i <= startIndex; i++) {
      if (!reviewState[files[i].path]) {
        return i;
      }
    }
    
    return -1;
  }, [files, reviewState]);

  // Find previous unreviewed file
  const findPrevUnreviewed = useCallback((startIndex) => {
    if (!files || files.length === 0) return -1;
    
    // Start from previous file
    for (let i = startIndex - 1; i >= 0; i--) {
      if (!reviewState[files[i].path]) {
        return i;
      }
    }
    
    // Wrap around to end
    for (let i = files.length - 1; i >= startIndex; i--) {
      if (!reviewState[files[i].path]) {
        return i;
      }
    }
    
    return -1;
  }, [files, reviewState]);

  const handleKeyPress = useCallback((event) => {
    // Don't handle if user is typing in an input
    if (event.target.tagName === 'INPUT' || 
        event.target.tagName === 'TEXTAREA' ||
        event.target.isContentEditable) {
      return;
    }

    const currentIndex = files.findIndex(f => f.path === currentFile?.path);

    switch (event.key) {
      case 'j':
      case 'J':
        event.preventDefault();
        if (event.shiftKey) {
          // Shift+J: Next unreviewed file
          const nextUnreviewed = findNextUnreviewed(currentIndex);
          if (nextUnreviewed >= 0) {
            onFileSelect(files[nextUnreviewed]);
          }
        } else {
          // j: Next file
          if (currentIndex < files.length - 1) {
            onFileSelect(files[currentIndex + 1]);
          }
        }
        break;

      case 'k':
      case 'K':
        event.preventDefault();
        if (event.shiftKey) {
          // Shift+K: Previous unreviewed file
          const prevUnreviewed = findPrevUnreviewed(currentIndex);
          if (prevUnreviewed >= 0) {
            onFileSelect(files[prevUnreviewed]);
          }
        } else {
          // k: Previous file
          if (currentIndex > 0) {
            onFileSelect(files[currentIndex - 1]);
          }
        }
        break;

      case ' ':
        // Space: Toggle review state of current file
        event.preventDefault();
        if (currentFile) {
          onToggleReview(currentFile);
        }
        break;

      case 'Enter':
        // Enter: Mark as reviewed and go to next unreviewed
        event.preventDefault();
        if (currentFile && !reviewState[currentFile.path]) {
          onToggleReview(currentFile);
          const nextUnreviewed = findNextUnreviewed(currentIndex);
          if (nextUnreviewed >= 0) {
            setTimeout(() => onFileSelect(files[nextUnreviewed]), 100);
          }
        }
        break;

      case 'r':
        // r: Toggle refactorings section
        event.preventDefault();
        onToggleSection('refactorings');
        break;

      case 'm':
        // m: Toggle moved code section
        event.preventDefault();
        onToggleSection('moves');
        break;

      case 'd':
        // d: Toggle duplications section
        event.preventDefault();
        onToggleSection('duplications');
        break;

      case 'n':
        // n: Toggle noise section
        event.preventDefault();
        onToggleSection('noise');
        break;

      case 's':
        // s: Toggle semantic/raw view
        event.preventDefault();
        onToggleSection('semanticView');
        break;

      case '?':
        // ?: Show keyboard shortcuts help
        event.preventDefault();
        showKeyboardHelp();
        break;

      case 'Escape':
        // Escape: Close any open modals/panels
        event.preventDefault();
        // Implement based on your UI needs
        break;
    }
  }, [currentFile, files, reviewState, onFileSelect, onToggleReview, 
      onToggleSection, findNextUnreviewed, findPrevUnreviewed]);

  // Add global keyboard listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  return {
    findNextUnreviewed,
    findPrevUnreviewed
  };
};

// Show keyboard shortcuts help
const showKeyboardHelp = () => {
  const shortcuts = `
Keyboard Shortcuts:

Navigation:
  j         - Next file
  k         - Previous file  
  Shift+J   - Next unreviewed file
  Shift+K   - Previous unreviewed file

Review:
  Space     - Toggle reviewed
  Enter     - Mark reviewed & next unreviewed

Sections:
  r         - Toggle refactorings
  m         - Toggle moved code
  d         - Toggle duplications
  n         - Toggle noise
  s         - Toggle semantic view

Other:
  ?         - Show this help
  Escape    - Close panels
  `;
  
  alert(shortcuts);
};

export default useKeyboardNavigation;