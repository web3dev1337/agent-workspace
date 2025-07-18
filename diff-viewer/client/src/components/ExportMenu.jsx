import React, { useState } from 'react';
import axios from 'axios';
import './ExportMenu.css';

const ExportMenu = ({ diffData, metadata }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState(null);

  const handleExport = async (type) => {
    setExporting(true);
    setExportType(type);
    
    try {
      const response = await axios.post(
        `/api/export/${type}`,
        { diffData, metadata },
        { 
          responseType: 'blob',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // Create download link
      const blob = new Blob([response.data], {
        type: type === 'pdf' ? 'application/pdf' : 'text/markdown'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `diff-${metadata.number || metadata.sha}.${type}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      setIsOpen(false);
    } catch (error) {
      console.error('Export failed:', error);
      alert(`Failed to export ${type.toUpperCase()}: ${error.message}`);
    } finally {
      setExporting(false);
      setExportType(null);
    }
  };

  return (
    <div className="export-menu-container">
      <button 
        className="export-button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={exporting}
      >
        {exporting ? (
          <>
            <span className="export-spinner"></span>
            Exporting...
          </>
        ) : (
          <>
            <span className="export-icon">📥</span>
            Export
          </>
        )}
      </button>
      
      {isOpen && !exporting && (
        <div className="export-dropdown">
          <button 
            className="export-option"
            onClick={() => handleExport('pdf')}
          >
            <span className="option-icon">📄</span>
            Export as PDF
          </button>
          <button 
            className="export-option"
            onClick={() => handleExport('markdown')}
          >
            <span className="option-icon">📝</span>
            Export as Markdown
          </button>
        </div>
      )}
    </div>
  );
};

export default ExportMenu;