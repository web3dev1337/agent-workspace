// Tauri compatibility layer for opening external links

(function() {
  // Check if we're running in Tauri
  const isTauri = window.__TAURI__ !== undefined;
  
  if (isTauri) {
    // Override window.open to use Tauri's shell API
    const originalOpen = window.open;
    
    window.open = function(url, target, features) {
      console.log('Window.open called with URL:', url);
      
      // If it's an external URL, use our custom command
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        if (window.__TAURI__ && window.__TAURI__.invoke) {
          console.log('Using Tauri open_external for:', url);
          window.__TAURI__.invoke('open_external', { url: url })
            .then(() => console.log('Successfully opened:', url))
            .catch(err => console.error('Failed to open external URL:', err));
          return null; // Return null as we can't return a window reference
        }
      }
      
      // Fallback to original for other cases
      return originalOpen.call(window, url, target, features);
    };
    
    console.log('Tauri compatibility layer loaded - external links will open in system browser');
  }
})();